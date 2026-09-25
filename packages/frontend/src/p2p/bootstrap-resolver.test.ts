import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const rpc = vi.hoisted(() => ({ getEnsText: vi.fn() }));
vi.mock('viem', () => ({ createPublicClient: () => rpc, http: vi.fn() }));
const nodes = ['/dns4/relay.example/tcp/443/wss'];
let storage: Map<string, string>;
beforeEach(() => {
  vi.resetModules(); rpc.getEnsText.mockReset();
  storage = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
});
afterEach(() => vi.unstubAllGlobals());
it('resolves the ENS text using the public client and caches the result', async () => {
  rpc.getEnsText.mockResolvedValue(JSON.stringify(nodes));
  const resolver = await import('./bootstrap-resolver');
  expect(await resolver.resolveBootstrapNodes()).toEqual(nodes);
  expect(rpc.getEnsText).toHaveBeenCalledWith({ name: 'manamesh.nodes.eth', key: 'bootstrap' });
  expect(await resolver.resolveBootstrapNodes()).toEqual(nodes);
  expect(rpc.getEnsText).toHaveBeenCalledTimes(1);
});
it.each([null, '[]', '[123]', '[""]', '{}', 'not json'])('rejects malformed ENS records %j', async record => {
  rpc.getEnsText.mockResolvedValue(record);
  const resolver = await import('./bootstrap-resolver');
  expect(await resolver.resolveBootstrapNodes()).toEqual(resolver.HARDCODE_D_BOOTSTRAP_NODES);
});
it.each([
  { nodes: [123], timestamp: Date.now() },
  { nodes, timestamp: 'forever' },
  { nodes, timestamp: Date.now() + 100_000 },
  { nodes, timestamp: 0 },
])('ignores invalid or expired cached data %j', async entry => {
  storage.set('manamesh_bootstrap_nodes', JSON.stringify(entry));
  rpc.getEnsText.mockResolvedValue(JSON.stringify(nodes));
  const resolver = await import('./bootstrap-resolver');
  expect(await resolver.resolveBootstrapNodes()).toEqual(nodes);
  expect(rpc.getEnsText).toHaveBeenCalledTimes(1);
});
it('refresh still resolves when browser storage is denied', async () => {
  vi.stubGlobal('localStorage', { getItem() { throw Error('denied'); }, setItem() { throw Error('denied'); }, removeItem() { throw Error('denied'); } });
  rpc.getEnsText.mockResolvedValue(JSON.stringify(nodes));
  const resolver = await import('./bootstrap-resolver');
  expect(await resolver.refreshBootstrapNodes()).toEqual(nodes);
});
