/**
 * useTransportConfig Hook
 *
 * React hook for managing transport configuration state.
 * Handles persistence, URL params, and reactive updates.
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import type { TransportType, TransportConfig, TransportStatus } from '../p2p/transports/types';
import { DEFAULT_TRANSPORT_CONFIG, TRANSPORT_PRIORITY, TRANSPORT_NAMES, TRANSPORT_COLORS } from '../p2p/transports/types';
import { getTransportManager } from '../p2p/transport-manager';

/**
 * Hook return type
 */
export interface UseTransportConfigReturn {
  /** Current config */
  config: TransportConfig;
  /** Current status */
  status: TransportStatus;
  /** Enable/disable a specific transport */
  setTransportEnabled: (transport: TransportType, enabled: boolean) => void;
  /** Force a specific transport (or null for auto) */
  setForcedTransport: (transport: TransportType | null) => void;
  /** Toggle verbose logging */
  setVerboseLogging: (enabled: boolean) => void;
  /** Reset to defaults */
  resetConfig: () => void;
  /** Check if a transport is enabled */
  isEnabled: (transport: TransportType) => boolean;
  /** Check if in forced mode */
  isForced: boolean;
  /** Get transport display info */
  getTransportInfo: (transport: TransportType) => {
    name: string;
    color: string;
    enabled: boolean;
    forced: boolean;
  };
  /** All available transports with info */
  transports: Array<{
    type: TransportType;
    name: string;
    color: string;
    enabled: boolean;
    forced: boolean;
  }>;
}

/**
 * Hook for managing transport configuration
 */
export function useTransportConfig(): UseTransportConfigReturn {
  const manager = useMemo(() => getTransportManager(), []);

  const [config, setConfig] = useState<TransportConfig>(manager.getConfig());
  const [status, setStatus] = useState<TransportStatus>(manager.getStatus());

  // Subscribe to status changes
  useEffect(() => {
    const unsubscribe = manager.onStatusChange(setStatus);
    return unsubscribe;
  }, [manager]);

  // Sync config from manager periodically (in case of external changes)
  useEffect(() => {
    const interval = setInterval(() => {
      const currentConfig = manager.getConfig();
      setConfig(prev => {
        if (JSON.stringify(prev) !== JSON.stringify(currentConfig)) {
          return currentConfig;
        }
        return prev;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [manager]);

  const setTransportEnabled = useCallback((transport: TransportType, enabled: boolean) => {
    manager.setConfig({
      enabled: { ...config.enabled, [transport]: enabled },
    });
    setConfig(manager.getConfig());
  }, [manager, config.enabled]);

  const setForcedTransport = useCallback((transport: TransportType | null) => {
    manager.setConfig({ forced: transport });
    setConfig(manager.getConfig());
  }, [manager]);

  const setVerboseLogging = useCallback((enabled: boolean) => {
    manager.setConfig({ verboseLogging: enabled });
    setConfig(manager.getConfig());
  }, [manager]);

  const resetConfig = useCallback(() => {
    manager.resetConfig();
    setConfig(manager.getConfig());
  }, [manager]);

  const isEnabled = useCallback((transport: TransportType) => {
    return config.enabled[transport];
  }, [config.enabled]);

  const isForced = useMemo(() => config.forced !== null, [config.forced]);

  const getTransportInfo = useCallback((transport: TransportType) => ({
    name: TRANSPORT_NAMES[transport],
    color: TRANSPORT_COLORS[transport],
    enabled: config.enabled[transport],
    forced: config.forced === transport,
  }), [config]);

  const transports = useMemo(() =>
    TRANSPORT_PRIORITY.map(type => ({
      type,
      name: TRANSPORT_NAMES[type],
      color: TRANSPORT_COLORS[type],
      enabled: config.enabled[type],
      forced: config.forced === type,
    })),
    [config]
  );

  return {
    config,
    status,
    setTransportEnabled,
    setForcedTransport,
    setVerboseLogging,
    resetConfig,
    isEnabled,
    isForced,
    getTransportInfo,
    transports,
  };
}

/**
 * Parse transport config from URL parameters
 */
export function parseTransportParams(): Partial<TransportConfig> | null {
  if (typeof window === 'undefined') return null;

  const params = new URLSearchParams(window.location.search);
  const transportParam = params.get('transport');

  if (!transportParam) return null;

  if (transportParam === 'all') {
    return {
      enabled: { ...DEFAULT_TRANSPORT_CONFIG.enabled },
      forced: null,
    };
  }

  const transports = transportParam.split(',') as TransportType[];
  const validTransports = transports.filter(t =>
    ['lan', 'directIp', 'relay', 'joinCode'].includes(t)
  );

  if (validTransports.length === 1) {
    return { forced: validTransports[0] };
  }

  if (validTransports.length > 1) {
    return {
      enabled: {
        lan: validTransports.includes('lan'),
        directIp: validTransports.includes('directIp'),
        relay: validTransports.includes('relay'),
        joinCode: validTransports.includes('joinCode'),
      },
      forced: null,
    };
  }

  return null;
}

/**
 * Generate URL with transport params
 */
export function generateTransportUrl(config: Partial<TransportConfig>): string {
  const url = new URL(window.location.href);

  if (config.forced) {
    url.searchParams.set('transport', config.forced);
  } else if (config.enabled) {
    const enabled = TRANSPORT_PRIORITY.filter(t => config.enabled?.[t]);
    if (enabled.length === TRANSPORT_PRIORITY.length) {
      url.searchParams.delete('transport');
    } else {
      url.searchParams.set('transport', enabled.join(','));
    }
  }

  return url.toString();
}
