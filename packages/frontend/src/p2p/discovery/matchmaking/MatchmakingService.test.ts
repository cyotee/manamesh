import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { LobbyEvents } from './gossip-adapter';
import type { LobbyMessage, LobbyPayload } from './types';
const wire = vi.hoisted(() => ({ events: null as LobbyEvents | null, send: vi.fn() }));
vi.mock('@libp2p/webrtc', () => ({ webRTC: vi.fn() }));
vi.mock('libp2p', () => ({ createLibp2p: async () => ({ start: async () => {}, stop: async () => {}, peerId: { toString: () => 'local' } }) }));
vi.mock('../../bootstrap-resolver', () => ({ resolveBootstrapNodes: async () => [] }));
vi.mock('./dht-adapter', () => ({
  lookupTable: async () => ({ tableId: 'table', hostPeerId: 'host' }),
  DHTTableAdapter: class { async createTable() {} close() {} },
}));
vi.mock('./gossip-adapter', () => ({ GossipLobbyAdapter: class {
  constructor(_node: unknown, _room: string, events: LobbyEvents) { wire.events = events; }
  async start() {} async stop() {} startHeartbeat() {} stopHeartbeat() {}
  send = wire.send;
} }));
import { MatchmakingService } from './MatchmakingService';
const services: MatchmakingService[] = [];
beforeEach(() => wire.send.mockClear());
afterEach(async () => { for (const service of services.splice(0)) await service.stop(); });
async function fixture(isHost = false) {
  const events = { onTableFound: vi.fn(), onPlayerJoined: vi.fn(), onPlayerLeft: vi.fn(), onReadyChange: vi.fn(),
    onGameStart: vi.fn(), onGameAbort: vi.fn(), onJoinRequest: vi.fn(), onJoinResponse: vi.fn(), onError: vi.fn(), onStateChange: vi.fn() };
  const service = new MatchmakingService({ gameType: 'poker', displayName: 'Player', maxPlayers: 2, isHost, roomCode: 'ABCDEF' }, events);
  services.push(service); await service.start();
  const receive = (sender: string, payload: LobbyPayload) => wire.events!.onMessage({
    _matchmaking: true, sender, type: payload.type, timestamp: 1, payload,
  } as LobbyMessage);
  return { service, events, receive };
}
it('accepts a start only from the pinned table host and only once', async () => {
  const { service, events, receive } = await fixture();
  receive('attacker', { type: 'GameStart', startTime: 10 });
  expect(events.onGameStart).not.toHaveBeenCalled();
  expect(service.getState()).toBe('lobby');
  receive('host', { type: 'GameStart', startTime: 20 });
  receive('host', { type: 'GameStart', startTime: 30 });
  expect(events.onGameStart).toHaveBeenCalledTimes(1);
  expect(events.onGameStart).toHaveBeenCalledWith(20, undefined, undefined);
  expect(service.getState()).toBe('game');
});
it('accepts aborts only from the pinned host while active', async () => {
  const { service, events, receive } = await fixture();
  receive('attacker', { type: 'GameAbort', reason: 'forged' });
  expect(events.onGameAbort).not.toHaveBeenCalled();
  receive('host', { type: 'GameAbort', reason: 'closed' });
  expect(events.onGameAbort).toHaveBeenCalledTimes(1);
  await service.stop();
  receive('host', { type: 'GameAbort', reason: 'late' });
  expect(events.onGameAbort).toHaveBeenCalledTimes(1);
});
it('ignores admission responses intended for another guest or sent by a non-host', async () => {
  const { events, receive } = await fixture();
  receive('attacker', { type: 'JoinResponse', recipientPeerId: 'local', accepted: true, seatOffered: 1 });
  receive('host', { type: 'JoinResponse', recipientPeerId: 'other', accepted: true, seatOffered: 1 });
  expect(events.onJoinResponse).not.toHaveBeenCalled();
  receive('host', { type: 'JoinResponse', recipientPeerId: 'local', accepted: true, seatOffered: 1 });
  expect(events.onJoinResponse).toHaveBeenCalledTimes(1);
});
it('prevents guest callers from issuing host control actions', async () => {
  const { service } = await fixture();
  wire.send.mockClear();
  for (const action of [() => service.startGame(), () => service.abortGame('x'), () => service.acceptJoin('peer', 1), () => service.rejectJoin('peer', 'x')]) {
    expect(action).toThrow(/host/);
  }
  expect(wire.send).not.toHaveBeenCalled();
});
it('host responses identify their recipient and peer commands cannot control the host', async () => {
  const { service, events, receive } = await fixture(true);
  receive('guest', { type: 'JoinRequest', displayName: 'Guest' });
  service.acceptJoin('guest', 1);
  expect(wire.send).toHaveBeenCalledWith('JoinResponse', expect.objectContaining({ recipientPeerId: 'guest', accepted: true }));
  receive('guest', { type: 'GameStart', startTime: 1 });
  receive('guest', { type: 'GameAbort', reason: 'forged' });
  expect(events.onGameStart).not.toHaveBeenCalled(); expect(events.onGameAbort).not.toHaveBeenCalled();
});

it('rejects unsolicited, altered and duplicate seat confirmations', async () => {
  const { service, events, receive } = await fixture(true);
  receive('intruder', { type: 'JoinConfirm', seat: 1 });
  expect(events.onPlayerJoined).not.toHaveBeenCalled();
  receive('guest', { type: 'JoinRequest', displayName: 'Alice' });
  service.acceptJoin('guest', 1);
  receive('guest', { type: 'JoinConfirm', seat: 0 });
  receive('intruder', { type: 'JoinConfirm', seat: 1 });
  expect(events.onPlayerJoined).not.toHaveBeenCalled();
  receive('guest', { type: 'JoinConfirm', seat: 1 });
  receive('guest', { type: 'JoinConfirm', seat: 1 });
  expect(events.onPlayerJoined).toHaveBeenCalledTimes(1);
  expect(service.getPlayers()).toContainEqual({ peerId: 'guest', name: 'Alice', seat: 1, ready: false });
});
it('reserves seats for their offered peer and releases a rejected reservation', async () => {
  const { service, receive } = await fixture(true);
  receive('a', { type: 'JoinRequest', displayName: 'A' });
  receive('b', { type: 'JoinRequest', displayName: 'B' });
  expect(() => service.acceptJoin('a', 0)).toThrow('Seat');
  expect(() => service.acceptJoin('a', 2)).toThrow('Seat');
  service.acceptJoin('a', 1);
  expect(service.getAvailableSeat()).toBeNull();
  expect(() => service.acceptJoin('b', 1)).toThrow('Seat');
  service.rejectJoin('a', 'full');
  expect(service.getAvailableSeat()).toBe(1);
  service.acceptJoin('b', 1);
  receive('a', { type: 'JoinConfirm', seat: 1 });
  expect(service.getPlayers()).toHaveLength(1);
});
it('guests can confirm only their own offered seat', async () => {
  const { service, receive } = await fixture();
  expect(() => service.confirmSeat(1)).toThrow('offer');
  receive('host', { type: 'JoinResponse', recipientPeerId: 'local', accepted: true, seatOffered: 1 });
  expect(() => service.confirmSeat(0)).toThrow('offer');
  service.confirmSeat(1);
  expect(service.getMySeat()).toBe(1);
  expect(() => service.confirmSeat(1)).toThrow('offer');
  await service.stop();
  expect(service.getMySeat()).toBe(-1);
  expect(service.getPlayers()).toEqual([]);
});
