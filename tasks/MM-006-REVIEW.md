# Review: MM-006 - IPFS Asset Loading + Caching

## Review Metadata

- Task: MM-006
- Repo: ManaMesh
- Mode: Code Review
- Date: 2026-01-21

## Clarifying Questions

- None yet.

## Acceptance Criteria Verification

### US-MM-006.1: Load Assets from IPFS

- [x] Load images by CID using helia
- [x] Display loading placeholder while fetching
- [x] Fallback to public IPFS gateway if local node fails
- [x] Handle missing assets gracefully

### US-MM-006.2: Cache Assets Offline

- [x] Store fetched assets in IndexedDB
- [x] Check cache before IPFS fetch
- [x] Cache invalidation by CID (content-addressed = immutable)
- [x] ~100MB cache quota management

### US-MM-006.3: Preload Deck Assets

- [x] Batch preload deck images when game starts
- [x] Show preload progress indicator
- [x] Game playable even if preload incomplete

## Findings

### High

- `packages/frontend/src/assets/ipfs-loader.ts`: `fetchFromGateway` reuses one `AbortController` across all gateways. If it times out once, `signal` becomes permanently aborted and all subsequent gateway attempts fail immediately. This effectively disables multi-gateway fallback in the timeout case.

### Medium

- `packages/frontend/src/assets/ipfs-loader.ts`: timeout timers created for helia init + helia fetch aren't cleared on success (`setTimeout` inside a `Promise.race`). This can cause late rejections and/or wasted timers.
- `packages/frontend/src/assets/ipfs-loader.ts`: config includes `heliaFetchTimeout` but `loadAsset` routes a single `timeout` value to both helia + gateway (defaulting to `gatewayTimeout`). Expected: helia uses `heliaFetchTimeout`.
- `packages/frontend/src/components/IPFSImage.tsx`: `loadImage` revokes `imageUrl`, but `imageUrl` isn't in the callback deps. Combined with `useEffect([cid, retryCount])`, this risks leaking object URLs or revoking the wrong one in some update sequences.
- `packages/frontend/src/components/GameBoard.tsx`: `imageCids` uses `useMemo(() => collectImageCids(G), [])`, so it never updates if `G` changes. Probably fine if deck is immutable after start, but it will miss late-added `imageCid`s.
- `packages/frontend/src/components/GameBoard.tsx`: `preferGateway={true}` means gateway is tried first, which is the inverse of the helia-first requirement described in MM-006 (helia with gateway fallback). The loader supports helia-first; the component choice should be revisited.

### Low

- `packages/frontend/src/assets/cache.ts`: imports `keys` from `idb-keyval` but never uses it.
- `packages/frontend/src/assets/cache.test.ts`: LRU eviction test doesn't assert outcomes (it ends with a comment), so it won't catch regressions in eviction behavior.

## Test Coverage Notes

- Ran `yarn workspace @manamesh/frontend test` (Vitest): PASS for `src/assets/cache.test.ts` and `src/game/logic.test.ts`.
- Note: root `yarn test` and `yarn build` scripts use `yarn workspaces run ...`, but Yarn 4 doesn't have `workspaces run` (should be `yarn workspaces foreach -A run ...`). This is unrelated to MM-006 implementation but affects "tests pass / build succeeds" at repo root.

## Security / Privacy Notes

- Gateway fetches reveal CIDs to the configured public gateways (expected tradeoff; configurable via `packages/frontend/src/assets/config.ts`).
