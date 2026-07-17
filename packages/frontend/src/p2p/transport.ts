/**
 * Re-exports channel-based boardgame.io P2P transport from the package.
 *
 * Implementation lives in `@cyotee/boardgameio-p2p` (channel / join-code path).
 * Discovery (join codes, LAN, etc.) stays in this app under `./discovery` and
 * `./webrtc`; pass a {@link JoinCodeConnection} as `connection` to P2PMultiplayer.
 *
 * Prefer the `/channel` subpath so PeerJS is not pulled into the app bundle.
 */

export {
  P2PTransport,
  P2PMultiplayer,
  BrowserStorage,
  saveTimestreamsSession,
  loadTimestreamsSession,
  clearTimestreamsSession,
  TIMESTREAMS_SESSION_KEY,
  isAssetSharingMessage,
} from "@cyotee/boardgameio-p2p/channel";

export type {
  P2PTransportOpts,
  P2PRole,
  P2PMessage,
  P2PMessageType,
  TimestreamsP2PSession,
  ConnectionState,
  P2PChannel,
  AssetSharingMessage,
} from "@cyotee/boardgameio-p2p/channel";

/** @deprecated Prefer importing JoinCodeConnection from `./discovery/join-code`. */
export type { JoinCodeConnection } from "./discovery/join-code";
