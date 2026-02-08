# Task MM-040: P2P Asset Pack Sharing & IPFS Hash Import

**Repo:** ManaMesh
**Status:** In Review
**Created:** 2026-02-08
**Dependencies:** MM-039
**Worktree:** `feature/asset-pack-sharing`

---

## Description

Players need to share asset packs so opponents can view their cards during gameplay. When a player shares their deck list during lobby/matchmaking, the other player's client checks for missing card metadata. If cards are missing, it requests the relevant card data (or full pack) from the peer via the existing WebRTC data channel, with consent prompts on both sides. Players can also import asset packs by IPFS hash and retrieve IPFS hashes for locally loaded packs.

## Dependencies

- **MM-039** (One Piece TCG Deck Builder) — Deck list types, asset pack loading, IndexedDB storage

## User Stories

### US-MM-040.1: Deck List Sharing in Lobby

As a player, I want to share my deck list with my opponent during matchmaking so that they can validate it is legal and see my revealed cards.

**Acceptance Criteria:**
- [ ] After P2P connection is established in the lobby, both players share their `DeckList` (card IDs + quantities, leader, pack metadata)
- [ ] Receiving player runs `validateDeck()` on the incoming deck list
- [ ] Validation result displayed in lobby UI (legal/illegal with error details)
- [ ] New P2P message types: `deck-list-share`, `deck-list-ack`

### US-MM-040.2: Missing Asset Pack Detection

As a player, I want my client to automatically detect when I'm missing card metadata for my opponent's deck so that I can request it.

**Acceptance Criteria:**
- [ ] On receiving a deck list, check each card ID against locally loaded packs
- [ ] If any card IDs are not found in any loaded pack, identify the missing pack(s)
- [ ] Display a notification: "Your opponent's deck uses cards from packs you don't have: [pack names/IDs]"
- [ ] Offer options: "Request cards from opponent" / "Import by IPFS hash" / "Skip (cards will show as placeholders)"

### US-MM-040.3: P2P Asset Pack Request (Card-Only Default)

As a player, I want to request missing card data from my opponent so that I can see their cards without needing the full asset pack.

**Acceptance Criteria:**
- [ ] Default mode: request only the card images + metadata for cards present in the opponent's deck list
- [ ] Optional mode: request the full asset pack zip
- [ ] New P2P message types: `asset-pack-request` (with card IDs or full-pack flag), `asset-pack-offer`, `asset-pack-chunk`, `asset-pack-complete`
- [ ] Chunking protocol for large blobs over existing WebRTC data channel (configurable chunk size, progress tracking)
- [ ] Progress bar displayed during transfer

### US-MM-040.4: Asset Pack Sharing Consent (Sender Side)

As a player, I want to approve or deny requests to share my asset packs so that I don't leak information without consent.

**Acceptance Criteria:**
- [ ] When a peer requests asset data, display an alert/dialog: "Player [name] is requesting [card-only / full pack] for [pack name]. Allow?"
- [ ] Options: "Allow" / "Deny" / "Block this player"
- [ ] "Block this player" adds the peer to a per-player block list (session-scoped)
- [ ] Blocked players' subsequent requests are auto-denied silently
- [ ] Block list UI visible somewhere in lobby (show blocked peers, option to unblock)

### US-MM-040.5: Asset Pack Receiving Consent (Receiver Side)

As a player, I want to approve incoming asset pack data so that I don't accept unwanted data.

**Acceptance Criteria:**
- [ ] When the sender approves and begins transmitting, the receiver gets a confirmation: "Player [name] is sending [N cards / full pack] ([size estimate]). Accept?"
- [ ] Options: "Accept" / "Decline" / "Block this player"
- [ ] On accept: receive chunks, reassemble, cache in IndexedDB (card images store + metadata store)
- [ ] On decline: cancel transfer, show placeholder cards

### US-MM-040.6: Import Asset Pack by IPFS Hash

As a player, I want to load an asset pack by entering its IPFS CID so that I can get packs shared out-of-band.

**Acceptance Criteria:**
- [ ] Input field in Deck Builder Packs tab: "Import by IPFS Hash"
- [ ] Also available in a standalone Asset Pack Management section
- [ ] Validates CID format before attempting fetch
- [ ] Uses gateway-first strategy (existing `ipfs-loader.ts` with `preferGateway: true`)
- [ ] On success: extracts zip, caches in IndexedDB (all three stores), appears in loaded packs
- [ ] Progress indicator during download + extraction
- [ ] Error handling: invalid CID, timeout, network failure

### US-MM-040.7: Retrieve IPFS Hash for Loaded Packs

As a player, I want to see the IPFS hash for my loaded asset packs so that I can share it with others outside of a game.

**Acceptance Criteria:**
- [ ] For packs loaded via IPFS (`ipfs:` or `ipfs-zip:` source), display the CID in the pack details UI
- [ ] For locally uploaded packs, offer "Publish to IPFS" button (if Helia node is available)
- [ ] Copy-to-clipboard button for the CID
- [ ] IPFS hash visible in both Deck Builder Packs tab and Asset Pack Management section

### US-MM-040.8: Anti-Spam Protection

As a player, I want protection against opponents spamming me with asset pack requests so that my game experience isn't disrupted.

**Acceptance Criteria:**
- [ ] Per-player block list (session-scoped) prevents further requests from blocked peers
- [ ] Rate limiting: max 3 pending requests per peer before auto-blocking
- [ ] If a peer is blocked, all incoming `asset-pack-request` messages from them are silently dropped
- [ ] Blocked peer notification: "You have been blocked from requesting asset packs from this player"

## Technical Details

### P2P Message Protocol Extensions

New message types added to `P2PMessage` union in `transport.ts`:

```
deck-list-share    → { type, deckList: DeckListExport, packMeta: { id, name, game, cardCount } }
deck-list-ack      → { type, valid: boolean, errors?: string[], missingCardIds?: string[] }
asset-pack-request → { type, packId, mode: 'cards-only' | 'full-pack', cardIds?: string[] }
asset-pack-offer   → { type, packId, mode, totalSize, totalChunks, cardCount }
asset-pack-chunk   → { type, packId, chunkIndex, totalChunks, data: string (base64) }
asset-pack-complete→ { type, packId, success: boolean }
asset-pack-denied  → { type, packId, reason: 'denied' | 'blocked' }
```

### Chunking Protocol

- Chunk size: 64KB base64 (configurable)
- Ordered, reliable delivery (WebRTC data channel default)
- Progress tracking: `chunkIndex / totalChunks`
- Receiver reassembles chunks into Blob, stores in IndexedDB
- For card-only mode: send a JSON manifest of card metadata + individual card image chunks

### IndexedDB Integration

Received card data uses existing three-store architecture:
- `manamesh-asset-packs`: Store pack metadata with `source: { type: 'p2p', peerId }` or `source: { type: 'ipfs', cid }`
- `manamesh-card-images`: Cache individual card images
- `manamesh-pack-zips`: Store full zip if full-pack mode was used

### IPFS Hash Import Flow

1. User enters CID in input field
2. Construct source: `{ type: 'ipfs-zip', cid }`
3. Call existing `loadPack(source)` which already handles IPFS zip loading
4. Gateway-first via existing `ipfs-loader.ts` + `preferGateway` config flag
5. On success, pack appears in loaded packs with `ipfs-zip:{cid}` as pack ID

## Files to Create/Modify

**New Files:**
- `packages/frontend/src/p2p/asset-sharing.ts` — Asset pack sharing protocol (request/offer/chunk/consent state machine)
- `packages/frontend/src/p2p/chunking.ts` — Generic blob chunking/reassembly over data channel
- `packages/frontend/src/components/AssetPackSharing/` — UI components for consent dialogs, progress, block list
- `packages/frontend/src/components/AssetPackManagement.tsx` — Standalone IPFS hash import + pack management page

**Modified Files:**
- `packages/frontend/src/p2p/transport.ts` — Add new message types to `P2PMessage` union
- `packages/frontend/src/assets/loader/loader.ts` — Support `p2p` source type
- `packages/frontend/src/assets/loader/types.ts` — Add `P2PSource` to `AssetPackSource` union
- `packages/frontend/src/components/P2PLobby.tsx` — Deck list sharing + missing pack UI
- `packages/frontend/src/components/DeckBuilder/AssetPackUpload.tsx` — Add IPFS hash import input
- `packages/frontend/src/components/DeckBuilder/DeckBuilderPage.tsx` — Show IPFS hashes on loaded packs
- `packages/frontend/src/App.tsx` — Route for Asset Pack Management page

**Tests:**
- `packages/frontend/src/p2p/chunking.test.ts` — Chunk/reassemble round-trip, progress callbacks
- `packages/frontend/src/p2p/asset-sharing.test.ts` — Protocol state machine, consent flow, block list

## Inventory Check

Before starting, verify:
- [ ] MM-039 deck builder is functional with local asset packs
- [ ] P2P transport works (join code flow connects two peers)
- [ ] `ipfs-loader.ts` can fetch content by CID via gateway
- [ ] IndexedDB three-store architecture is stable
- [ ] WebRTC data channel supports binary/string messages

## Completion Criteria

- [x] All acceptance criteria met (code-complete, pending E2E verification)
- [x] Deck lists shared and validated during lobby (ReadyPhaseUI in P2PLobby)
- [x] Missing packs detected and requested with consent on both sides
- [x] Card-only and full-pack transfer modes work (transfer-pipeline.ts, 8 tests)
- [x] Per-player block list prevents spam (PeerBlockList, 25 tests)
- [x] IPFS hash import loads packs via gateway-first strategy (AssetPackUpload + AssetPackManagement)
- [x] IPFS hashes displayed and copyable for loaded packs (DeckBuilderPage + AssetPackManagement)
- [x] Chunking protocol handles multi-MB transfers with progress (chunking.ts, 12 tests)
- [x] Tests pass for chunking and asset-sharing protocol (1052 pass, 58 files)
- [x] Build succeeds (Vite clean)

---

**When complete, output:** `<promise>PHASE_DONE</promise>`

**If blocked, output:** `<promise>BLOCKED: [reason]</promise>`
