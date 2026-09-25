import type { VerifiedPokerHistory } from '@manamesh/poker/verified-history';
import type { JoinCodeConnection } from './discovery/join-code';
import { PokerHistoryChannel, POKER_HISTORY_CHANNEL } from './poker-history-channel';

type Link = Pick<JoinCodeConnection, 'isConnected' | 'registerReliableChannel' | 'openReliableChannel' | 'onSignal' | 'offSignal' | 'sendSignal'>;
const PROTOCOL = 'manamesh-poker-history-ready-v1';
const TIMEOUT_MS = 20_000;

/** Connect already admitted histories. Readiness is not wallet/seat authentication.
 * The lower numbered seat initiates; each connection admits this protocol once.
 * Caller must await ready before sending and dispose when the session ends.
 */
export function connectPokerHistory(link: Link, history: VerifiedPokerHistory, seat: number, peerSeat: number) {
  if (![seat, peerSeat].every(value => Number.isInteger(value) && value >= 0 && value < history.seatCount) || seat === peerSeat) {
    throw new Error('poker_join:seat');
  }
  if (!link.isConnected()) throw new Error('poker_join:not_connected');
  const checkpoint = history.checkpoint.head;
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
  let channel: RTCDataChannel | undefined;
  let adapter: PokerHistoryChannel | undefined;
  let remoteNonce: string | undefined;
  let opened = false, finished = false, disposed = false, helloSent = false;
  let unregister = () => {};
  let interval: ReturnType<typeof setInterval> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let resolve!: (value: PokerHistoryChannel) => void;
  let reject!: (reason: Error) => void;
  let resolveClosed!: (reason: Error) => void;
  const closed = new Promise<Error>(resolve => { resolveClosed = resolve; });
  const ready = new Promise<PokerHistoryChannel>((yes, no) => { resolve = yes; reject = no; });
  const base = { protocol: PROTOCOL, sessionId: history.sessionId, checkpoint, seat, peerSeat };
  const current = () => history.checkpoint.head === checkpoint && link.isConnected();
  function clearStartup() {
    clearInterval(interval); clearTimeout(timer);
    link.offSignal(onSignal);
    channel?.removeEventListener('open', onOpen);
    channel?.removeEventListener('message', onMessage);

  }
  function dispose() { stop(new Error('poker_join:disposed')); }
  function stop(reason: Error) {
    if (disposed) return;
    disposed = true;
    clearStartup();
    channel?.removeEventListener('close', onClose);
    channel?.removeEventListener('error', onError);
    adapter?.removeEventListener('closed', onAdapterClosed);
    adapter?.dispose(); unregister();
    if (!finished) { finished = true; reject(reason); }
    resolveClosed(reason);
  }
  function fail(reason: string) { stop(new Error(`poker_join:${reason}`)); }
  function onAdapterClosed(event: Event) { stop((event as CustomEvent<Error>).detail); }
  function send(value: unknown) {
    if (!channel || channel.readyState !== 'open' || !current()) throw new Error('stale_or_closed');
    channel.send(JSON.stringify(value));
  }
  function onOpen() {
    if (helloSent) return;
    helloSent = true;
    try { send({ ...base, type: 'hello', nonce }); }
    catch { fail('stale_or_closed'); }
  }
  function onClose() { fail('closed'); }
  function onError() { fail('error'); }
  function onMessage(event: MessageEvent) {
    if (finished || disposed) return;
    try {
      if (!current()) throw new Error('stale');
      if (typeof event.data !== 'string' || event.data.length > 1024) throw new Error('frame');
      const message = JSON.parse(event.data);
      const keys = ['protocol', 'sessionId', 'checkpoint', 'seat', 'peerSeat', 'type', 'nonce'];
      if (!message || typeof message !== 'object' || Array.isArray(message)
        || Object.keys(message).length !== keys.length || !Object.keys(message).every(key => keys.includes(key))
        || message.protocol !== PROTOCOL || message.sessionId !== history.sessionId || message.checkpoint !== checkpoint
        || message.seat !== peerSeat || message.peerSeat !== seat
        || typeof message.nonce !== 'string' || !/^[0-9a-f]{32}$/.test(message.nonce)) throw new Error('binding');
      if (message.type === 'hello' && !remoteNonce) {
        // A message can be observed with an open channel before our open
        // callback runs. Keep outbound hello before ack in either event order.
        onOpen();
        if (disposed) return;
        remoteNonce = message.nonce;
        send({ ...base, type: 'ack', nonce: remoteNonce });
      } else if (message.type === 'ack' && remoteNonce && message.nonce === nonce) {
        // Reliable ordering ensures the peer processes our ack before any
        // subsequent history frames. No automatic signing occurs here.
        adapter = new PokerHistoryChannel(channel!, history);
        adapter.addEventListener('closed', onAdapterClosed);
        finished = true; clearStartup(); resolve(adapter);
      } else throw new Error('order');
    } catch (error) {
      const detail = error instanceof Error && ['stale', 'frame', 'binding', 'order'].includes(error.message) ? error.message : 'decode_or_send';
      fail(`handshake_${detail}`);
    }
  }
  function accept(value: RTCDataChannel) {
    if (disposed || finished || channel) { value.close(); return; }
    channel = value;
    clearInterval(interval); link.offSignal(onSignal);
    channel.addEventListener('message', onMessage);
    channel.addEventListener('close', onClose);
    channel.addEventListener('error', onError);
    channel.addEventListener('open', onOpen, { once: true });
    if (channel.readyState === 'open') onOpen();
  }
  function announce() {
    if (finished || disposed || channel) return;
    if (!current()) { fail('stale_or_closed'); return; }
    try { link.sendSignal({ ...base, type: 'registered' }); }
    catch { fail('send'); }
  }
  function onSignal(value: unknown) {
    if (finished || disposed || opened || seat > peerSeat) return;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    const message = value as Record<string, unknown>;
    const keys = ['protocol', 'sessionId', 'checkpoint', 'seat', 'peerSeat', 'type'];
    if (Object.keys(message).length !== keys.length || !Object.keys(message).every(key => keys.includes(key))
      || message.protocol !== PROTOCOL || message.type !== 'registered' || message.sessionId !== history.sessionId
      || message.checkpoint !== checkpoint || message.seat !== peerSeat || message.peerSeat !== seat) return;
    if (!current()) { fail('stale_or_closed'); return; }
    opened = true;
    try { link.openReliableChannel(POKER_HISTORY_CHANNEL); }
    catch { fail('open'); }
  }
  try {
    unregister = link.registerReliableChannel(POKER_HISTORY_CHANNEL, accept);
    link.onSignal(onSignal);
    timer = setTimeout(() => fail('timeout'), TIMEOUT_MS);
    interval = setInterval(announce, 500);
    announce();
  } catch { fail('registration'); }
  return { ready, closed, dispose };
}
