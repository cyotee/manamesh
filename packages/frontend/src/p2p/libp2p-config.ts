/**
 * libp2p Configuration for Browser
 * Configures libp2p with WebRTC transport, DHT, and public bootstrap nodes
 */

import { createLibp2p, Libp2p } from 'libp2p';
import { webRTC } from '@libp2p/webrtc';
import { webSockets } from '@libp2p/websockets';
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2';
import { kadDHT, type KadDHT } from '@libp2p/kad-dht';
import { bootstrap } from '@libp2p/bootstrap';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { identify } from '@libp2p/identify';
import { ping } from '@libp2p/ping';
import { resolveBootstrapNodes } from './bootstrap-resolver';

export const DHT_NAMESPACE = '/manamesh/1.0.0';
export const ROOM_TOPIC = `${DHT_NAMESPACE}/rooms`;
export const PUBLIC_GAMES_TOPIC = `${DHT_NAMESPACE}/public-games`;

export interface Libp2pServices {
  dht: KadDHT;
  identify: ReturnType<typeof identify>;
}

export type ManaMeshLibp2p = Libp2p<Libp2pServices>;

let libp2pInstance: ManaMeshLibp2p | null = null;

export async function createNode(): Promise<ManaMeshLibp2p> {
  if (libp2pInstance) {
    return libp2pInstance;
  }

  console.log('[libp2p] Creating node...');
  const bootstrapNodes = await resolveBootstrapNodes();
  console.log('[libp2p] Using bootstrap nodes:', bootstrapNodes.length);

  const node = await createLibp2p({
    addresses: {
      listen: ['/p2p-circuit', '/webrtc'],
    },
    transports: [
      webSockets(),
      webRTC(),
      circuitRelayTransport(),
    ],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    peerDiscovery: [
      bootstrap({ list: [...bootstrapNodes] }),
    ],

    // Services
    services: {
      // DHT for peer/content discovery
      dht: kadDHT({
        // Client mode since browsers can't be servers
        clientMode: true,
      }),
      // Identify protocol for peer info exchange
      identify: identify(),
      // Ping protocol (required by DHT)
      ping: ping(),
    },
  });

  // Start the node
  await node.start();
  console.log('[libp2p] Node started with peer ID:', node.peerId.toString());

  // Log connection events
  node.addEventListener('peer:connect', (evt) => {
    console.log('[libp2p] Connected to peer:', evt.detail.toString());
  });

  node.addEventListener('peer:disconnect', (evt) => {
    console.log('[libp2p] Disconnected from peer:', evt.detail.toString());
  });

  libp2pInstance = node;
  return node;
}

/**
 * Get the existing libp2p node instance
 * Returns null if not created yet
 */
export function getNode(): ManaMeshLibp2p | null {
  return libp2pInstance;
}

/**
 * Stop the libp2p node and clean up
 */
export async function stopNode(): Promise<void> {
  if (libp2pInstance) {
    console.log('[libp2p] Stopping node...');
    await libp2pInstance.stop();
    libp2pInstance = null;
    console.log('[libp2p] Node stopped');
  }
}

/**
 * Check if the node is connected to any peers
 */
export function isConnectedToPeers(): boolean {
  if (!libp2pInstance) return false;
  return libp2pInstance.getConnections().length > 0;
}

/**
 * Get the number of connected peers
 */
export function getConnectedPeerCount(): number {
  if (!libp2pInstance) return 0;
  return libp2pInstance.getConnections().length;
}

/**
 * Generate a key for storing/retrieving a room in the DHT
 */
export function getRoomKey(roomCode: string): Uint8Array {
  const encoder = new TextEncoder();
  return encoder.encode(`${ROOM_TOPIC}/${roomCode.toUpperCase()}`);
}

/**
 * Generate the key for the public games listing
 */
export function getPublicGamesKey(): Uint8Array {
  const encoder = new TextEncoder();
  return encoder.encode(PUBLIC_GAMES_TOPIC);
}

/**
 * Generate the key for the public games index
 * The index stores a list of recent room codes for discovery
 */
export function getPublicGamesIndexKey(): Uint8Array {
  const encoder = new TextEncoder();
  return encoder.encode(`${PUBLIC_GAMES_TOPIC}/index`);
}

/**
 * Generate a key for a specific public game entry
 */
export function getPublicGameKey(roomCode: string): Uint8Array {
  const encoder = new TextEncoder();
  return encoder.encode(`${PUBLIC_GAMES_TOPIC}/${roomCode.toUpperCase()}`);
}
