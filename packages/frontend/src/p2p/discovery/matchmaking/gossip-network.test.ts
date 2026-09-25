import { expect, it, vi } from 'vitest';
import { createLibp2p } from 'libp2p';
import { webSockets } from '@libp2p/websockets';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { identify } from '@libp2p/identify';
import { gossipsub, StrictSign } from '@libp2p/gossipsub';
import { GossipLobbyAdapter } from './gossip-adapter';
import { getLobbyTopic } from './keys';

it('exchanges lobby messages through two real signed pubsub nodes', async () => {
  const create = () => createLibp2p({
    addresses: { listen: ['/ip4/127.0.0.1/tcp/0/ws'] },
    transports: [webSockets()], connectionEncrypters: [noise()], streamMuxers: [yamux()],
    services: { identify: identify(), pubsub: gossipsub({ globalSignaturePolicy: StrictSign }) },
  });
  const a = await create();
  let b: Awaited<ReturnType<typeof create>> | undefined;
  const adapters: GossipLobbyAdapter[] = [];
  try {
    b = await create();
    const receivedA = vi.fn(); const receivedB = vi.fn(); const errors = vi.fn();
    adapters.push(new GossipLobbyAdapter(a, 'ABCDEF', { onMessage: receivedA, onError: errors }),
      new GossipLobbyAdapter(b, 'ABCDEF', { onMessage: receivedB, onError: errors }));
    await Promise.all(adapters.map(adapter => adapter.start()));
    await b.dial(a.getMultiaddrs()[0]);
    await vi.waitFor(() => {
      expect(a.services.pubsub.getSubscribers(getLobbyTopic('ABCDEF'))).toHaveLength(1);
      expect(b!.services.pubsub.getSubscribers(getLobbyTopic('ABCDEF'))).toHaveLength(1);
    }, { timeout: 10000 });
    adapters[0].send('Heartbeat', {}); adapters[1].send('Heartbeat', {});
    await vi.waitFor(() => {
      expect(receivedA).toHaveBeenCalledTimes(1); expect(receivedB).toHaveBeenCalledTimes(1);
    }, { timeout: 10000 });
    expect(receivedA.mock.calls[0][0].sender).toBe(b.peerId.toString());
    expect(receivedB.mock.calls[0][0].sender).toBe(a.peerId.toString());
    expect(errors).not.toHaveBeenCalled();
  } finally {
    await Promise.all(adapters.map(adapter => adapter.stop()));
    await Promise.all([a.stop(), b?.stop()]);
  }
}, 20000);
