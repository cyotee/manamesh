import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LobbyProtocol, type LobbyReadyMessage } from './lobby-protocol';
import { AssetSharingSession } from './asset-sharing';

// Minimal mock of JoinCodeConnection
function createMockConnection() {
  const sent: string[] = [];
  return {
    send: vi.fn((data: string) => { sent.push(data); }),
    isConnected: () => true,
    sent,
  };
}

describe('LobbyProtocol', () => {
  let mockConn: ReturnType<typeof createMockConnection>;
  let protocol: LobbyProtocol;

  beforeEach(() => {
    mockConn = createMockConnection();
    // Cast to JoinCodeConnection since we only use send()
    protocol = new LobbyProtocol(mockConn as any);
  });

  it('sends messages as JSON with _lobby envelope', () => {
    const msg = AssetSharingSession.createRequest('pack-1', 'cards-only', ['c1']);
    protocol.send(msg);

    expect(mockConn.send).toHaveBeenCalledOnce();
    const parsed = JSON.parse(mockConn.sent[0]);
    expect(parsed._lobby).toBe(true);
    expect(parsed.payload.type).toBe('asset-pack-request');
    expect(parsed.payload.packId).toBe('pack-1');
  });

  it('dispatches incoming lobby messages to listeners', () => {
    const listener = vi.fn();
    protocol.onMessage(listener);

    const msg = AssetSharingSession.createDeckListShare(
      { name: 'Deck', game: 'onepiece', pack: 'OP01', leader: 'OP01-001', cards: {} },
      { id: 'p1', name: 'OP01', game: 'onepiece', cardCount: 100 },
    );

    const raw = JSON.stringify({ _lobby: true, payload: msg });
    const consumed = protocol.handleRawMessage(raw);

    expect(consumed).toBe(true);
    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0][0].type).toBe('deck-list-share');
  });

  it('returns false for non-lobby messages', () => {
    const consumed = protocol.handleRawMessage('{"type":"sync","args":[]}');
    expect(consumed).toBe(false);
  });

  it('returns false for non-JSON strings', () => {
    const consumed = protocol.handleRawMessage('not json');
    expect(consumed).toBe(false);
  });

  it('returns false for lobby envelope with invalid payload type', () => {
    const consumed = protocol.handleRawMessage(
      JSON.stringify({ _lobby: true, payload: { type: 'unknown-garbage' } })
    );
    expect(consumed).toBe(false);
  });

  it('unsubscribes listeners', () => {
    const listener = vi.fn();
    const unsub = protocol.onMessage(listener);
    unsub();

    const raw = JSON.stringify({
      _lobby: true,
      payload: AssetSharingSession.createCancel('pack-1'),
    });
    protocol.handleRawMessage(raw);

    expect(listener).not.toHaveBeenCalled();
  });

  it('detach removes all listeners', () => {
    const l1 = vi.fn();
    const l2 = vi.fn();
    protocol.onMessage(l1);
    protocol.onMessage(l2);
    protocol.detach();

    const raw = JSON.stringify({
      _lobby: true,
      payload: AssetSharingSession.createCancel('pack-1'),
    });
    protocol.handleRawMessage(raw);

    expect(l1).not.toHaveBeenCalled();
    expect(l2).not.toHaveBeenCalled();
  });

  it('multiple listeners all receive the message', () => {
    const l1 = vi.fn();
    const l2 = vi.fn();
    protocol.onMessage(l1);
    protocol.onMessage(l2);

    const raw = JSON.stringify({
      _lobby: true,
      payload: AssetSharingSession.createComplete('pack-1', true),
    });
    protocol.handleRawMessage(raw);

    expect(l1).toHaveBeenCalledOnce();
    expect(l2).toHaveBeenCalledOnce();
  });

  // --- Lobby control messages ---

  it('sends lobby-ready as control message', () => {
    protocol.sendControl({ type: 'lobby-ready', ready: true });

    expect(mockConn.send).toHaveBeenCalledOnce();
    const parsed = JSON.parse(mockConn.sent[0]);
    expect(parsed._lobby).toBe(true);
    expect(parsed.payload.type).toBe('lobby-ready');
    expect(parsed.payload.ready).toBe(true);
  });

  it('dispatches lobby-ready to control listeners', () => {
    const controlListener = vi.fn();
    const assetListener = vi.fn();
    protocol.onControl(controlListener);
    protocol.onMessage(assetListener);

    const raw = JSON.stringify({
      _lobby: true,
      payload: { type: 'lobby-ready', ready: true },
    });
    const consumed = protocol.handleRawMessage(raw);

    expect(consumed).toBe(true);
    expect(controlListener).toHaveBeenCalledOnce();
    expect(controlListener.mock.calls[0][0]).toEqual({ type: 'lobby-ready', ready: true });
    expect(assetListener).not.toHaveBeenCalled();
  });

  it('detach removes control listeners too', () => {
    const controlListener = vi.fn();
    protocol.onControl(controlListener);
    protocol.detach();

    const raw = JSON.stringify({
      _lobby: true,
      payload: { type: 'lobby-ready', ready: true },
    });
    protocol.handleRawMessage(raw);

    expect(controlListener).not.toHaveBeenCalled();
  });
});
