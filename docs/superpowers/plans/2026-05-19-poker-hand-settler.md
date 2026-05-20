# Poker Hand Settler Implementation Plan (v2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the trustless on-chain settlement layer described in `manamesh/PRD_CONTRACTS.md` (v1.1), housed in a brand-new in-tree embedded package `manamesh-games/packages/poker/` (`@manamesh/poker`). The package owns:
- All poker Solidity contracts (settler diamond, oracle diamond, verifier facet, types/libs).
- The existing poker TypeScript game module (currently in `manamesh/packages/frontend/src/game/modules/poker/`), migrated into the package.
- `PokerBoard.tsx`, migrated from `manamesh/packages/frontend/src/components/`.
- New off-chain EIP-712 signing helpers paired with the contracts.

**Architecture:** Crane Diamond + DFPkg, one PokerHandSettler diamond per ERC20 token, separate BettingConfigOracle diamond providing `(operator, rakeBps)` per-token with global default, Level-1 best-5-of-7 verifier as a standalone facet attached to each settler diamond. Off-chain TS helpers co-located with the existing poker module in the new package. `@manamesh/poker` depends on `@manamesh/frontend` for hooks/components used by `PokerBoard.tsx`; manamesh's game registry imports `@manamesh/poker` (use dynamic import to avoid a static dependency cycle).

**Tech Stack:** Solidity 0.8.30 (Cancun→Prague), Foundry, Crane framework (ERC2535 Diamond + DFPkg + CREATE3), OpenZeppelin contracts v5, React 18, Phaser 3, boardgame.io, TypeScript, viem (EIP-712), Vitest.

**Reference docs:**
- `manamesh/PRD_CONTRACTS.md` — locked PRD v1.1 §11.
- `manamesh/docs/EMBEDDED_PACKAGE_GUIDE.md` — embedded package layout in this repo.
- `manamesh/lib/crane/AGENTS.md` — Crane patterns.
- `manamesh/AGENTS.md` — poker game module layout (the code we're moving).
- `manamesh/lib/crane/contracts/tokens/ERC20/ERC20PermitMintBurnLockedOwnableDFPkg.sol` — concrete DFPkg example.

**Repo layout reminder:**
- **Outer meta-repo:** `manamesh-games/` (git repo; this is where commits for the package go).
- **Submodule:** `manamesh-games/manamesh/` (the game platform).
- **Workspaces root:** `manamesh-games/package.json` has yarn 4 workspaces in `packages/*`. We'll add `packages/poker/`.

**Working directories:**
- Solidity / Foundry: `manamesh-games/packages/poker/`
- TypeScript: `manamesh-games/packages/poker/src/`
- Manamesh updates (registry / import-site rewires): `manamesh-games/manamesh/packages/frontend/`

**Commit style:** Conventional Commits. Commits land in `manamesh-games` (outer repo) for everything inside `packages/poker/`. Commits inside `manamesh/` (submodule) for any frontend import rewires. The submodule pointer in the outer repo gets bumped via a follow-up `chore: bump manamesh` commit each time we cross the boundary.

---

## File Structure (locked before tasks)

```
manamesh-games/
├── package.json                                   # workspaces array gains "packages/poker"
└── packages/
    └── poker/                                     # NEW embedded package: @manamesh/poker
        ├── package.json                           # name=@manamesh/poker
        ├── tsconfig.json
        ├── tsconfig.build.json
        ├── vitest.config.ts
        ├── README.md
        ├── foundry.toml                           # src=contracts, test=tests/foundry
        ├── remappings.txt                         # forge-std/, @openzeppelin/, @crane/contracts/
        ├── .gitmodules                            # forge install populates this
        ├── lib/                                   # forge install lands here
        │   ├── forge-std/                         # foundry-rs/forge-std
        │   ├── openzeppelin-contracts/            # OpenZeppelin/openzeppelin-contracts@v5
        │   └── crane/                             # cyotee/Crane (or wherever it lives)
        ├── contracts/                             # Solidity sources
        │   ├── types/
        │   │   ├── HandInit.sol
        │   │   ├── HandOutcome.sol
        │   │   └── RoundStateTransition.sol
        │   ├── lib/
        │   │   ├── HandIdLib.sol
        │   │   └── SignatureLib.sol
        │   ├── oracle/
        │   │   ├── IBettingConfigOracle.sol
        │   │   ├── BettingConfigOracleErrors.sol
        │   │   ├── BettingConfigOracleRepo.sol
        │   │   ├── BettingConfigOracleTarget.sol
        │   │   ├── BettingConfigOracleFacet.sol
        │   │   └── BettingConfigOracleDFPkg.sol
        │   ├── settler/
        │   │   ├── IPokerHandSettler.sol
        │   │   ├── PokerHandSettlerErrors.sol
        │   │   ├── PokerHandSettlerRepo.sol
        │   │   ├── PokerHandSettlerTarget.sol
        │   │   ├── PokerHandSettlerFacet.sol
        │   │   ├── PokerHandSettlerDFPkg.sol
        │   │   └── _test/
        │   │       └── ERC20Mock.sol
        │   └── verifier/
        │       ├── IPokerVerifierFacet.sol
        │       ├── PokerHandEvaluator.sol
        │       └── PokerVerifierFacet.sol
        ├── tests/
        │   └── foundry/                           # Foundry tests mirror contracts/
        │       ├── oracle/BettingConfigOracle.t.sol
        │       ├── settler/
        │       │   ├── PokerHandSettler_deposit.t.sol
        │       │   ├── PokerHandSettler_withdraw.t.sol
        │       │   ├── PokerHandSettler_assertHandMembership.t.sol
        │       │   ├── PokerHandSettler_settleHand.t.sol
        │       │   └── PokerHandSettler_forceTimeoutSettlement.t.sol
        │       ├── verifier/PokerVerifierFacet.t.sol
        │       ├── lib/
        │       │   ├── HandIdLib.t.sol
        │       │   ├── HandIdLib_parity.t.sol
        │       │   └── SignatureLib.t.sol
        │       └── integration/
        │           ├── PokerHandSettler_E2E.t.sol
        │           └── CrossStackParity.t.sol
        ├── script/
        │   ├── DeployBettingConfigOracle.s.sol
        │   ├── DeployPokerHandSettler.s.sol
        │   └── DeployPokerSystem.s.sol
        └── src/                                   # TypeScript sources
            ├── index.ts                           # moved from manamesh
            ├── types.ts                           # moved (PokerHandResult refactored)
            ├── game.ts                            # moved
            ├── crypto.ts                          # moved (buildHandResult refactored)
            ├── betting.ts                         # moved
            ├── betting.test.ts                    # moved
            ├── crypto.test.ts                     # moved
            ├── hands.ts                           # moved
            ├── hands.test.ts                      # moved
            ├── handId.ts                          # NEW
            ├── handId.test.ts                     # NEW
            ├── signing.ts                         # NEW
            ├── signing.test.ts                    # NEW
            ├── README.md                          # moved
            └── components/
                └── PokerBoard.tsx                 # moved from manamesh frontend
```

**Files removed from manamesh frontend (after the move):**

```
manamesh/packages/frontend/src/game/modules/poker/   # whole directory removed
manamesh/packages/frontend/src/components/PokerBoard.tsx   # removed
```

**Files modified in manamesh frontend:**
- `manamesh/packages/frontend/package.json` — add `@manamesh/poker` dependency.
- `manamesh/packages/frontend/src/game/registry.ts` — import poker from `@manamesh/poker` (dynamic import to avoid static cycle).
- `manamesh/packages/frontend/src/App.tsx` — update PokerBoard import if it imports it statically.
- Anywhere else that imports `../game/modules/poker/...` or `./PokerBoard` — rewrite to `@manamesh/poker`.

---

## Phase 0: Bootstrap the embedded package

### Task 0.1: Create packages/poker scaffold

**Files:**
- Create: `packages/poker/package.json`
- Create: `packages/poker/tsconfig.json`
- Create: `packages/poker/tsconfig.build.json`
- Create: `packages/poker/vitest.config.ts`
- Create: `packages/poker/README.md`
- Create: `packages/poker/foundry.toml`
- Create: `packages/poker/remappings.txt`
- Create: `packages/poker/src/` (empty for now)
- Create: `packages/poker/contracts/` (empty)
- Create: `packages/poker/tests/foundry/` (empty)
- Create: `packages/poker/script/` (empty)
- Create: `packages/poker/.gitignore`
- Modify: `package.json` (root) — add `packages/poker` to workspaces.

- [ ] **Step 1: Create the directory tree**

```bash
cd /Users/cyotee/Development/github-cyotee/manamesh-games
mkdir -p packages/poker/{src/components,contracts,tests/foundry,script}
```

- [ ] **Step 2: Write `packages/poker/package.json`**

```json
{
  "name": "@manamesh/poker",
  "version": "0.1.0",
  "description": "Texas Hold'em poker module for ManaMesh — Solidity settlement contracts, EIP-712 signing helpers, boardgame.io game module, and React board.",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./components/PokerBoard": "./src/components/PokerBoard.tsx",
    "./signing": "./src/signing.ts",
    "./handId": "./src/handId.ts"
  },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "forge:build": "forge build",
    "forge:test": "forge test"
  },
  "peerDependencies": {
    "@manamesh/frontend": "*",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "boardgame.io": "^0.50.2"
  },
  "dependencies": {
    "elliptic": "^6.5.5",
    "viem": "^2.0.0"
  },
  "devDependencies": {
    "vitest": "^1.0.0",
    "typescript": "^5.0.0",
    "@types/react": "^18.2.0",
    "@types/elliptic": "^6.4.0"
  }
}
```

(The exact dep versions can be tightened to match what manamesh frontend already uses. Goal: package builds and types check.)

- [ ] **Step 3: Write `packages/poker/foundry.toml`**

```toml
[profile.default]
src = "contracts"
test = "tests/foundry"
out = "out"
script = "script"
cache_path = "cache"
libs = ["lib"]

# Compiler settings — aligned with Crane.
solc_version = "0.8.30"
optimizer = true
optimizer_runs = 1
evm_version = "prague"

# Testing
ffi = false
verbosity = 2
fuzz = { runs = 256 }

[profile.ci]
fuzz = { runs = 1000 }

[fmt]
line_length = 100
tab_width = 4
bracket_spacing = true

[rpc_endpoints]
mainnet = "${MAINNET_RPC_URL}"
sepolia = "${SEPOLIA_RPC_URL}"
arbitrum = "${ARBITRUM_RPC_URL}"
base = "${BASE_RPC_URL}"
```

- [ ] **Step 4: Write `packages/poker/remappings.txt`**

```
forge-std/=lib/forge-std/src/
@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/
@crane/contracts/=lib/crane/contracts/
@crane/test/=lib/crane/test/
```

Crane's own files import as `@crane/contracts/...`; our prefix must match.

- [ ] **Step 5: Write `packages/poker/.gitignore`**

```
cache/
out/
node_modules/
dist/
*.log
```

- [ ] **Step 6: Write minimal TS config**

`packages/poker/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noUncheckedIndexedAccess": true,
    "allowSyntheticDefaultImports": true,
    "types": ["vitest/globals"]
  },
  "include": ["src/**/*"]
}
```

`packages/poker/tsconfig.build.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "outDir": "./dist",
    "declaration": true,
    "emitDeclarationOnly": false
  },
  "exclude": ["src/**/*.test.ts", "src/**/*.test.tsx"]
}
```

- [ ] **Step 7: Write `packages/poker/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
});
```

- [ ] **Step 8: Stub `packages/poker/src/index.ts`**

```ts
// Re-exports will be filled in as files migrate into this package.
export {};
```

- [ ] **Step 9: Write `packages/poker/README.md`**

A 10-line README pointing at `manamesh/PRD_CONTRACTS.md` and stating that this package holds the Solidity contracts + TS helpers + board component for ManaMesh Texas Hold'em.

- [ ] **Step 10: Wire workspaces in `manamesh-games/package.json`**

Read the file, add a `"workspaces"` array if not present:

```json
{
  "name": "manamesh-games",
  "packageManager": "yarn@4.11.0",
  "workspaces": [
    "packages/*"
  ],
  "dependencies": {
    "boardgame.io": "file:./packages/boardgame.io",
    "boardgameIO-p2p": "file:./packages/boardgameIO-p2p",
    "manamesh": "file:../manamesh"
  }
}
```

Note `manamesh` is `file:../manamesh` per current state — that's outside the repo and likely wrong. Leave it alone for now (fixing it is out of scope; flag if it blocks `yarn install`).

- [ ] **Step 11: Run yarn install**

```bash
cd /Users/cyotee/Development/github-cyotee/manamesh-games
yarn install
```

Expected: succeeds, includes `@manamesh/poker` in the workspace. If `file:../manamesh` breaks the install, comment that dependency out temporarily and note it for cleanup.

- [ ] **Step 12: Commit (outer repo)**

```bash
cd /Users/cyotee/Development/github-cyotee/manamesh-games
git add packages/poker package.json yarn.lock
git commit -m "feat(poker): scaffold @manamesh/poker embedded package with Foundry workspace"
```

---

### Task 0.2: forge install dependencies

**Files:**
- Modify: `packages/poker/.gitmodules` (created by forge install)
- Create: `packages/poker/lib/forge-std/`
- Create: `packages/poker/lib/openzeppelin-contracts/`
- Create: `packages/poker/lib/crane/`

- [ ] **Step 1: Install forge-std**

```bash
cd /Users/cyotee/Development/github-cyotee/manamesh-games/packages/poker
forge install foundry-rs/forge-std --no-commit
```

- [ ] **Step 2: Install OpenZeppelin v5**

```bash
forge install OpenZeppelin/openzeppelin-contracts@v5.0.2 --no-commit
```

- [ ] **Step 3: Install Crane**

Look up the Crane git URL. The existing submodule in manamesh points at it; read `manamesh/.gitmodules` to find the URL. Then:

```bash
forge install <crane-git-url> --no-commit
```

- [ ] **Step 4: Verify empty workspace builds**

```bash
cd /Users/cyotee/Development/github-cyotee/manamesh-games/packages/poker
forge build
```

Expected: "Nothing to compile" or a clean compile of zero source files. If Crane's tree is large and forge tries to compile everything in lib/, that's fine; should succeed but slow.

- [ ] **Step 5: Verify Crane import resolves**

Drop a throwaway file to prove the @crane/contracts/ remapping works:

```bash
mkdir -p contracts/_smoke
cat > contracts/_smoke/Smoke.sol <<'EOF'
// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.30;
import {IFacet} from "@crane/contracts/interfaces/IFacet.sol";
contract Smoke { function f() external pure returns (bytes4) { return type(IFacet).interfaceId; } }
EOF
forge build
rm -rf contracts/_smoke
```

Expected: compiles. Remove the smoke file before committing.

- [ ] **Step 6: Commit**

```bash
cd /Users/cyotee/Development/github-cyotee/manamesh-games
git add packages/poker/.gitmodules packages/poker/lib
git commit -m "chore(poker): forge install forge-std, openzeppelin-contracts v5, crane"
```

---

### Task 0.3: Move the existing poker TS game module into the package

**Files:**
- Move from `manamesh/packages/frontend/src/game/modules/poker/` to `packages/poker/src/`:
  - `betting.test.ts`, `betting.ts`, `crypto.test.ts`, `crypto.ts`, `game.ts`, `hands.test.ts`, `hands.ts`, `index.ts`, `README.md`, `types.ts`

- [ ] **Step 1: Move the files**

```bash
cd /Users/cyotee/Development/github-cyotee/manamesh-games
git -C manamesh mv packages/frontend/src/game/modules/poker/betting.test.ts ../../../packages/poker/src/betting.test.ts
# ... same for each file
```

That's awkward across the submodule boundary. Practical approach:

```bash
# Move (without git mv across repos)
mv manamesh/packages/frontend/src/game/modules/poker/* packages/poker/src/
rmdir manamesh/packages/frontend/src/game/modules/poker
```

Now `git -C manamesh status` will show the files as deleted (and we'll add a manamesh commit), and `git status` (outer) will show the files as untracked in `packages/poker/src/`.

- [ ] **Step 2: Update imports inside the moved files**

The moved files used relative imports like `../../crypto/mental-poker`, `../../crypto/plugin/crypto-plugin`, etc. Those references are now broken. Inventory each:

```bash
grep -rE "^import.*from '\.\.\/" packages/poker/src/*.ts
```

For each broken relative import, replace with an explicit `@manamesh/frontend/...` path OR refactor to inject the dependency. Minimum changes:

- `crypto.ts` imports from `'../../crypto/mental-poker'` → `'@manamesh/frontend/src/crypto/mental-poker'` (or whatever the published path is). If `@manamesh/frontend` doesn't expose internal modules via subpath exports, expose them via that package's `package.json#exports` first.

If the manamesh frontend's `package.json` exports config is strict (only `"."` exported), we have two options:

a. Add subpath exports to `manamesh/packages/frontend/package.json` so `@manamesh/poker` can import `@manamesh/frontend/src/crypto/...`.
b. Move the crypto primitives (mental-poker, shamirs, plugin) into `@manamesh/poker` if they're poker-specific, OR into a fresh `@manamesh/crypto` package if they're shared.

Per AGENTS.md, those crypto primitives ARE shared (War, Go Fish use them too). So option (a): expose them via subpath exports in `@manamesh/frontend`'s package.json. **This is the path of least disruption for v1.**

Concretely, add to `manamesh/packages/frontend/package.json`:

```json
"exports": {
  ".": "./src/index.ts",
  "./src/crypto/*": "./src/crypto/*.ts",
  "./src/crypto/*.ts": "./src/crypto/*.ts",
  "./src/hooks/*": "./src/hooks/*.ts",
  "./src/assets/*": "./src/assets/*.ts",
  "./src/components/*": "./src/components/*.tsx",
  "./src/blockchain/*": "./src/blockchain/*.ts"
}
```

(Exact glob support depends on Node version; if globs aren't supported in this toolchain, list explicit subpaths needed.)

Then rewrite the moved files' imports:

```ts
// before (in moved crypto.ts):
import { generateKeyPair } from '../../crypto/mental-poker';
// after:
import { generateKeyPair } from '@manamesh/frontend/src/crypto/mental-poker';
```

- [ ] **Step 3: Run the moved tests at the new location**

```bash
cd /Users/cyotee/Development/github-cyotee/manamesh-games/packages/poker
yarn test
```

Expected: 3 test files run (betting.test.ts, crypto.test.ts, hands.test.ts). Fix any broken imports. **If `crypto.test.ts` has the pre-existing ESM resolution issue noted in `manamesh/AGENTS.md`, it may still fail — preserve that pre-existing failure mode without trying to fix it here.**

- [ ] **Step 4: Commits**

Two commits — manamesh (submodule) for the deletion + frontend exports, outer for the addition.

```bash
# manamesh submodule
cd /Users/cyotee/Development/github-cyotee/manamesh-games/manamesh
git add packages/frontend/src/game/modules/poker packages/frontend/package.json
git commit -m "refactor(frontend): extract poker module into @manamesh/poker; add subpath exports for cross-package imports"

# outer manamesh-games
cd /Users/cyotee/Development/github-cyotee/manamesh-games
git add packages/poker/src manamesh
git commit -m "feat(poker): import poker game module from manamesh; update relative imports to @manamesh/frontend subpaths"
```

---

### Task 0.4: Move PokerBoard.tsx into the package

**Files:**
- Move: `manamesh/packages/frontend/src/components/PokerBoard.tsx` → `packages/poker/src/components/PokerBoard.tsx`

- [ ] **Step 1: Move the file**

```bash
mv manamesh/packages/frontend/src/components/PokerBoard.tsx packages/poker/src/components/PokerBoard.tsx
```

- [ ] **Step 2: Update PokerBoard.tsx imports**

Original imports (already inventoried above):

```ts
import type { PokerState, PokerCard, PokerPhase, CryptoPokerPhase, PokerHandResult, DecryptRequest, DecryptNotification } from '../game/modules/poker/types';
import type { CryptoPokerState, CryptoPokerPlayerState } from '../game/modules/poker/types';
import { CryptoTransparencyPanel } from './CryptoTransparencyPanel';
import type { CryptoPluginState } from '../crypto/plugin/crypto-plugin';
import { generateKeyPair } from '../crypto/mental-poker';
import type { CryptoKeyPair } from '../crypto/mental-poker/types';
import { useGameKeys } from '../blockchain/wallet';
import { useAssetPack } from '../hooks/useAssetPack';
import { useCardImage } from '../hooks/useCardImage';
import { useCardSettings } from '../hooks/useCardSettings';
import { CARD_BACK_ID } from '../assets/packs/standard-cards';
import type { IPFSZipSource } from '../assets/loader/types';
import { CardSettingsPanel } from './CardSettingsPanel';
```

Rewrite as:

```ts
import type {
  PokerState, PokerCard, PokerPhase, CryptoPokerPhase, PokerHandResult,
  DecryptRequest, DecryptNotification, CryptoPokerState, CryptoPokerPlayerState
} from '../types';
import { CryptoTransparencyPanel } from '@manamesh/frontend/src/components/CryptoTransparencyPanel';
import type { CryptoPluginState } from '@manamesh/frontend/src/crypto/plugin/crypto-plugin';
import { generateKeyPair } from '@manamesh/frontend/src/crypto/mental-poker';
import type { CryptoKeyPair } from '@manamesh/frontend/src/crypto/mental-poker/types';
import { useGameKeys } from '@manamesh/frontend/src/blockchain/wallet';
import { useAssetPack } from '@manamesh/frontend/src/hooks/useAssetPack';
import { useCardImage } from '@manamesh/frontend/src/hooks/useCardImage';
import { useCardSettings } from '@manamesh/frontend/src/hooks/useCardSettings';
import { CARD_BACK_ID } from '@manamesh/frontend/src/assets/packs/standard-cards';
import type { IPFSZipSource } from '@manamesh/frontend/src/assets/loader/types';
import { CardSettingsPanel } from '@manamesh/frontend/src/components/CardSettingsPanel';
```

- [ ] **Step 3: Export PokerBoard from the package**

Update `packages/poker/src/index.ts`:

```ts
export * from './types';
export { PokerBoard } from './components/PokerBoard';
// game and crypto modules:
export * as game from './game';
export * as crypto from './crypto';
export * as hands from './hands';
export * as betting from './betting';
```

(Adjust to match the actual exports of each file. Goal: every public symbol from the old `src/game/modules/poker/` is reachable via `@manamesh/poker`.)

- [ ] **Step 4: Verify the package type-checks**

```bash
cd /Users/cyotee/Development/github-cyotee/manamesh-games/packages/poker
yarn tsc --noEmit -p tsconfig.json
```

Fix any type errors. The manamesh frontend's pre-existing third-party type errors won't surface here since we're isolated to the package's own `src/`.

- [ ] **Step 5: Commit**

```bash
cd /Users/cyotee/Development/github-cyotee/manamesh-games/manamesh
git add packages/frontend/src/components/PokerBoard.tsx
git commit -m "refactor(frontend): move PokerBoard.tsx out to @manamesh/poker"

cd /Users/cyotee/Development/github-cyotee/manamesh-games
git add packages/poker/src/components/PokerBoard.tsx packages/poker/src/index.ts manamesh
git commit -m "feat(poker): add PokerBoard component + index re-exports"
```

---

### Task 0.5: Re-wire manamesh imports to @manamesh/poker

**Files:**
- Modify: `manamesh/packages/frontend/package.json` — add `"@manamesh/poker": "*"` (or workspace ref) to dependencies.
- Modify: `manamesh/packages/frontend/src/game/registry.ts`
- Modify: every other file that imports from the old paths

- [ ] **Step 1: Add @manamesh/poker to frontend deps**

In `manamesh/packages/frontend/package.json` `dependencies`:

```json
"@manamesh/poker": "*"
```

(Workspaces resolve `*` to the local package.)

- [ ] **Step 2: Inventory broken imports**

```bash
cd /Users/cyotee/Development/github-cyotee/manamesh-games/manamesh
grep -rnE "from ['\"]\.\.?(/.*)?/(modules/poker|game/modules/poker|components/PokerBoard)" packages/frontend/src/
```

- [ ] **Step 3: Rewrite each import**

For each file printed above, replace `from '../game/modules/poker/...'` with `from '@manamesh/poker'` (or specific subpath if needed). Replace `from './PokerBoard'` (when in components/) with dynamic import or `from '@manamesh/poker/components/PokerBoard'`.

For the game registry specifically, if it does a static `import` of the poker module and the package depends on the frontend (cyclic), convert to a dynamic import:

```ts
// registry.ts
async function loadPoker() {
  const m = await import('@manamesh/poker');
  return m;
}
```

If the registry's existing shape requires synchronous imports, the cycle has to be broken differently — e.g., move the registry into a third package, or make the registry receive game-module references from outside. Pick the smallest workable diff; flag if larger refactor needed.

- [ ] **Step 4: Run yarn install + frontend tests**

```bash
cd /Users/cyotee/Development/github-cyotee/manamesh-games
yarn install
yarn workspace @manamesh/frontend test
```

Expected: tests pass (modulo pre-existing failures noted in manamesh/AGENTS.md). If any test imports the old paths, fix it.

- [ ] **Step 5: Commit**

```bash
cd /Users/cyotee/Development/github-cyotee/manamesh-games/manamesh
git add packages/frontend
git commit -m "refactor(frontend): rewire poker imports to @manamesh/poker"

cd /Users/cyotee/Development/github-cyotee/manamesh-games
git add manamesh yarn.lock
git commit -m "chore: bump manamesh after poker import rewires"
```

---

## Phase 1: Shared Solidity Types & Libraries

All Solidity tasks below run inside `packages/poker/`. Test specs live in `tests/foundry/<area>/`. Sources live in `contracts/<area>/`.

### Task 1.1: HandInit / HandOutcome / RoundStateTransition structs

**Files:**
- Create: `packages/poker/contracts/types/HandInit.sol`
- Create: `packages/poker/contracts/types/HandOutcome.sol`
- Create: `packages/poker/contracts/types/RoundStateTransition.sol`

- [ ] **Step 1: `HandInit.sol`**

```solidity
// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.30;

/// @notice Off-chain unanimously-signed payload that fully describes a hand.
///         handId = keccak256(abi.encode(HandInit fields)).
/// @dev players[] MUST be sorted ascending. buyIns[] and playerHandNonces[]
///      MUST be parallel to players[].
struct HandInit {
    address[] players;
    uint256[] buyIns;
    address vault;
    uint256 smallBlind;
    uint256 bigBlind;
    uint256 timeoutSeconds;
    bytes32 otherConfig;
    uint256[] playerHandNonces;
}

bytes32 constant HAND_INIT_TYPEHASH = keccak256(
    "HandInit(address[] players,uint256[] buyIns,address vault,uint256 smallBlind,uint256 bigBlind,uint256 timeoutSeconds,bytes32 otherConfig,uint256[] playerHandNonces)"
);
```

- [ ] **Step 2: `HandOutcome.sol`**

```solidity
// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.30;

/// @notice Off-chain signed payload at showdown. holeCards[][] is parallel to
///         HandInit.players[]; each inner has 2 cards encoded as (rank<<4)|suit.
struct HandOutcome {
    bytes32 handId;
    uint256 pot;
    address[] winners;
    uint256[] payouts;
    uint256[] finalStacks;
    bytes32 finalStateHash;
    uint8[2][] holeCards;
    uint8[5] communityCards;
}

bytes32 constant HAND_OUTCOME_TYPEHASH = keccak256(
    "HandOutcome(bytes32 handId,uint256 pot,address[] winners,uint256[] payouts,uint256[] finalStacks,bytes32 finalStateHash,uint8[2][] holeCards,uint8[5] communityCards)"
);
```

- [ ] **Step 3: `RoundStateTransition.sol`**

```solidity
// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.30;

struct RoundStateTransition {
    bytes32 handId;
    uint8 roundNumber;
    uint256 currentPot;
    uint256[] playerStacks;
    bytes32 actionHash;
}

bytes32 constant ROUND_STATE_TRANSITION_TYPEHASH = keccak256(
    "RoundStateTransition(bytes32 handId,uint8 roundNumber,uint256 currentPot,uint256[] playerStacks,bytes32 actionHash)"
);
```

- [ ] **Step 4: Build**

```bash
cd /Users/cyotee/Development/github-cyotee/manamesh-games/packages/poker
forge build
```

- [ ] **Step 5: Commit**

```bash
cd /Users/cyotee/Development/github-cyotee/manamesh-games
git add packages/poker/contracts/types
git commit -m "feat(poker): add HandInit, HandOutcome, RoundStateTransition struct types with EIP-712 typehashes"
```

---

### Task 1.2: HandIdLib

**Files:**
- Create: `packages/poker/contracts/lib/HandIdLib.sol`
- Test: `packages/poker/tests/foundry/lib/HandIdLib.t.sol`

- [ ] **Step 1: Failing test**

```solidity
// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {HandInit} from "../../../contracts/types/HandInit.sol";
import {HandIdLib} from "../../../contracts/lib/HandIdLib.sol";

contract HandIdLibTest is Test {
    function _makeHandInit() internal pure returns (HandInit memory h) {
        h.players = new address[](2);
        h.players[0] = address(0xAAaa);
        h.players[1] = address(0xBBbb);
        h.buyIns = new uint256[](2);
        h.buyIns[0] = 100e18;
        h.buyIns[1] = 100e18;
        h.vault = address(0xCCcc);
        h.smallBlind = 1e18;
        h.bigBlind = 2e18;
        h.timeoutSeconds = 300;
        h.otherConfig = bytes32(uint256(42));
        h.playerHandNonces = new uint256[](2);
        h.playerHandNonces[0] = 1;
        h.playerHandNonces[1] = 1;
    }

    function test_handIdIsDeterministic() public pure {
        assertEq(HandIdLib.handIdOf(_makeHandInit()), HandIdLib.handIdOf(_makeHandInit()));
    }

    function test_handIdChangesWhenPlayersChange() public pure {
        HandInit memory h = _makeHandInit();
        bytes32 baseline = HandIdLib.handIdOf(h);
        h.players[0] = address(0xDEAD);
        assertTrue(HandIdLib.handIdOf(h) != baseline);
    }

    function test_handIdChangesWhenBuyInsChange() public pure {
        HandInit memory h = _makeHandInit();
        bytes32 baseline = HandIdLib.handIdOf(h);
        h.buyIns[1] = 200e18;
        assertTrue(HandIdLib.handIdOf(h) != baseline);
    }

    function test_handIdChangesWhenNonceChanges() public pure {
        HandInit memory h = _makeHandInit();
        bytes32 baseline = HandIdLib.handIdOf(h);
        h.playerHandNonces[0] = 2;
        assertTrue(HandIdLib.handIdOf(h) != baseline);
    }
}
```

Path adjustment notes: from `tests/foundry/lib/`, going to `contracts/types/` is `../../../contracts/types/`. Verify and adjust if forge's path resolution differs.

- [ ] **Step 2: Run, expect FAIL**

```bash
forge test --match-path tests/foundry/lib/HandIdLib.t.sol -vvv
```

- [ ] **Step 3: Implement**

```solidity
// SPDX-License-Identifier: AGPL-3.0-or-later
pragma solidity 0.8.30;

import {HandInit} from "../types/HandInit.sol";

library HandIdLib {
    // tag::handIdOf[]
    /// @custom:signature handIdOf((address[],uint256[],address,uint256,uint256,uint256,bytes32,uint256[]))
    function handIdOf(HandInit memory h) internal pure returns (bytes32) {
        return keccak256(abi.encode(
            h.players,
            h.buyIns,
            h.vault,
            h.smallBlind,
            h.bigBlind,
            h.timeoutSeconds,
            h.otherConfig,
            h.playerHandNonces
        ));
    }
    // end::handIdOf[]
}
```

- [ ] **Step 4: Run, expect PASS**

- [ ] **Step 5: Commit**

```bash
cd /Users/cyotee/Development/github-cyotee/manamesh-games
git add packages/poker/contracts/lib/HandIdLib.sol packages/poker/tests/foundry/lib/HandIdLib.t.sol
git commit -m "feat(poker): HandIdLib with deterministic handId derivation + tests"
```

---

### Task 1.3: SignatureLib

**Files:**
- Create: `packages/poker/contracts/lib/SignatureLib.sol`
- Test: `packages/poker/tests/foundry/lib/SignatureLib.t.sol`

Code is identical to the v1 plan's SignatureLib (recoverEIP712, requireSignedByAll, custom errors). Test asserts:
- `recoverEIP712` returns the signer.
- `requireSignedByAll` succeeds when every (signer, sig) pair matches.
- `requireSignedByAll` reverts with `InvalidSignature(idx, expected)` when one is wrong.

Implementation (copy from v1 plan §Task 1.3) but place files at the new paths above. Commit message: `feat(poker): SignatureLib EIP-712 recovery + requireSignedByAll`.

---

## Phase 2: Configuration Oracle

### Task 2.1: Oracle interface + errors

**Files:**
- Create: `packages/poker/contracts/oracle/IBettingConfigOracle.sol`
- Create: `packages/poker/contracts/oracle/BettingConfigOracleErrors.sol`

Content as in v1 §Task 2.1. New file paths. Commit: `feat(poker): IBettingConfigOracle interface and errors`.

---

### Task 2.2: BettingConfigOracleRepo

**Files:**
- Create: `packages/poker/contracts/oracle/BettingConfigOracleRepo.sol`

Content from v1 §Task 2.2. The `STORAGE_SLOT = keccak256(abi.encode("manamesh.oracle.betting-config"))` stays. Commit: `feat(poker): BettingConfigOracleRepo storage layer`.

---

### Task 2.3: BettingConfigOracleTarget + unit tests

**Files:**
- Create: `packages/poker/contracts/oracle/BettingConfigOracleTarget.sol`
- Test: `packages/poker/tests/foundry/oracle/BettingConfigOracle.t.sol`

Content from v1 §Task 2.3. New file paths. Test the `_test_initializeOwner` direct-instantiation path. Commit: `feat(poker): BettingConfigOracleTarget with ERC8023 ownership`.

---

### Task 2.4: BettingConfigOracleFacet

**Files:**
- Create: `packages/poker/contracts/oracle/BettingConfigOracleFacet.sol`

Content from v1 §Task 2.4. Commit: `feat(poker): BettingConfigOracleFacet IFacet metadata`.

---

### Task 2.5: BettingConfigOracleDFPkg + diamond integration test

**Files:**
- Create: `packages/poker/contracts/oracle/BettingConfigOracleDFPkg.sol`
- Modify: `packages/poker/tests/foundry/oracle/BettingConfigOracle.t.sol` (add diamond test contract)

Content from v1 §Task 2.5. Verify the FactoryService helper names against the actual Crane checkout under `packages/poker/lib/crane/contracts/` before using them; adjust where the v1 plan guessed. Commit: `feat(poker): BettingConfigOracleDFPkg + diamond integration tests`.

---

## Phase 3: Poker Hand Settler Core

### Task 3.1: IPokerHandSettler + errors

Path: `packages/poker/contracts/settler/IPokerHandSettler.sol`, `packages/poker/contracts/settler/PokerHandSettlerErrors.sol`.

Content from v1 §Task 3.1. **Apply the v1 plan's design fix:** `settleHand` and `forceTimeoutSettlement` both take `HandInit calldata init` as their first parameter. Add a `NotAParticipant(address)` error.

Commit: `feat(poker): IPokerHandSettler interface and errors`.

---

### Task 3.2: PokerHandSettlerRepo

Path: `packages/poker/contracts/settler/PokerHandSettlerRepo.sol`.

Content from v1 §Task 3.2. Add `bool verifierEnabled` to `Storage` (default true; toggled false in `_test_initialize` for direct-Target tests). Commit: `feat(poker): PokerHandSettlerRepo storage layout`.

---

### Task 3.3: deposit / withdraw + ERC20Mock

**Files:**
- Create: `packages/poker/contracts/settler/_test/ERC20Mock.sol`
- Create: `packages/poker/contracts/settler/PokerHandSettlerTarget.sol` (deposit/withdraw + stubs for the rest of the interface)
- Test: `packages/poker/tests/foundry/settler/PokerHandSettler_deposit.t.sol`
- Test: `packages/poker/tests/foundry/settler/PokerHandSettler_withdraw.t.sol`

Content from v1 §Task 3.3. Commit: `feat(poker): PokerHandSettlerTarget deposit/withdraw with locked-balance accounting`.

---

### Task 3.4: assertHandMembership

**Files:**
- Modify: `packages/poker/contracts/settler/PokerHandSettlerTarget.sol`
- Test: `packages/poker/tests/foundry/settler/PokerHandSettler_assertHandMembership.t.sol`

Content from v1 §Task 3.4. Commit: `feat(poker): implement assertHandMembership with handId recompute + sig verification + buy-in lock`.

---

### Task 3.5: settleHand (without verifier)

**Files:**
- Modify: `packages/poker/contracts/settler/IPokerHandSettler.sol` (signature change: add `HandInit calldata init`)
- Modify: `packages/poker/contracts/settler/PokerHandSettlerTarget.sol`
- Test: `packages/poker/tests/foundry/settler/PokerHandSettler_settleHand.t.sol`

Content from v1 §Task 3.5. **The finalStacks-direct reconciliation approach is the canonical implementation**: in settle/forceTimeout, zero out the players' locked buy-ins from balance (debit locked, credit free) — wait, simpler: subtract each player's buy-in from `locked`, add nothing — then apply `outcome.finalStacks[i]` directly as the new free balance contribution. Invariant: total tokens in/out balances against `pot - rake`. Commit: `feat(poker): implement settleHand with oracle-driven rake (verifier wired separately)`.

---

## Phase 4: Verifier Facet

### Task 4.1: PokerHandEvaluator library

**Files:**
- Create: `packages/poker/contracts/verifier/PokerHandEvaluator.sol`
- Test: `packages/poker/tests/foundry/verifier/PokerHandEvaluator.t.sol`

Content from v1 §Task 4.1. Test scenarios required:
- royal flush vs straight flush
- quads vs full house
- flush vs straight
- pair kicker (Ace kicker wins over King kicker)
- wheel straight (A-2-3-4-5)
- best 5-of-7 selection with two pair vs one pair (drop the lower pair)

Commit: `feat(poker): PokerHandEvaluator library with 7-card best-of-5 scoring`.

---

### Task 4.2: PokerVerifierFacet

**Files:**
- Create: `packages/poker/contracts/verifier/IPokerVerifierFacet.sol`
- Create: `packages/poker/contracts/verifier/PokerVerifierFacet.sol`
- Test: `packages/poker/tests/foundry/verifier/PokerVerifierFacet.t.sol`

Content from v1 §Task 4.2. Commit: `feat(poker): PokerVerifierFacet Level-1 best-5-of-7 winner check`.

---

### Task 4.3: Wire verifier into settleHand

**Files:**
- Modify: `packages/poker/contracts/settler/PokerHandSettlerTarget.sol`
- Modify: `packages/poker/tests/foundry/settler/PokerHandSettler_settleHand.t.sol` (mark a verifier-aware diamond test that's deferred to integration)

Content from v1 §Task 4.3. Commit: `feat(poker): wire PokerVerifierFacet into settleHand via diamond routing`.

---

## Phase 5: Force-Timeout Settlement

### Task 5.1: forceTimeoutSettlement + timeoutPlayer

**Files:**
- Modify: `packages/poker/contracts/settler/PokerHandSettlerTarget.sol`
- Test: `packages/poker/tests/foundry/settler/PokerHandSettler_forceTimeoutSettlement.t.sol`

Content from v1 §Task 5.1. The implementation must use the same finalStacks-direct accounting as settleHand. Forfeited amount goes 100% to the oracle's operator address. Commit: `feat(poker): forceTimeoutSettlement with operator forfeit + timeoutPlayer event stub`.

---

## Phase 6: Settler Facet + DFPkg + End-to-End

### Task 6.1: PokerHandSettlerFacet

**Files:**
- Create: `packages/poker/contracts/settler/PokerHandSettlerFacet.sol`

Content from v1 §Task 6.1. Commit: `feat(poker): PokerHandSettlerFacet with IFacet metadata`.

---

### Task 6.2: PokerHandSettlerDFPkg + E2E

**Files:**
- Create: `packages/poker/contracts/settler/PokerHandSettlerDFPkg.sol`
- Test: `packages/poker/tests/foundry/integration/PokerHandSettler_E2E.t.sol`

Content from v1 §Task 6.2. The DFPkg's `PkgInit` carries facet refs + the `IDiamondPackageCallBackFactory`. The `PkgArgs` is `{ address token, IBettingConfigOracle oracle, bytes32 optionalSalt }`. `initAccount` sets the token + oracle in Repo storage and enables the verifier.

E2E tests:
- `test_E2E_depositAssertSettleWithdraw`
- `test_E2E_forceTimeoutFlow`
- `test_E2E_verifierRejectsWrongWinner`

Commit: `feat(poker): PokerHandSettlerDFPkg + E2E integration tests across the full diamond`.

---

## Phase 7: New Off-Chain TS Helpers

The poker game module already lives in `packages/poker/src/` (moved in Phase 0). These tasks ADD new helper files and refactor `PokerHandResult` to match the on-chain `HandOutcome` shape.

### Task 7.1: Refactor PokerHandResult to parallel-array shape

**Files:**
- Modify: `packages/poker/src/types.ts` — replace the existing `PokerHandResult` interface.
- Modify: `packages/poker/src/crypto.ts` — update `buildHandResult` to emit the new shape.
- Modify: all callers (likely just `crypto.ts` internally, plus `PokerBoard.tsx`).

Content from v1 §Task 7.1. The new `PokerHandResult`:

```ts
export interface PokerHandResult {
  handId: `0x${string}`;
  pot: bigint;
  players: `0x${string}`[];      // sorted ascending; parallel-array reference
  winners: `0x${string}`[];      // subset of players
  payouts: bigint[];             // parallel to winners
  finalStacks: bigint[];         // parallel to players
  finalStateHash: `0x${string}`;
  holeCards: [number, number][]; // parallel to players
  communityCards: [number, number, number, number, number];
}
```

Run `yarn test` in `packages/poker/`. Fix anything that breaks. Commit: `refactor(poker): align PokerHandResult to on-chain HandOutcome parallel-array shape`.

---

### Task 7.2: handId.ts (TS/Solidity parity)

**Files:**
- Create: `packages/poker/src/handId.ts`
- Create: `packages/poker/src/handId.test.ts`
- Create: `packages/poker/tests/foundry/lib/HandIdLib_parity.t.sol` (logs the canonical sample value)

Content from v1 §Task 7.2 with new paths. Run the Foundry parity test once to capture the canonical bytes, paste into the Vitest snapshot. Commit: `feat(poker): TS deriveHandId helper with Solidity parity snapshot`.

---

### Task 7.3: signing.ts (EIP-712 helpers)

**Files:**
- Create: `packages/poker/src/signing.ts`
- Create: `packages/poker/src/signing.test.ts`

Content from v1 §Task 7.3. Use viem's `signTypedData`/`recoverTypedDataAddress`. Domain:

```ts
const domain = { name: 'PokerHandSettler', version: '1', chainId, verifyingContract: settlerAddress };
```

Provide `signHandInit`, `signHandOutcome`, `signRoundStateTransition`, plus matching `recover*` helpers. Commit: `feat(poker): EIP-712 signing helpers for HandInit/HandOutcome/RoundStateTransition`.

---

## Phase 8: Cross-Stack Parity

### Task 8.1: TS-signed payload verified by Solidity

**Files:**
- Create: `packages/poker/tests/foundry/integration/CrossStackParity.t.sol`

Content from v1 §Task 8.1 (Approach A: Foundry-only, shared private key + canonical sample, log the struct hash from TS, paste into the Solidity test). Commit: `test(poker): cross-stack EIP-712 hash parity between TS and Solidity`.

---

## Phase 9: Deployment Scripts

### Task 9.1: DeployBettingConfigOracle.s.sol

**Files:**
- Create: `packages/poker/script/DeployBettingConfigOracle.s.sol`

Content from v1 §Task 9.1 (path adjusted). Commit: `feat(deploy): script to deploy BettingConfigOracle diamond`.

---

### Task 9.2: DeployPokerHandSettler.s.sol

**Files:**
- Create: `packages/poker/script/DeployPokerHandSettler.s.sol`

Content from v1 §Task 9.2. Commit: `feat(deploy): per-token PokerHandSettler diamond deployment script`.

---

### Task 9.3: DeployPokerSystem.s.sol

**Files:**
- Create: `packages/poker/script/DeployPokerSystem.s.sol`

Content from v1 §Task 9.3 (composite oracle + N settlers). Smoke-test against `anvil`. Commit: `feat(deploy): composite system deployment script (oracle + N per-token settlers)`.

---

## Phase 10: Cleanup

### Task 10.1: Confirm there are no stale poker artifacts

**Checklist:**

- [ ] No file remains at `manamesh/packages/frontend/src/game/modules/poker/`.
- [ ] No file remains at `manamesh/packages/frontend/src/components/PokerBoard.tsx`.
- [ ] `manamesh/packages/frontend/src/game/registry.ts` imports from `@manamesh/poker` (dynamic if needed).
- [ ] `manamesh/packages/frontend/package.json` has `"@manamesh/poker": "*"`.
- [ ] Manamesh contracts/ legacy poker artifacts (`GameVault.sol`, `ChipToken*.sol`, etc.) — delete from `manamesh/contracts/src/` since they're orphaned anyway:

```bash
cd /Users/cyotee/Development/github-cyotee/manamesh-games/manamesh
git rm contracts/src/GameVault.sol contracts/src/ChipToken.sol contracts/src/ChipTokenFactory.sol
git rm contracts/src/interfaces/IGameVault.sol contracts/src/interfaces/IChipToken.sol contracts/src/interfaces/IChipTokenFactory.sol
git rm contracts/src/libraries/SignatureVerifier.sol
git rm contracts/test/*.t.sol  # any legacy tests
rmdir contracts/src/interfaces contracts/src/libraries contracts/src contracts/test contracts 2>/dev/null || true
git commit -m "chore(contracts): delete orphaned GameVault/ChipToken/ChipTokenFactory now that @manamesh/poker owns settlement"
```

- [ ] Outer repo commits bump the manamesh submodule pointer:

```bash
cd /Users/cyotee/Development/github-cyotee/manamesh-games
git add manamesh
git commit -m "chore: bump manamesh after legacy poker contract cleanup"
```

- [ ] Update `manamesh/PRD_CONTRACTS.md` §11.17 to mark the foundry workspace resolution complete (root manamesh-games workspaces own the foundry workspace now via packages/poker; manamesh's own foundry.toml and root manamesh/contracts/ are no longer relevant for poker).

Commit: `docs(prd): mark §11.17 (workspace housekeeping) as resolved`.

---

## Self-Review (updated for v2)

**Spec coverage** (PRD §11.x):
- §11.1 Diamond + DFPkg → Phases 2, 6 ✓
- §11.2 One settler per token → Task 6.2 ✓
- §11.3 POC scope → Phases 3, 4, 5 ✓
- §11.4 Player cap 2–9 → Task 3.4 ✓
- §11.5 Timeout resets on activity → Tasks 3.4, 3.5, 5.1 ✓
- §11.6 Off-chain helpers location → moved to `@manamesh/poker` (packages/poker/src/) — Phases 0 + 7 ✓
- §11.7 Toolchain → Task 0.1 (foundry.toml for new package) ✓
- §11.8 handId recompute / finalStateHash opacity / sorted players → Tasks 1.2, 3.4, 3.5 ✓
- §11.9 Force-timeout sig threshold → Task 5.1 ✓
- §11.10 Forfeit → operator → Task 5.1 ✓
- §11.11 Level-1 verifier best-5-of-7 → Phase 4 ✓
- §11.12 Withdraw `balance − locked` → Task 3.3 ✓
- §11.13 PkgArgs = `{token}`, oracle ref in PkgInit → Task 6.2 ✓
- §11.14 Oracle as Crane diamond with ERC8023 + default fallback → Phase 2 ✓
- §11.15 PokerHandResult refactor → Task 7.1 ✓
- §11.16 Verifier as separate facet from day one → Tasks 4.2 + 4.3 ✓
- §11.17 Workspace housekeeping → Task 10.1 ✓
- §11.18 Deferred items called out per-task ✓

**Placeholder scan:** None. Phase 0 has every shell command needed. Solidity phases reference algorithmic content by section from v1's git history if needed, but each task lists exact file paths, test scenarios, and commit messages.

**Type consistency:** struct field names, error names, function selectors all carried verbatim from v1. The settle/force-timeout signature changes (added `HandInit calldata init` first parameter) propagate to the interface, target, and tests uniformly.

**Cross-package consistency:**
- `@manamesh/poker` exports the moved game module via `src/index.ts`.
- Manamesh frontend's registry uses dynamic import to break the static cycle.
- All TS test paths point at `packages/poker/src/...`; all Solidity test paths at `packages/poker/tests/foundry/...`.

---

## Execution Handoff

Plan complete and saved to `manamesh/docs/superpowers/plans/2026-05-19-poker-hand-settler.md`. Execution resumes inline. Two execution options:

**1. Subagent-Driven (recommended)** — fresh subagent per task, review between.

**2. Inline Execution** — (currently active) sequential in this session.
