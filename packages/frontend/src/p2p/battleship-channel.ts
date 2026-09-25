import type { P2PChannel } from '@cyotee/boardgameio-p2p/channel';

const PREFIX = 'manamesh:battleship-signal:v1:';
const MAX_SIGNAL_BYTES = 128 * 1024;

/** Multiplex board proofs and engine traffic over an established peer channel. */
export function createBattleshipChannel(channel: P2PChannel) {
  const handlers = new Set<(payload: unknown) => void>();
  const events: P2PChannel['events'] = {
    onMessage: () => {},
    onConnectionStateChange: () => {},
  };
  let restore: (() => void) | undefined;
  const activate = () => {
    if (restore) return;
    const previousMessage = channel.events.onMessage;
    const previousState = channel.events.onConnectionStateChange;
    const onMessage = (data: string) => {
      if (!data.startsWith(PREFIX)) {
        previousMessage(data);
        events.onMessage(data);
        return;
      }
      if (data.length > MAX_SIGNAL_BYTES || new TextEncoder().encode(data).length > MAX_SIGNAL_BYTES) return;
      let payload: unknown;
      try { payload = JSON.parse(data.slice(PREFIX.length)); } catch { return; }
      for (const handler of handlers) handler(payload);
    };
    const onState: typeof previousState = state => {
      previousState(state);
      events.onConnectionStateChange(state);
    };
    channel.events.onMessage = onMessage;
    channel.events.onConnectionStateChange = onState;
    restore = () => {
      if (channel.events.onMessage === onMessage) channel.events.onMessage = previousMessage;
      if (channel.events.onConnectionStateChange === onState) channel.events.onConnectionStateChange = previousState;
      restore = undefined;
    };
  };
  return {
    events,
    send: (data: string) => channel.send(data),
    isConnected: () => channel.isConnected(),
    sendSignal(payload: unknown) {
      const json = JSON.stringify(payload);
      if (json === undefined) throw new Error('Signal must be JSON serializable');
      const frame = PREFIX + json;
      if (new TextEncoder().encode(frame).length > MAX_SIGNAL_BYTES) throw new Error('Battleship signal too large');
      channel.send(frame);
    },
    onSignal: (handler: (payload: unknown) => void) => { handlers.add(handler); },
    offSignal: (handler: (payload: unknown) => void) => { handlers.delete(handler); },
    activate,
    dispose() { restore?.(); },
  };
}
