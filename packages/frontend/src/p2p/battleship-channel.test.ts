import { describe, expect, it, vi } from 'vitest';
import type { P2PChannel } from '@cyotee/boardgameio-p2p/channel';
import { createBattleshipChannel } from './battleship-channel';

function pair() {
  const events = () => ({ onMessage: vi.fn(), onConnectionStateChange: vi.fn() });
  const left: P2PChannel = { events: events(), isConnected: () => true, send: data => right.events.onMessage(data) };
  const right: P2PChannel = { events: events(), isConnected: () => true, send: data => left.events.onMessage(data) };
  const a = createBattleshipChannel(left);
  const b = createBattleshipChannel(right);
  a.activate(); b.activate();
  return { left, right, a, b };
}

describe('Battleship peer channel', () => {
  it('delivers bidirectional signals separately from engine updates', () => {
    const { a, b } = pair();
    const signalA = vi.fn(); const signalB = vi.fn();
    a.onSignal(signalA); b.onSignal(signalB);
    const engineA = vi.fn(); const engineB = vi.fn();
    a.events.onMessage = engineA; b.events.onMessage = engineB;
    const guess = { type: 'bs_guess', coord: { x: 1, y: 2 } };
    const reveal = { type: 'bs_reveal', bit: 1, proof: [{ hash: 'abc', position: 'left' }] };
    a.sendSignal(guess); b.sendSignal(reveal);
    expect(signalB).toHaveBeenCalledWith(guess);
    expect(signalA).toHaveBeenCalledWith(reveal);
    expect(engineA).not.toHaveBeenCalled(); expect(engineB).not.toHaveBeenCalled();
    a.send('{"type":"sync"}'); b.send('{"type":"action"}');
    expect(engineB).toHaveBeenCalledTimes(1); expect(engineB).toHaveBeenCalledWith('{"type":"sync"}');
    expect(engineA).toHaveBeenCalledTimes(1); expect(engineA).toHaveBeenCalledWith('{"type":"action"}');
    expect(signalA).toHaveBeenCalledTimes(1); expect(signalB).toHaveBeenCalledTimes(1);
    expect(a.isConnected()).toBe(true);
  });

  it('drops malformed and oversized signals without forwarding them to the engine', () => {
    const { left, a, b } = pair();
    const signal = vi.fn(); const engine = vi.fn();
    b.onSignal(signal); b.events.onMessage = engine;
    left.send('manamesh:battleship-signal:v1:{bad');
    left.send('manamesh:battleship-signal:v1:' + JSON.stringify('界'.repeat(50_000)));
    expect(() => a.sendSignal('界'.repeat(50_000))).toThrow('too large');
    expect(() => a.sendSignal(undefined)).toThrow('JSON serializable');
    expect(signal).not.toHaveBeenCalled(); expect(engine).not.toHaveBeenCalled();
    a.sendSignal({ type: 'bs_guess' });
    expect(signal).toHaveBeenCalledTimes(1);
  });

  it('restores callbacks and supports effect reactivation without duplicate deliveries', () => {
    const { left, a } = pair();
    const received = vi.fn(); const state = vi.fn();
    a.events.onMessage = received; a.events.onConnectionStateChange = state;
    a.activate(); a.activate();
    left.events.onMessage('one');
    left.events.onConnectionStateChange('connected');
    expect(received).toHaveBeenCalledTimes(1); expect(received).toHaveBeenCalledWith('one');
    expect(state).toHaveBeenCalledTimes(1); expect(state).toHaveBeenCalledWith('connected');
    a.dispose(); a.dispose();
    left.events.onMessage('two');
    expect(received).toHaveBeenCalledTimes(1);
    a.activate(); left.events.onMessage('three');
    expect(received).toHaveBeenCalledTimes(2);
  });

  it('unsubscribes board listeners when they unmount', () => {
    const { a, b } = pair();
    const received = vi.fn();
    b.onSignal(received); b.offSignal(received);
    a.sendSignal({ type: 'bs_guess' });
    expect(received).not.toHaveBeenCalled();
  });
});
