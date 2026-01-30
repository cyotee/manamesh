/**
 * Card Rendering Settings Hook
 *
 * Manages user preferences for card rendering:
 * - Toggle between HTML text rendering and IPFS image loading
 * - Custom IPFS CID for asset packs
 * - Persists settings to localStorage
 */

import { useState, useEffect, useCallback } from 'react';
import { STANDARD_CARDS_CID } from '../assets/packs/standard-cards';

const STORAGE_KEY = 'manamesh-card-settings';

export type CardRenderMode = 'html' | 'ipfs';

export interface CardSettings {
  /** Rendering mode: 'html' for text-based, 'ipfs' for image-based */
  renderMode: CardRenderMode;
  /** Custom IPFS CID for asset pack (used when renderMode is 'ipfs') */
  customCid: string;
}

const DEFAULT_SETTINGS: CardSettings = {
  renderMode: 'ipfs',
  customCid: STANDARD_CARDS_CID,
};

/**
 * Load settings from localStorage
 */
function loadSettings(): CardSettings {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return {
        ...DEFAULT_SETTINGS,
        ...parsed,
      };
    }
  } catch (error) {
    console.warn('Failed to load card settings:', error);
  }
  return DEFAULT_SETTINGS;
}

/**
 * Save settings to localStorage
 */
function saveSettings(settings: CardSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (error) {
    console.warn('Failed to save card settings:', error);
  }
}

export interface UseCardSettingsResult {
  /** Current settings */
  settings: CardSettings;
  /** Whether IPFS images are enabled */
  useImages: boolean;
  /** The effective CID to use (custom or default) */
  effectiveCid: string;
  /** Set the rendering mode */
  setRenderMode: (mode: CardRenderMode) => void;
  /** Set a custom CID */
  setCustomCid: (cid: string) => void;
  /** Reset CID to default */
  resetCidToDefault: () => void;
  /** Reset all settings to defaults */
  resetAllSettings: () => void;
  /** Check if current CID is the default */
  isDefaultCid: boolean;
}

/**
 * Hook to manage card rendering settings
 */
export function useCardSettings(): UseCardSettingsResult {
  const [settings, setSettings] = useState<CardSettings>(loadSettings);

  // Persist settings when they change
  useEffect(() => {
    saveSettings(settings);
  }, [settings]);

  const setRenderMode = useCallback((mode: CardRenderMode) => {
    setSettings((prev) => ({ ...prev, renderMode: mode }));
  }, []);

  const setCustomCid = useCallback((cid: string) => {
    setSettings((prev) => ({ ...prev, customCid: cid }));
  }, []);

  const resetCidToDefault = useCallback(() => {
    setSettings((prev) => ({ ...prev, customCid: STANDARD_CARDS_CID }));
  }, []);

  const resetAllSettings = useCallback(() => {
    setSettings(DEFAULT_SETTINGS);
  }, []);

  const useImages = settings.renderMode === 'ipfs';
  const effectiveCid = settings.customCid || STANDARD_CARDS_CID;
  const isDefaultCid = settings.customCid === STANDARD_CARDS_CID;

  return {
    settings,
    useImages,
    effectiveCid,
    setRenderMode,
    setCustomCid,
    resetCidToDefault,
    resetAllSettings,
    isDefaultCid,
  };
}

/**
 * Get the default CID for external use
 */
export function getDefaultCid(): string {
  return STANDARD_CARDS_CID;
}
