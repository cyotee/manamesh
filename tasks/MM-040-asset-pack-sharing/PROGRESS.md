# Progress Log: MM-040

## Current Checkpoint

**Last checkpoint:** Transfer pipeline wired, lobby ready phase implemented
**Next step:** Add standalone Asset Pack Management page (optional), end-to-end manual testing
**Build status:** Clean (Vite build succeeds)
**Test status:** 1052 pass, 3 skipped (58 files)

---

## Session Log

### 2026-02-08 - Task Created

- Task designed via /pm:design
- TASK.md populated with requirements
- 8 user stories covering: deck list sharing, missing pack detection, P2P card/pack transfer with consent, IPFS hash import/export, anti-spam protection

### 2026-02-08 - Session 1: Core Protocol Implementation

**Created files:**
- `p2p/chunking.ts` — Blob chunking/reassembly (base64, 48KB chunks, progress callbacks) [12 tests]
- `p2p/chunking.test.ts` — Round-trip, multi-chunk, progress, out-of-order, duplicates
- `p2p/asset-sharing.ts` — Protocol state machine, PeerBlockList, AssetSharingSession, message types [25 tests]
- `p2p/asset-sharing.test.ts` — Block list, auto-blocking, transfers, message factories, utilities
- `components/AssetPackSharing/ConsentDialog.tsx` — SenderConsentDialog, ReceiverConsentDialog, MissingPacksNotice
- `components/AssetPackSharing/TransferProgress.tsx` — TransferProgress bar, TransferList
- `components/AssetPackSharing/BlockList.tsx` — Blocked peers list with unblock
- `components/AssetPackSharing/index.ts` — Barrel export
- `hooks/useAssetSharing.ts` — React hook bridging transport → protocol state machine → UI state

**Modified files:**
- `p2p/transport.ts` — Added 8 asset sharing message types, `onAssetSharingMessage()`, `sendAssetSharingMessage()`, `handleAssetSharingMessage()`
- `assets/loader/types.ts` — Added `P2PSource` interface, extended `AssetPackSource` union, updated `sourceToPackId()`
- `assets/loader/loader.ts` — Added P2P source handler (reconstruct from IndexedDB metadata)
- `components/DeckBuilder/AssetPackUpload.tsx` — Added IPFS CID import field with validation
- `components/DeckBuilder/DeckBuilderPage.tsx` — Added IPFS CID display + copy for loaded packs

**Status of user stories:**
- US-MM-040.1 (Deck list sharing): Protocol messages + session tracking done; UI integration pending
- US-MM-040.2 (Missing pack detection): `findMissingCards()` + MissingPacksNotice component done; wiring pending
- US-MM-040.3 (P2P request): Full message protocol + chunking done; actual chunk sending pending
- US-MM-040.4 (Sender consent): SenderConsentDialog + hook logic done; P2PLobby integration pending
- US-MM-040.5 (Receiver consent): ReceiverConsentDialog + hook logic done; P2PLobby integration pending
- US-MM-040.6 (IPFS hash import): Input field added to AssetPackUpload with CID validation
- US-MM-040.7 (IPFS hash display): CID shown on loaded packs in PacksPanel with copy button
- US-MM-040.8 (Anti-spam): PeerBlockList with rate limiting done + tested

### 2026-02-08 - Session 2: Lobby Protocol + P2PLobby Integration

**Created files:**
- `p2p/lobby-protocol.ts` — Lightweight JSON envelope protocol on top of JoinCodeConnection for pre-game asset sharing [8 tests]
- `p2p/lobby-protocol.test.ts` — Message routing, envelope format, subscribe/unsubscribe, passthrough

**Modified files:**
- `hooks/useAssetSharing.ts` — Refactored to use `AssetSharingChannel` interface (works with both `LobbyProtocol` and `P2PTransport`)
- `components/P2PLobby.tsx` — Integrated LobbyProtocol, useAssetSharing hook, and AssetSharingOverlay (consent dialogs, transfer progress, block list, missing packs notice)

**Architecture decision:** Created `AssetSharingChannel` interface with `send()` + `onMessage()` so the hook is decoupled from any specific transport implementation. `LobbyProtocol` wraps `JoinCodeConnection.send(string)` with a `{ _lobby: true, payload }` JSON envelope to distinguish lobby messages from other traffic.

**Remaining work:**
1. ~~Implement actual chunk sending flow~~ — Done (Session 3)
2. ~~Implement received chunk reassembly → IndexedDB storage pipeline~~ — Done (Session 3)
3. ~~Add lobby "ready" phase for deck exchange before game start~~ — Done (Session 3)
4. Add App.tsx route for standalone Asset Pack Management page (optional)
5. End-to-end manual testing with two peers

### 2026-02-08 - Session 3: Transfer Pipeline + Ready Phase

**Created files:**
- `p2p/transfer-pipeline.ts` — Build/unpack transfer blobs for cards-only and full-pack modes [8 tests]
- `p2p/transfer-pipeline.test.ts` — Round-trip, progress, metadata preservation (uses `vi.hoisted()` for Yarn PnP)

**Modified files:**
- `hooks/useAssetSharing.ts`:
  - Wired `sendCardsTransfer`/`sendFullPackTransfer` into `allowSenderRequest`
  - Wired `unpackCardsOnlyBlob`/`unpackFullPackBlob` into chunk handler
  - Made `handleIncomingChunk` async (was missing `async` keyword for `await` calls)
  - Added complete `useEffect` dependency array for message handler subscription
  - Removed dead `storeP2PPackData` helper and unused imports
- `p2p/lobby-protocol.ts`:
  - Extended to support `LobbyControlMessage` union (`lobby-ready`)
  - Added `sendControl()` and `onControl()` methods
  - Split listeners into `assetListeners` and `controlListeners`
- `p2p/lobby-protocol.test.ts` — Added 3 tests for lobby-ready control messages (11 total)
- `components/P2PLobby.tsx`:
  - Added lobby "ready" phase with deck selection before game start
  - Connection no longer immediately calls `onConnected` — enters `deck-select` phase
  - Players select saved decks → deck list shared via protocol → resolve missing packs → both click Ready → game starts
  - Integrated `useDeckStorage` hook for deck list
  - Added `lobby-ready` control message listener for peer ready state
  - Replaced `AssetSharingOverlay` with `ReadyPhaseUI` component (deck selector + ready status + asset sharing)

**Status of user stories:**
- US-MM-040.1 (Deck list sharing): DONE — deck list shared on selection in lobby, peer deck info displayed
- US-MM-040.2 (Missing pack detection): DONE — `findMissingCards()` + MissingPacksNotice wired in ReadyPhaseUI
- US-MM-040.3 (P2P request): DONE — Full send/receive pipeline: build blob → chunk → send → reassemble → store in IndexedDB
- US-MM-040.4 (Sender consent): DONE — SenderConsentDialog → `allowSenderRequest` uses real transfer pipeline
- US-MM-040.5 (Receiver consent): DONE — ReceiverConsentDialog → chunk handler unpacks and stores
- US-MM-040.6 (IPFS hash import): DONE — CID input in AssetPackUpload with validation
- US-MM-040.7 (IPFS hash display): DONE — CID shown on loaded packs with copy button
- US-MM-040.8 (Anti-spam): DONE — PeerBlockList with rate limiting + auto-blocking

### 2026-02-08 - Session 3 (continued): Asset Pack Management Page

**Created files:**
- `components/AssetPackManagement.tsx` — Standalone page: IPFS CID import, stored packs list with delete, IPFS CID display + copy

**Modified files:**
- `App.tsx` — Added `"asset-packs"` game mode, route to AssetPackManagement, `handleAssetPacks` callback
- `components/GameSelector.tsx` — Added `onAssetPacks` prop, "Asset Packs" button (purple) next to "Deck Builder" button
- `components/P2PLobby.tsx` — Removed unused `AssetSharingSession` import, cleaned up `LobbyReadyPhase` type (removed unused `'waiting'` value)

**Remaining:**
- End-to-end manual testing with two peers
