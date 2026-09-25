import { afterEach, expect, it, vi } from 'vitest';
import type { ManaMeshLibp2p } from '../../libp2p-config';
import { GossipLobbyAdapter } from './gossip-adapter';
import { getLobbyTopic } from './keys';
const topic = getLobbyTopic('ABCDEF');
const heartbeat = { _matchmaking: true, type: 'Heartbeat', sender: 'remote', timestamp: 1, payload: { type: 'Heartbeat' } };
class Pubsub extends EventTarget {
  globalSignaturePolicy = "StrictSign";
  subscribe = vi.fn(); unsubscribe = vi.fn(); publish = vi.fn().mockResolvedValue({ recipients: [] });
  receive(payload: unknown, patch: Record<string, unknown> = {}) {
    this.dispatchEvent(new CustomEvent('message', { detail: {
      type: 'signed', topic, from: { toString: () => 'remote' },
      data: new TextEncoder().encode(JSON.stringify(payload)), ...patch,
    } }));
  }
}
const adapters: GossipLobbyAdapter[] = [];
afterEach(async () => { for (const adapter of adapters.splice(0)) await adapter.stop(); vi.useRealTimers(); });
async function fixture() {
  const pubsub = new Pubsub(); const onMessage = vi.fn(); const onError = vi.fn();
  const node = { peerId: { toString: () => 'local' }, services: { pubsub } } as unknown as ManaMeshLibp2p;
  const adapter = new GossipLobbyAdapter(node, 'ABCDEF', { onMessage, onError });
  adapters.push(adapter); await adapter.start();
  return { adapter, pubsub, onMessage, onError };
}
it('delivers signed event details and makes start idempotent', async () => {
  const { adapter, pubsub, onMessage } = await fixture();
  await adapter.start(); pubsub.receive(heartbeat);
  expect(pubsub.subscribe).toHaveBeenCalledTimes(1);
  expect(onMessage).toHaveBeenCalledWith(heartbeat);
  expect(onMessage).toHaveBeenCalledTimes(1);
});
it('rejects forged authors, unsigned messages, other rooms and self messages', async () => {
  const { pubsub, onMessage } = await fixture();
  pubsub.receive({ ...heartbeat, sender: 'forged' });
  pubsub.receive(heartbeat, { type: 'unsigned' });
  pubsub.receive(heartbeat, { topic: 'another-room' });
  pubsub.receive({ ...heartbeat, sender: 'local' }, { from: { toString: () => 'local' } });
  expect(onMessage).not.toHaveBeenCalled();
});
it('rejects oversized data and malformed lobby payloads', async () => {
  const { pubsub, onMessage } = await fixture();
  for (const payload of [null, {}, { ...heartbeat, payload: { type: 'JoinConfirm', seat: -1 } },
    { ...heartbeat, type: 'JoinConfirm', payload: { type: 'JoinConfirm', seat: '0' } }]) pubsub.receive(payload);
  pubsub.receive(heartbeat, { data: new Uint8Array(65537) });
  pubsub.receive(heartbeat, { data: new Uint8Array([255]) });
  expect(onMessage).not.toHaveBeenCalled();
});
it('publishes with the local peer identity and reports publication failure', async () => {
  const { adapter, pubsub, onError } = await fixture();
  adapter.send('Heartbeat', {});
  expect(pubsub.publish).toHaveBeenCalledTimes(1);
  expect(JSON.parse(new TextDecoder().decode(pubsub.publish.mock.calls[0][1])).sender).toBe('local');
  pubsub.publish.mockRejectedValueOnce(new Error('offline'));
  adapter.send('Heartbeat', {}); await Promise.resolve();
  expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'offline' }));
});
it('removes listeners and heartbeat timers on stop', async () => {
  vi.useFakeTimers();
  const { adapter, pubsub, onMessage } = await fixture();
  adapter.startHeartbeat(); await adapter.stop();
  pubsub.receive(heartbeat); vi.advanceTimersByTime(10000);
  expect(onMessage).not.toHaveBeenCalled(); expect(pubsub.publish).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
it('refuses a pubsub service configured to accept unsigned messages', async () => {
  const { adapter, pubsub } = await fixture();
  await adapter.stop();
  pubsub.globalSignaturePolicy = 'StrictNoSign';
  await expect(adapter.start()).rejects.toThrow('signed pubsub');
});
