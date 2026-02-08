import { describe, it, expect, vi } from 'vitest';
import { EventBridge } from './EventBridge';
import type { CardInteractionEvent } from '../types';

describe('EventBridge', () => {
  it('emits events to subscribers', () => {
    const bridge = new EventBridge();
    const handler = vi.fn();
    bridge.on(handler);

    const event: CardInteractionEvent = {
      type: 'play',
      cardId: 'card-1',
      sourceZone: 'hand',
      targetZone: 'playArea',
      playerId: '0',
    };
    bridge.emit(event);

    expect(handler).toHaveBeenCalledWith(event);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('supports multiple subscribers', () => {
    const bridge = new EventBridge();
    const handler1 = vi.fn();
    const handler2 = vi.fn();
    bridge.on(handler1);
    bridge.on(handler2);

    const event: CardInteractionEvent = {
      type: 'draw',
      sourceZone: 'mainDeck',
      playerId: '0',
    };
    bridge.emit(event);

    expect(handler1).toHaveBeenCalledWith(event);
    expect(handler2).toHaveBeenCalledWith(event);
  });

  it('unsubscribes correctly', () => {
    const bridge = new EventBridge();
    const handler = vi.fn();
    const unsub = bridge.on(handler);

    unsub();

    bridge.emit({
      type: 'tap',
      cardId: 'card-1',
      playerId: '0',
    });

    expect(handler).not.toHaveBeenCalled();
  });

  it('tracks listener count', () => {
    const bridge = new EventBridge();
    expect(bridge.listenerCount).toBe(0);

    const unsub1 = bridge.on(vi.fn());
    expect(bridge.listenerCount).toBe(1);

    const unsub2 = bridge.on(vi.fn());
    expect(bridge.listenerCount).toBe(2);

    unsub1();
    expect(bridge.listenerCount).toBe(1);

    unsub2();
    expect(bridge.listenerCount).toBe(0);
  });

  it('destroy clears all listeners', () => {
    const bridge = new EventBridge();
    bridge.on(vi.fn());
    bridge.on(vi.fn());
    expect(bridge.listenerCount).toBe(2);

    bridge.destroy();
    expect(bridge.listenerCount).toBe(0);
  });

  it('does not crash when emitting with no listeners', () => {
    const bridge = new EventBridge();
    expect(() =>
      bridge.emit({ type: 'draw', sourceZone: 'mainDeck', playerId: '0' }),
    ).not.toThrow();
  });
});
