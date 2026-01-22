/**
 * P2P Networking Layer
 * Provides multiple discovery methods for establishing peer connections
 */

// Core WebRTC functionality
export { PeerConnection, type ConnectionState, type ConnectionOffer, type PeerConnectionEvents } from './webrtc';

// Codec for encoding/decoding offers
export { encodeOffer, decodeOffer, isValidJoinCode } from './codec';

// Discovery methods
export { JoinCodeConnection, type JoinCodeState, type JoinCodeRole, type JoinCodeEvents } from './discovery/join-code';
export {
  MDNSDiscovery,
  LANConnection,
  type LANGame,
  type MDNSDiscoveryEvents,
  type MDNSState,
} from './discovery/mdns';

// Legacy stub for backwards compatibility
export async function startP2P() {
  console.log('[P2P] P2P layer initialized');
  return { ok: true };
}
