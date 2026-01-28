/**
 * Transport Types
 *
 * Common types for the hybrid transport system.
 */

import type { PeerConnection, ConnectionOffer } from '../webrtc';

/**
 * Available transport types in priority order
 */
export type TransportType = 'lan' | 'directIp' | 'relay' | 'joinCode';

/**
 * All transport types in priority order
 */
export const TRANSPORT_PRIORITY: TransportType[] = ['lan', 'directIp', 'relay', 'joinCode'];

/**
 * Human-readable transport names
 */
export const TRANSPORT_NAMES: Record<TransportType, string> = {
  lan: 'LAN / Local Network',
  directIp: 'Direct IP',
  relay: 'Circuit Relay',
  joinCode: 'Join Code',
};

/**
 * Transport badge colors
 */
export const TRANSPORT_COLORS: Record<TransportType, string> = {
  lan: '#22c55e',      // green - best/local
  directIp: '#3b82f6', // blue - direct
  relay: '#f59e0b',    // amber - relayed
  joinCode: '#ef4444', // red - fallback with STUN
};

/**
 * Transport configuration
 */
export interface TransportConfig {
  /** Which transports are enabled */
  enabled: Record<TransportType, boolean>;
  /** Force a specific transport (null = auto-select) */
  forced: TransportType | null;
  /** Enable verbose logging */
  verboseLogging: boolean;
}

/**
 * Default transport configuration
 */
export const DEFAULT_TRANSPORT_CONFIG: TransportConfig = {
  enabled: {
    lan: true,
    directIp: true,
    relay: true,
    joinCode: true,
  },
  forced: null,
  verboseLogging: false,
};

/**
 * Stored configuration schema (for localStorage)
 */
export interface StoredTransportConfig {
  version: 1;
  enabled: Record<TransportType, boolean>;
  forced: TransportType | null;
  verboseLogging: boolean;
}

/**
 * Transport connection status
 */
export type TransportStatus =
  | { state: 'idle' }
  | { state: 'connecting'; transport: TransportType; attempt: number }
  | { state: 'connected'; transport: TransportType; latency?: number }
  | { state: 'failed'; lastAttempt: TransportType; error: string }
  | { state: 'disconnected' };

/**
 * Result of a successful transport connection
 */
export interface TransportResult {
  /** Which transport succeeded */
  type: TransportType;
  /** The established connection */
  connection: PeerConnection;
  /** Estimated latency if available */
  latency?: number;
}

/**
 * Transport adapter interface
 *
 * Each transport type implements this interface to provide
 * a consistent API for the transport manager.
 */
export interface TransportAdapter {
  /** Transport type identifier */
  readonly type: TransportType;

  /** Human-readable name */
  readonly name: string;

  /**
   * Check if this transport is available in the current environment.
   * Some transports may not be available (e.g., mDNS in plain browsers).
   */
  isAvailable(): Promise<boolean>;

  /**
   * Create a hosting session (for the host/creator side).
   * Returns connection info that can be shared with guests.
   */
  createHost(options?: HostOptions): Promise<HostSession>;

  /**
   * Join an existing session (for the guest/joiner side).
   */
  joinSession(target: string, options?: JoinOptions): Promise<PeerConnection>;

  /**
   * Clean up any resources used by this transport.
   */
  cleanup(): void;
}

/**
 * Options for creating a host session
 */
export interface HostOptions {
  /** Timeout for waiting for guests (ms) */
  timeout?: number;
  /** Callback when a guest connects */
  onGuestConnected?: (connection: PeerConnection) => void;
}

/**
 * Options for joining a session
 */
export interface JoinOptions {
  /** Timeout for connection attempt (ms) */
  timeout?: number;
}

/**
 * A hosting session that can accept guest connections
 */
export interface HostSession {
  /** Transport type */
  type: TransportType;

  /** Connection identifier (room code, IP:port, etc.) */
  connectionId: string;

  /** The peer connection once a guest connects */
  connection: PeerConnection | null;

  /** Wait for a guest to connect */
  waitForGuest(timeout?: number): Promise<PeerConnection>;

  /** Cancel the host session */
  cancel(): void;
}

/**
 * Transport event callbacks
 */
export interface TransportEvents {
  onStatusChange: (status: TransportStatus) => void;
  onMessage: (data: string) => void;
  onError: (error: Error) => void;
}

/**
 * Logger function type for verbose logging
 */
export type TransportLogger = (message: string, ...args: unknown[]) => void;

/**
 * Create a transport logger
 */
export function createTransportLogger(enabled: boolean): TransportLogger {
  return (message: string, ...args: unknown[]) => {
    if (enabled) {
      console.log(`[Transport] ${message}`, ...args);
    }
  };
}
