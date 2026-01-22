/**
 * P2P Networking Layer
 * Provides multiple discovery methods for establishing peer connections
 */

// Core WebRTC functionality
export { PeerConnection, type ConnectionState, type ConnectionOffer, type PeerConnectionEvents } from './webrtc';

// Codec for encoding/decoding offers
export { encodeOffer, decodeOffer, isValidJoinCode } from './codec';

// Discovery methods - Two-way join codes (fallback)
export { JoinCodeConnection, type JoinCodeState, type JoinCodeRole, type JoinCodeEvents } from './discovery/join-code';
export {
  MDNSDiscovery,
  LANConnection,
  type LANGame,
  type MDNSDiscoveryEvents,
  type MDNSState,
} from './discovery/mdns';

// Discovery methods - DHT (primary)
export {
  DHTConnection,
  type DHTState,
  type DHTEvents,
  type PublicGame,
  generateRoomCode,
  normalizeRoomCode,
  isValidRoomCode,
} from './discovery/dht';

// Discovery methods - Signaling server (fallback)
export {
  SignalingConnection,
  isSignalingAvailable,
  getSignalingUrl,
  type SignalingState,
  type SignalingEvents,
} from './discovery/signaling';

// libp2p configuration
export {
  createNode,
  getNode,
  stopNode,
  isConnectedToPeers,
  getConnectedPeerCount,
} from './libp2p-config';

// boardgame.io P2P transport
export { P2PTransport, P2PMultiplayer, type P2PTransportOpts, type P2PRole, type P2PMessage, type P2PMessageType } from './transport';

// Legacy stub for backwards compatibility
export async function startP2P() {
  console.log('[P2P] P2P layer initialized');
  return { ok: true };
}
