/**
 * Transport Manager
 *
 * Coordinates multiple transport types with sequential fallback.
 * Eliminates STUN server dependency by preferring local/relay transports.
 */

import type {
  TransportType,
  TransportConfig,
  TransportStatus,
  TransportResult,
  TransportAdapter,
  TransportLogger,
  HostSession,
  HostOptions,
  JoinOptions,
} from './transports/types';
import {
  DEFAULT_TRANSPORT_CONFIG,
  TRANSPORT_PRIORITY,
  TRANSPORT_NAMES,
  createTransportLogger,
} from './transports/types';
import { LANTransport } from './transports/lan-transport';
import { DirectIPTransport } from './transports/direct-ip-transport';
import { RelayTransport } from './transports/relay-transport';
import { JoinCodeTransport } from './transports/joincode-transport';

/** Timeout per transport attempt (ms) */
const TRANSPORT_TIMEOUT = 5000;

/** Local storage key for config */
const STORAGE_KEY = 'manamesh_transport_config';

/**
 * Transport manager - coordinates multiple transport adapters
 */
export class TransportManager {
  private config: TransportConfig;
  private status: TransportStatus = { state: 'idle' };
  private statusListeners: Set<(status: TransportStatus) => void> = new Set();
  private log: TransportLogger;

  // Transport adapters
  private adapters: Map<TransportType, TransportAdapter> = new Map();
  private activeAdapter: TransportAdapter | null = null;
  private activeSession: HostSession | null = null;

  constructor(config?: Partial<TransportConfig>) {
    // Load config from storage, URL params, or use defaults
    this.config = this.loadConfig(config);
    this.log = createTransportLogger(this.config.verboseLogging);

    // Initialize adapters
    this.initializeAdapters();

    this.log('Transport manager initialized with config:', this.config);
  }

  /**
   * Load configuration from localStorage, URL params, or defaults
   */
  private loadConfig(override?: Partial<TransportConfig>): TransportConfig {
    // Start with defaults
    let config = { ...DEFAULT_TRANSPORT_CONFIG };

    // Load from localStorage
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.version === 1) {
          config = {
            enabled: { ...config.enabled, ...parsed.enabled },
            forced: parsed.forced ?? null,
            verboseLogging: parsed.verboseLogging ?? false,
          };
        }
      }
    } catch (e) {
      console.warn('[Transport] Failed to load config from localStorage:', e);
    }

    // Parse URL params
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const transportParam = params.get('transport');

      if (transportParam) {
        if (transportParam === 'all') {
          // Reset to all enabled
          config.enabled = { ...DEFAULT_TRANSPORT_CONFIG.enabled };
          config.forced = null;
        } else {
          const transports = transportParam.split(',') as TransportType[];
          const validTransports = transports.filter(t =>
            ['lan', 'directIp', 'relay', 'joinCode'].includes(t)
          );

          if (validTransports.length === 1) {
            // Single transport = force mode
            config.forced = validTransports[0];
          } else if (validTransports.length > 1) {
            // Multiple transports = enable only these
            config.enabled = {
              lan: validTransports.includes('lan'),
              directIp: validTransports.includes('directIp'),
              relay: validTransports.includes('relay'),
              joinCode: validTransports.includes('joinCode'),
            };
            config.forced = null;
          }
        }
      }

      // Check for verbose param
      if (params.get('verbose') === 'true') {
        config.verboseLogging = true;
      }
    }

    // Apply override
    if (override) {
      if (override.enabled) {
        config.enabled = { ...config.enabled, ...override.enabled };
      }
      if (override.forced !== undefined) {
        config.forced = override.forced;
      }
      if (override.verboseLogging !== undefined) {
        config.verboseLogging = override.verboseLogging;
      }
    }

    return config;
  }

  /**
   * Initialize transport adapters
   */
  private initializeAdapters(): void {
    const verbose = this.config.verboseLogging;

    this.adapters.set('lan', new LANTransport(verbose));
    this.adapters.set('directIp', new DirectIPTransport(verbose));
    this.adapters.set('relay', new RelayTransport(verbose));
    this.adapters.set('joinCode', new JoinCodeTransport(verbose));
  }

  /**
   * Get current configuration
   */
  getConfig(): TransportConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  setConfig(update: Partial<TransportConfig>): void {
    if (update.enabled) {
      this.config.enabled = { ...this.config.enabled, ...update.enabled };
    }
    if (update.forced !== undefined) {
      this.config.forced = update.forced;
    }
    if (update.verboseLogging !== undefined) {
      this.config.verboseLogging = update.verboseLogging;
      this.log = createTransportLogger(update.verboseLogging);
    }

    this.saveConfig();
    this.log('Config updated:', this.config);
  }

  /**
   * Save configuration to localStorage
   */
  private saveConfig(): void {
    try {
      const stored = {
        version: 1,
        enabled: this.config.enabled,
        forced: this.config.forced,
        verboseLogging: this.config.verboseLogging,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    } catch (e) {
      console.warn('[Transport] Failed to save config:', e);
    }
  }

  /**
   * Reset configuration to defaults
   */
  resetConfig(): void {
    this.config = { ...DEFAULT_TRANSPORT_CONFIG };
    localStorage.removeItem(STORAGE_KEY);
    this.log = createTransportLogger(false);
    this.log('Config reset to defaults');
  }

  /**
   * Get current status
   */
  getStatus(): TransportStatus {
    return this.status;
  }

  /**
   * Subscribe to status changes
   */
  onStatusChange(callback: (status: TransportStatus) => void): () => void {
    this.statusListeners.add(callback);
    return () => this.statusListeners.delete(callback);
  }

  /**
   * Update and broadcast status
   */
  private setStatus(status: TransportStatus): void {
    this.status = status;
    this.statusListeners.forEach(cb => cb(status));
  }

  /**
   * Get enabled transports in priority order
   */
  private getEnabledTransports(): TransportType[] {
    if (this.config.forced) {
      return [this.config.forced];
    }

    return TRANSPORT_PRIORITY.filter(t => this.config.enabled[t]);
  }

  /**
   * Create a host session, trying transports in order
   */
  async createHost(options?: HostOptions): Promise<HostSession> {
    this.cleanup();

    const transports = this.getEnabledTransports();
    this.log('Creating host with transports:', transports);

    if (transports.length === 0) {
      throw new Error('No transports enabled');
    }

    let lastError: Error | null = null;

    for (let i = 0; i < transports.length; i++) {
      const transportType = transports[i];
      const adapter = this.adapters.get(transportType);

      if (!adapter) {
        this.log(`Adapter not found for ${transportType}`);
        continue;
      }

      this.setStatus({
        state: 'connecting',
        transport: transportType,
        attempt: i + 1,
      });

      this.log(`Trying ${TRANSPORT_NAMES[transportType]}...`);

      try {
        // Check availability
        const available = await adapter.isAvailable();
        if (!available) {
          this.log(`${TRANSPORT_NAMES[transportType]} not available`);
          continue;
        }

        // Create host session
        const session = await adapter.createHost(options);
        this.activeAdapter = adapter;
        this.activeSession = session;

        this.log(`Host created via ${TRANSPORT_NAMES[transportType]}`);
        this.setStatus({
          state: 'connecting',
          transport: transportType,
          attempt: i + 1,
        });

        return session;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.log(`${TRANSPORT_NAMES[transportType]} failed:`, lastError.message);
      }
    }

    const errorMsg = lastError?.message ?? 'All transports failed';
    this.setStatus({
      state: 'failed',
      lastAttempt: transports[transports.length - 1],
      error: errorMsg,
    });

    throw new Error(errorMsg);
  }

  /**
   * Join a session, trying transports in order
   */
  async joinSession(target: string, options?: JoinOptions): Promise<void> {
    this.cleanup();

    const transports = this.getEnabledTransports();
    this.log('Joining session with transports:', transports);

    if (transports.length === 0) {
      throw new Error('No transports enabled');
    }

    const timeout = options?.timeout ?? TRANSPORT_TIMEOUT;
    let lastError: Error | null = null;

    for (let i = 0; i < transports.length; i++) {
      const transportType = transports[i];
      const adapter = this.adapters.get(transportType);

      if (!adapter) {
        this.log(`Adapter not found for ${transportType}`);
        continue;
      }

      this.setStatus({
        state: 'connecting',
        transport: transportType,
        attempt: i + 1,
      });

      this.log(`Trying ${TRANSPORT_NAMES[transportType]}...`);

      try {
        // Check availability
        const available = await adapter.isAvailable();
        if (!available) {
          this.log(`${TRANSPORT_NAMES[transportType]} not available`);
          continue;
        }

        // Try to join
        await adapter.joinSession(target, { timeout });
        this.activeAdapter = adapter;

        this.log(`Joined via ${TRANSPORT_NAMES[transportType]}`);
        this.setStatus({
          state: 'connected',
          transport: transportType,
        });

        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.log(`${TRANSPORT_NAMES[transportType]} failed:`, lastError.message);
      }
    }

    const errorMsg = lastError?.message ?? 'All transports failed';
    this.setStatus({
      state: 'failed',
      lastAttempt: transports[transports.length - 1],
      error: errorMsg,
    });

    throw new Error(errorMsg);
  }

  /**
   * Get the active transport adapter
   */
  getActiveAdapter(): TransportAdapter | null {
    return this.activeAdapter;
  }

  /**
   * Get a specific adapter
   */
  getAdapter<T extends TransportAdapter>(type: TransportType): T | null {
    return (this.adapters.get(type) as T) ?? null;
  }

  /**
   * Get the active session
   */
  getActiveSession(): HostSession | null {
    return this.activeSession;
  }

  /**
   * Clean up all resources
   */
  cleanup(): void {
    if (this.activeSession) {
      this.activeSession.cancel();
      this.activeSession = null;
    }

    this.adapters.forEach(adapter => adapter.cleanup());
    this.activeAdapter = null;

    this.setStatus({ state: 'idle' });
    this.log('Transport manager cleaned up');
  }

  /**
   * Check which transports are available
   */
  async checkAvailability(): Promise<Record<TransportType, boolean>> {
    const results: Record<TransportType, boolean> = {
      lan: false,
      directIp: false,
      relay: false,
      joinCode: false,
    };

    await Promise.all(
      TRANSPORT_PRIORITY.map(async (type) => {
        const adapter = this.adapters.get(type);
        if (adapter) {
          results[type] = await adapter.isAvailable();
        }
      })
    );

    this.log('Transport availability:', results);
    return results;
  }
}

// Singleton instance
let managerInstance: TransportManager | null = null;

/**
 * Get the singleton transport manager instance
 */
export function getTransportManager(): TransportManager {
  if (!managerInstance) {
    managerInstance = new TransportManager();
  }
  return managerInstance;
}

/**
 * Reset the transport manager (for testing)
 */
export function resetTransportManager(): void {
  if (managerInstance) {
    managerInstance.cleanup();
    managerInstance = null;
  }
}
