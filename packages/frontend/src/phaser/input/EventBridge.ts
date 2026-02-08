/**
 * EventBridge — Phaser → React communication channel.
 *
 * The Phaser scene emits CardInteractionEvents through this bridge.
 * React subscribes to events and maps them to boardgame.io moves.
 * This keeps Phaser as a pure visual layer with no game state mutations.
 */

import type { CardInteractionEvent, EventBridgeCallback } from '../types';

export class EventBridge {
  private listeners: Set<EventBridgeCallback> = new Set();

  /** Subscribe to interaction events. Returns an unsubscribe function. */
  on(callback: EventBridgeCallback): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  /** Emit an interaction event to all listeners. */
  emit(event: CardInteractionEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  /** Remove all listeners. Call on component unmount. */
  destroy(): void {
    this.listeners.clear();
  }

  /** Current number of listeners (useful for debugging). */
  get listenerCount(): number {
    return this.listeners.size;
  }
}
