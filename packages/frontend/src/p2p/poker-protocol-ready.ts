import type { VerifiedPokerHistory } from '@manamesh/poker/verified-history';
import type { JoinCodeConnection } from './discovery/join-code';
type Link = Pick<JoinCodeConnection, 'isConnected' | 'onSignal' | 'offSignal' | 'sendSignal'>;
const PROTOCOL = 'manamesh-poker-protocol-ready-v2';

/** All proof/gameplay handlers must be installed before entering this barrier.
 * Stage callers must first install their local authorization. Use each scope
 * once per checkpoint; the protocol owner enforces that lifetime.
 * Readiness is an unsigned routing observation, never signing authorization.
 */
export function awaitPokerProtocolReady(links: ReadonlyMap<number, Link>, history: VerifiedPokerHistory, seat: number, relaySeat = 0, scope = 'handlers') {
  if (!/^[a-z0-9:-]{1,64}$/.test(scope)) throw new Error('poker_ready:scope');
  const valid = (value: number) => Number.isInteger(value) && value >= 0 && value < history.seatCount;
  const expected = seat === relaySeat ? Array.from({ length: history.seatCount }, (_, index) => index).filter(index => index !== seat) : [relaySeat];
  if (!valid(seat) || !valid(relaySeat) || links.size !== expected.length || expected.some(peer => !links.has(peer))
    || new Set(links.values()).size !== links.size || [...links.values()].some(link => !link.isConnected())) throw new Error('poker_ready:topology');
  const peers = new Map(links);
  const head = history.checkpoint.head;
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
  const nonces = new Map<number, string>();
  let done = false;
  let interval: ReturnType<typeof setInterval> | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const cleanup: (() => void)[] = [];
  let resolve!: () => void; let reject!: (error: Error) => void;
  const ready = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  function finish(error?: Error) {
    if (done) return; done = true;
    clearInterval(interval); clearTimeout(timeout); cleanup.splice(0).forEach(remove => remove());
    if (error) reject(error); else resolve();
  }
  function current() {
    if (history.checkpoint.head !== head || [...peers.values()].some(link => !link.isConnected())) throw new Error('poker_ready:stale_or_disconnected');
  }
  const base = { protocol: PROTOCOL, scope, sessionId: history.sessionId, checkpoint: head, seat, nonce };
  function receive(peer: number, value: unknown) {
    if (done || !value || typeof value !== 'object' || Array.isArray(value)) return;
    const packet = value as Record<string, unknown>;
    if (packet.protocol !== PROTOCOL) return;
    // Adjacent stages can overlap in transit. A different locally chosen scope
    // neither releases nor fails this barrier; an absent/malformed scope fails.
    if (typeof packet.scope === 'string' && /^[a-z0-9:-]{1,64}$/.test(packet.scope) && packet.scope !== scope) return;
    try {
      current();
      const fields = seat === relaySeat ? ['protocol', 'scope', 'sessionId', 'checkpoint', 'seat', 'nonce', 'peerSeat', 'type'] : ['protocol', 'scope', 'sessionId', 'checkpoint', 'seat', 'nonce', 'peerSeat', 'type', 'peerNonce'];
      if (Object.keys(packet).length !== fields.length || !Object.keys(packet).every(key => fields.includes(key))
        || packet.scope !== scope || packet.sessionId !== history.sessionId || packet.checkpoint !== head || packet.seat !== peer || packet.peerSeat !== seat
        || typeof packet.nonce !== 'string' || !/^[0-9a-f]{32}$/.test(packet.nonce)) throw new Error('poker_ready:binding');
      if (seat === relaySeat) {
        if (packet.type !== 'installed' || (nonces.has(peer) && nonces.get(peer) !== packet.nonce)) throw new Error('poker_ready:nonce_or_type');
        nonces.set(peer, packet.nonce);
        if (nonces.size === peers.size) {
          for (const [target, link] of peers) link.sendSignal({ ...base, type: 'go', peerSeat: target, peerNonce: nonces.get(target) });
          finish();
        }
      } else {
        if (packet.type !== 'go' || packet.peerNonce !== nonce) throw new Error('poker_ready:nonce_or_type');
        finish();
      }
    } catch (error) { finish(error instanceof Error ? error : new Error('poker_ready:failed')); }
  }
  function tick() {
    if (done) return;
    try {
      current();
      if (seat !== relaySeat) peers.get(relaySeat)!.sendSignal({ ...base, type: 'installed', peerSeat: relaySeat });
    } catch (error) { finish(error instanceof Error ? error : new Error('poker_ready:failed')); }
  }
  try {
    for (const [peer, link] of peers) {
      const handler = (value: unknown) => receive(peer, value);
      link.onSignal(handler); cleanup.push(() => link.offSignal(handler));
    }
    interval = setInterval(tick, 500);
    timeout = setTimeout(() => finish(new Error('poker_ready:timeout')), 20_000);
    tick();
  } catch (error) { finish(error instanceof Error ? error : new Error('poker_ready:failed')); }
  return { ready, dispose: () => finish(new Error('poker_ready:disposed')) };
}
