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

// Protocol Labs public bootstrap nodes with WebSocket/WebRTC support
// These are stable, long-lived nodes that help browsers discover peers
const BOOTSTRAP_NODES = [
  // Protocol Labs bootstrap nodes
  '/dnsaddr/bootstrap.libp2p.io/p2p/QmNnooDu7bfjPFoTZYxMNLWUQJyrVwtbZg5gBMjTezGAJN',
  '/dnsaddr/bootstrap.libp2p.io/p2p/QmQCU2EcMqAqQPR2i9bChDtGNJchTbq5TbXJJ16u19uLTa',
  '/dnsaddr/bootstrap.libp2p.io/p2p/QmbLHAnMoJPWSCR5Zhtx6BHJX9KiKNN6tpvbUcqanj75Nb',
  '/dnsaddr/bootstrap.libp2p.io/p2p/QmcZf59bWwK5XFi76CZX8cbJ4BhTzzA3gU1ZjYZcYW3dwt',
];

// ManaMesh namespace for DHT keys to avoid collisions with other apps
export const DHT_NAMESPACE = '/manamesh/1.0.0';

// Room code topic for publishing/discovering games
export const ROOM_TOPIC = `${DHT_NAMESPACE}/rooms`;

// Public game listing topic
export const PUBLIC_GAMES_TOPIC = `${DHT_NAMESPACE}/public-games`;

export interface Libp2pServices {
  dht: KadDHT;
  identify: ReturnType<typeof identify>;
}

export type ManaMeshLibp2p = Libp2p<Libp2pServices>;

let libp2pInstance: ManaMeshLibp2p | null = null;

/**
 * Create and start a libp2p node configured for browser P2P
 * Returns a singleton instance
 */
export async function createNode(): Promise<ManaMeshLibp2p> {
  if (libp2pInstance) {
    return libp2pInstance;
  }

  console.log('[libp2p] Creating node...');

  const node = await createLibp2p({
    // Listen on circuit relay and WebRTC addresses
    addresses: {
      listen: [
        '/p2p-circuit',  // Listen via relays
        '/webrtc',       // Direct WebRTC connections
      ],
    },

    // Transports available in browser
    transports: [
      // WebSocket for connecting to relay nodes
      webSockets(),
      // WebRTC for direct peer connections
      webRTC(),
      // Circuit relay for NAT traversal
      circuitRelayTransport(),
    ],

    // Connection security
    connectionEncrypters: [noise()],

    // Stream multiplexing
    streamMuxers: [yamux()],

    // Peer discovery via bootstrap nodes
    peerDiscovery: [
      bootstrap({
        list: BOOTSTRAP_NODES,
      }),
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
