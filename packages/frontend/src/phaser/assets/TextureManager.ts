/**
 * TextureManager — Bridges React's asset pipeline with Phaser's texture cache.
 *
 * React resolves card image URLs via the useCardImage hook. This manager
 * loads those URLs into Phaser's texture system so CardSprites can reference them.
 */

import Phaser from 'phaser';

export class TextureManager {
  private scene: Phaser.Scene;
  private loadedKeys: Set<string> = new Set();
  private pendingLoads: Set<string> = new Set();

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  /**
   * Ensure a card image is loaded into Phaser's texture cache.
   * If already loaded, this is a no-op. If loading, skips duplicate requests.
   *
   * @param cardId - Card identifier
   * @param url - Resolved image URL (from React's useCardImage hook)
   */
  ensureLoaded(cardId: string, url: string): void {
    const key = `card_${cardId}`;

    if (this.loadedKeys.has(key) || this.pendingLoads.has(key)) return;
    if (this.scene.textures.exists(key)) {
      this.loadedKeys.add(key);
      return;
    }

    this.pendingLoads.add(key);

    // Use Phaser's loader to load the image
    this.scene.load.image(key, url);
    this.scene.load.once('complete', () => {
      this.pendingLoads.delete(key);
      if (this.scene.textures.exists(key)) {
        this.loadedKeys.add(key);
      }
    });

    // Start the loader if it's idle
    if (!this.scene.load.isLoading()) {
      this.scene.load.start();
    }
  }

  /**
   * Load the card back image.
   */
  ensureCardBackLoaded(url: string): void {
    const key = 'card_back';
    if (this.loadedKeys.has(key) || this.scene.textures.exists(key)) {
      this.loadedKeys.add(key);
      return;
    }

    this.scene.load.image(key, url);
    this.scene.load.once('complete', () => {
      this.loadedKeys.add(key);
    });
    if (!this.scene.load.isLoading()) {
      this.scene.load.start();
    }
  }

  /**
   * Sync the texture cache with a new set of card image URLs.
   * Loads any missing textures.
   */
  syncImages(cardImages: Record<string, string>): void {
    for (const [cardId, url] of Object.entries(cardImages)) {
      if (url) {
        this.ensureLoaded(cardId, url);
      }
    }
  }

  /** Check if a card texture is loaded. */
  isLoaded(cardId: string): boolean {
    return this.loadedKeys.has(`card_${cardId}`);
  }

  /** Get the texture key for a card. */
  getKey(cardId: string): string {
    return `card_${cardId}`;
  }

  /** Number of loaded textures. */
  get loadedCount(): number {
    return this.loadedKeys.size;
  }

  /** Number of pending loads. */
  get pendingCount(): number {
    return this.pendingLoads.size;
  }
}
