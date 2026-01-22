# Task MM-028: Asset Pack Loader

**Repo:** ManaMesh
**Status:** Blocked
**Created:** 2026-01-21
**Dependencies:** MM-027
**Worktree:** `feature/asset-loader`

---

## Description

Implement the asset pack loader that fetches asset packs from IPFS or HTTP sources, caches them in IndexedDB, and provides card images to game modules.

## Dependencies

- MM-027: Asset Pack Manifest Parser

## User Stories

### US-MM-028.1: Load Asset Packs

As a player, I want to load asset packs so that I can see card artwork in games.

**Acceptance Criteria:**
- [ ] Load asset pack from IPFS CID
- [ ] Load asset pack from HTTP URL
- [ ] Parse manifest using MM-027 parser
- [ ] Fetch card images (lazy loading)
- [ ] Cache assets in IndexedDB for offline play
- [ ] Progress callbacks during loading
- [ ] Tests cover loading scenarios

### US-MM-028.2: Card Image Access

As a game module, I want to access card images so that I can render cards.

**Acceptance Criteria:**
- [ ] Get card image by card ID
- [ ] Return cached image if available
- [ ] Fetch and cache if not available
- [ ] Handle missing images gracefully (placeholder)
- [ ] Support front and back images

### US-MM-028.3: Offline Support

As a player, I want offline asset access so that I can play without internet.

**Acceptance Criteria:**
- [ ] Check IndexedDB cache first
- [ ] Mark asset packs as "fully cached" when complete
- [ ] Clear cache for specific packs
- [ ] Report cache status/size

## Technical Details

### Loader Interface

```typescript
interface AssetPackLoader {
  // Load an asset pack (fetches manifest, not all images)
  load(source: IPFSSource | HTTPSource): Promise<LoadedAssetPack>;

  // Get a card image (fetches and caches if needed)
  getCardImage(packId: string, cardId: string, side: 'front' | 'back'): Promise<Blob>;

  // Preload all images for offline play
  preloadPack(packId: string, onProgress?: ProgressCallback): Promise<void>;

  // Cache management
  getCacheStatus(packId: string): Promise<CacheStatus>;
  clearCache(packId?: string): Promise<void>;
}

interface LoadedAssetPack {
  id: string;
  manifest: AssetPackManifest;
  source: IPFSSource | HTTPSource;
}

interface CacheStatus {
  totalCards: number;
  cachedCards: number;
  sizeBytes: number;
  isComplete: boolean;
}

type ProgressCallback = (loaded: number, total: number) => void;
```

### Storage

Use IndexedDB with object stores:
- `asset-packs`: Manifest metadata
- `card-images`: Blob storage keyed by `packId:cardId:side`

## Files to Create/Modify

**New:**
- `packages/frontend/src/assets/loader/types.ts` - Loader types
- `packages/frontend/src/assets/loader/loader.ts` - Main loader
- `packages/frontend/src/assets/loader/cache.ts` - IndexedDB cache
- `packages/frontend/src/assets/loader/ipfs.ts` - IPFS fetching
- `packages/frontend/src/assets/loader/index.ts` - Exports

**Tests:**
- `packages/frontend/src/assets/loader/loader.test.ts`
- `packages/frontend/src/assets/loader/cache.test.ts`

## Completion Criteria

- [ ] All acceptance criteria met
- [ ] IPFS loading works
- [ ] HTTP loading works
- [ ] IndexedDB caching works
- [ ] Offline play supported
- [ ] Tests pass
- [ ] Build succeeds

---

**When complete, output:** `<promise>TASK_COMPLETE</promise>`

**If blocked, output:** `<promise>TASK_BLOCKED: [reason]</promise>`
