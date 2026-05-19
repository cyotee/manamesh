import type { ManaMeshLibp2p } from '../../libp2p-config';
import { getTableKey } from './keys';
import type { TableRegistration } from './types';

const DHT_TIMEOUT_MS = 30_000;
const RECORD_TTL_MS = 5 * 60 * 1000;
const REPUBLISH_INTERVAL_MS = 2 * 60 * 1000;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export async function registerTable(
  libp2p: ManaMeshLibp2p,
  registration: TableRegistration,
): Promise<void> {
  const key = getTableKey(registration.gameType, registration.roomCode);
  const value = encoder.encode(JSON.stringify(registration));
  await libp2p.services.dht.put(key, value, {
    signal: AbortSignal.timeout(DHT_TIMEOUT_MS),
  });
}

export async function lookupTable(
  libp2p: ManaMeshLibp2p,
  gameType: string,
  roomCode: string,
): Promise<TableRegistration | null> {
  const key = getTableKey(gameType, roomCode);
  for await (const event of libp2p.services.dht.get(key, {
    signal: AbortSignal.timeout(DHT_TIMEOUT_MS),
  })) {
    if (event.name === 'VALUE') {
      return JSON.parse(decoder.decode(event.value)) as TableRegistration;
    }
  }
  return null;
}

export async function refreshTable(
  libp2p: ManaMeshLibp2p,
  registration: TableRegistration,
): Promise<void> {
  const updated = {
    ...registration,
    expiresAt: Date.now() + RECORD_TTL_MS,
    version: registration.version + 1,
  };
  await registerTable(libp2p, updated);
}

export class DHTTableAdapter {
  private libp2p: ManaMeshLibp2p;
  private registration: TableRegistration | null = null;
  private republishTimer: ReturnType<typeof setInterval> | null = null;

  constructor(libp2p: ManaMeshLibp2p) {
    this.libp2p = libp2p;
  }

  async createTable(registration: Omit<TableRegistration, 'expiresAt' | 'version'>): Promise<string> {
    this.registration = {
      ...registration,
      expiresAt: Date.now() + RECORD_TTL_MS,
      version: 1,
    };
    await registerTable(this.libp2p, this.registration);
    this.startRepublishing();
    return registration.roomCode;
  }

  private async republish(): Promise<void> {
    if (!this.registration) return;
    await refreshTable(this.libp2p, this.registration);
  }

  private startRepublishing(): void {
    this.stopRepublishing();
    this.republishTimer = setInterval(() => {
      this.republish().catch((err) => console.error('[DHT] Republish error:', err));
    }, REPUBLISH_INTERVAL_MS);
  }

  stopRepublishing(): void {
    if (this.republishTimer) {
      clearInterval(this.republishTimer);
      this.republishTimer = null;
    }
  }

  close(): void {
    this.stopRepublishing();
    this.registration = null;
  }
}
