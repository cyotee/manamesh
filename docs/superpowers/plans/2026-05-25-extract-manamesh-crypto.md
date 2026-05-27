# Extract @manamesh/crypto Embedded Package Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the cryptographic primitives currently living in `manamesh/packages/frontend/src/crypto/` (and `src/zk/`) into a new in-tree embedded package `manamesh-games/packages/crypto/` (`@manamesh/crypto`), so War, Go Fish, OnePiece, Threshold Tally, Battleship, and `@manamesh/poker` all consume crypto from one shared package instead of via fragile `@manamesh/frontend/src/...` deep paths.

**Architecture:** `@manamesh/crypto` is a **leaf package with zero internal dependencies**. It owns all crypto sources plus the snarkjs `zk/` helpers. Its only outbound coupling — the `CoreCard` type used as a generic bound in `crypto-plugin.ts` — is broken by defining a minimal `CoreCard` locally in the package; the frontend's `game/modules/types.ts` keeps its own structurally-compatible `CoreCard`, so no frontend type churn. Consumers (frontend modules + the poker package) import from `@manamesh/crypto` (barrel) or its explicit subpath exports (so heavy `snarkjs`/`paillier` stay out of light code-split chunks). Dependency direction is strictly one-way: frontend → crypto, poker → crypto. No cycles.

**Tech Stack:** TypeScript 5.6, Vitest 2.1, yarn 4 workspaces, elliptic ^6.5.5, snarkjs ^0.7.6, boardgame.io ^0.50.2 (peer).

**Reference docs:**
- `manamesh/docs/superpowers/plans/2026-05-19-poker-hand-settler.md` — the sibling poker-extraction plan; mirror its package layout + commit conventions.
- `packages/poker/package.json` — concrete embedded-package example in this repo.

**Repo layout reminder:**
- **Outer meta-repo:** `manamesh-games/` (commits for the new package land here).
- **Submodule:** `manamesh-games/manamesh/` (frontend import rewires commit here).
- **Workspaces root:** `manamesh-games/package.json` (`workspaces: ["packages/*", "manamesh/packages/*"]`) — `packages/crypto` is auto-included by `packages/*`.

**Commit convention:** Per the user's instruction, **do not commit** during this work — leave the working tree dirty until the codebase is verified stable. All "Commit" steps below are deferred; each task ends with a verification gate instead.

---

## Crypto source inventory (the move set)

Moving from `manamesh/packages/frontend/src/crypto/` → `packages/crypto/src/`:

```
dleq.ts  ec-elgamal-exp.ts  ecdsa.ts  feldman-dkg.ts  index.ts
merkle.ts  paillier.ts  paillier.test.ts  range-proof-vkey.ts
secp256k1.ts  sha256.ts  snarkjs-range.ts  stable-json.ts
circuits/README.md  circuits/range_proof.circom
mental-poker/{commitment,shuffle-proof,sra,types,index}.ts + 3 *.test.ts + README.md
plugin/{crypto-plugin,index}.ts + crypto-plugin.test.ts
shamirs/{reconstruct,split,types,index}.ts + shamirs.test.ts
```

And `manamesh/packages/frontend/src/zk/` → `packages/crypto/src/zk/`:

```
zk/{index,verify}.ts + snarkjs-smoke.test.ts
```

**Outbound couplings to break (only two):**
1. `crypto/index.ts` line: `export * from "../zk";` → becomes `export * from "./zk";` (zk now lives inside the package).
2. `crypto/plugin/crypto-plugin.ts:15`: `import type { CoreCard } from "../../game/modules/types";` → replaced by a local minimal `CoreCard` (Task 2).

**Consumers to rewire (frontend), by current relative specifier:**
`../../../crypto/mental-poker`, `../crypto/mental-poker`, `../crypto/mental-poker/types`,
`../../crypto/paillier`, `../../../crypto/secp256k1`, `../../../crypto/plugin/crypto-plugin`,
`../crypto/plugin/crypto-plugin`, `../../../crypto/stable-json`, `../../../crypto/sha256`,
`../../../crypto/ecdsa`, `../zk`.

Consumer files: `game/modules/{threshold-tally/types,gofish/crypto,gofish/types,onepiece/peek,onepiece/proofChain,onepiece/types,onepiece/crypto,onepiece/crypto.test,war/crypto,he-battleship/logic}.ts`, `components/{CryptoTransparencyPanel,GoFishBoard,OnePiecePhaserBoard}.tsx`, `blockchain/wallet/mock-wallet.ts`, `wallet/hooks/useGameKeys.ts`.

**Consumers to rewire (poker package):** `packages/poker/src/{crypto,PokerBoard,...}` — specifiers `@manamesh/frontend/src/crypto/mental-poker`, `.../mental-poker/types`, `.../plugin/crypto-plugin`, `.../secp256k1`.

---

## Task 0: Scaffold packages/crypto

**Files:**
- Create: `packages/crypto/package.json`
- Create: `packages/crypto/tsconfig.json`
- Create: `packages/crypto/vitest.config.ts`
- Create: `packages/crypto/.gitignore`
- Create: `packages/crypto/README.md`

- [ ] **Step 1: Create the directory**

```bash
cd /Users/cyotee/Development/github-cyotee/manamesh-games
mkdir -p packages/crypto/src
```

- [ ] **Step 2: Write `packages/crypto/package.json`** (subpath exports listed explicitly; barrel `.` plus every deep path any consumer uses)

```json
{
  "name": "@manamesh/crypto",
  "version": "0.1.0",
  "description": "Cryptographic primitives for ManaMesh — mental poker (SRA), Merkle commitments, EC ElGamal, Feldman DKG, DLEQ, ECDSA, Paillier HE, Shamir SSS, snarkjs ZK helpers, and the boardgame.io crypto plugin.",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./mental-poker": "./src/mental-poker/index.ts",
    "./mental-poker/types": "./src/mental-poker/types.ts",
    "./plugin": "./src/plugin/index.ts",
    "./plugin/crypto-plugin": "./src/plugin/crypto-plugin.ts",
    "./shamirs": "./src/shamirs/index.ts",
    "./zk": "./src/zk/index.ts",
    "./sha256": "./src/sha256.ts",
    "./merkle": "./src/merkle.ts",
    "./stable-json": "./src/stable-json.ts",
    "./secp256k1": "./src/secp256k1.ts",
    "./ec-elgamal-exp": "./src/ec-elgamal-exp.ts",
    "./feldman-dkg": "./src/feldman-dkg.ts",
    "./dleq": "./src/dleq.ts",
    "./ecdsa": "./src/ecdsa.ts",
    "./paillier": "./src/paillier.ts",
    "./snarkjs-range": "./src/snarkjs-range.ts",
    "./range-proof-vkey": "./src/range-proof-vkey.ts"
  },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "peerDependencies": {
    "boardgame.io": "^0.50.2"
  },
  "dependencies": {
    "elliptic": "^6.5.5",
    "snarkjs": "^0.7.6"
  },
  "devDependencies": {
    "@types/elliptic": "^6.4.0",
    "typescript": "^5.6.2",
    "vitest": "^2.1.1"
  }
}
```

- [ ] **Step 3: Write `packages/crypto/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
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

- [ ] **Step 4: Write `packages/crypto/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
});
```

- [ ] **Step 5: Write `packages/crypto/.gitignore`**

```
node_modules/
dist/
*.log
```

- [ ] **Step 6: Write `packages/crypto/README.md`** — 8–12 lines: this package holds ManaMesh's shared cryptographic primitives, consumed by `@manamesh/frontend` game modules and `@manamesh/poker`; it is a leaf package with no internal dependencies; list the main entry points (mental-poker, plugin, merkle, paillier, zk).

- [ ] **Step 7: Verify** — `packages/crypto/` exists with the five files. Root `package.json` already globs `packages/*`, so no workspaces edit needed. Do NOT run `yarn install` yet (deferred to Task 5).

---

## Task 1: Move crypto + zk sources into the package

**Files:**
- Move: `manamesh/packages/frontend/src/crypto/*` → `packages/crypto/src/*`
- Move: `manamesh/packages/frontend/src/zk/*` → `packages/crypto/src/zk/*`
- Modify: `packages/crypto/src/index.ts` (fix `../zk` → `./zk`)

- [ ] **Step 1: Move the directories** (filesystem move, not `git mv` — crosses the submodule boundary)

```bash
cd /Users/cyotee/Development/github-cyotee/manamesh-games
mv manamesh/packages/frontend/src/crypto packages/crypto/src/crypto-tmp
mv packages/crypto/src/crypto-tmp/* packages/crypto/src/
rmdir packages/crypto/src/crypto-tmp
mv manamesh/packages/frontend/src/zk packages/crypto/src/zk
```

After this, `packages/crypto/src/` contains `index.ts`, `mental-poker/`, `plugin/`, `shamirs/`, `circuits/`, the flat `*.ts` files, and `zk/`.

- [ ] **Step 2: Fix the zk re-export in `packages/crypto/src/index.ts`**

```diff
-// ZK helpers (snarkjs wrapper; circuits/artifacts live under src/zk)
-export * from "../zk";
+// ZK helpers (snarkjs wrapper; circuits live under src/circuits)
+export * from "./zk";
```

- [ ] **Step 3: Confirm no other parent-relative imports escape the package**

```bash
cd /Users/cyotee/Development/github-cyotee/manamesh-games
grep -rnE "from ['\"]\.\.?/\.\." packages/crypto/src --include="*.ts" || echo "NONE — good"
```

Expected: the only hit is `plugin/crypto-plugin.ts` importing `CoreCard` (fixed in Task 2). Everything else resolves within the package.

- [ ] **Step 4: Verify** — `grep -rn "from \"../../game" packages/crypto/src` returns only the `crypto-plugin.ts:15` `CoreCard` line.

---

## Task 2: Decouple the `CoreCard` type

**Files:**
- Modify: `packages/crypto/src/plugin/crypto-plugin.ts:15`

The plugin uses `CoreCard` only as a generic default bound (`<TCard extends CoreCard = CoreCard>`). Replace the cross-package import with a local minimal interface matching the frontend's shape (`id`, `name`, optional CIDs). Structural typing keeps frontend/poker cards assignable.

- [ ] **Step 1: Replace the import with a local definition**

```diff
-import type { CoreCard } from "../../game/modules/types";
+/**
+ * Minimal card contract the crypto plugin operates over. The frontend's
+ * `game/modules/types.ts` defines a structurally-compatible `CoreCard`;
+ * any card with at least an `id` and `name` satisfies this bound.
+ */
+export interface CoreCard {
+  id: string;
+  name: string;
+  imageCid?: string;
+  backImageCid?: string;
+}
```

- [ ] **Step 2: Verify the package type-checks**

```bash
cd /Users/cyotee/Development/github-cyotee/manamesh-games/packages/crypto
yarn dlx tsc --noEmit -p tsconfig.json 2>&1 | tail -20 || true
```

Note: this runs before `yarn install`, so dependency types may be missing. If `elliptic`/`snarkjs`/`boardgame.io` type resolution errors appear, defer the full typecheck to Task 5 Step 3 (after install) and instead verify here only that no `Cannot find module '../../game/modules/types'` error remains.

- [ ] **Step 3: Verify** — `grep -rn "game/modules/types" packages/crypto/src` returns nothing.

---

## Task 3: Rewire frontend consumers to @manamesh/crypto

**Files:**
- Modify: `manamesh/packages/frontend/package.json` — add `"@manamesh/crypto": "*"` to `dependencies`.
- Modify (rewrite crypto/zk imports): the consumer files listed in the inventory above.

- [ ] **Step 1: Add the dependency**

In `manamesh/packages/frontend/package.json` `dependencies`, add:

```json
"@manamesh/crypto": "*"
```

- [ ] **Step 2: Rewrite every relative crypto/zk import to the package**

For each consumer file, rewrite the specifier (preserve the named imports unchanged — only the module string changes):

| Old relative specifier (any `../` depth) | New specifier |
|---|---|
| `.../crypto/mental-poker` | `@manamesh/crypto/mental-poker` |
| `.../crypto/mental-poker/types` | `@manamesh/crypto/mental-poker/types` |
| `.../crypto/plugin/crypto-plugin` | `@manamesh/crypto/plugin/crypto-plugin` |
| `.../crypto/secp256k1` | `@manamesh/crypto/secp256k1` |
| `.../crypto/paillier` | `@manamesh/crypto/paillier` |
| `.../crypto/sha256` | `@manamesh/crypto/sha256` |
| `.../crypto/stable-json` | `@manamesh/crypto/stable-json` |
| `.../crypto/ecdsa` | `@manamesh/crypto/ecdsa` |
| `.../zk` | `@manamesh/crypto/zk` |

Apply with a guarded sweep, then hand-verify each hit:

```bash
cd /Users/cyotee/Development/github-cyotee/manamesh-games/manamesh/packages/frontend
# Show all sites first:
grep -rnE "from ['\"][^'\"]*((/|^)crypto/|/zk['\"])" src --include="*.ts" --include="*.tsx" | grep -v "node_modules"
```

Rewrite each with `sed -i ''` per-file or via the editor. Example for one file:

```bash
# pattern: collapse any leading ../ chain before crypto/ or zk
perl -i -pe "s{from (['\"])(?:\.\./)+crypto/}{from \$1\@manamesh/crypto/}g; s{from (['\"])(?:\.\./)+zk\1}{from \${1}\@manamesh/crypto/zk\$1}g" src/game/modules/war/crypto.ts
```

Repeat for every consumer file from the inventory. **Verify the named imports still match what `@manamesh/crypto`'s subpaths export** (e.g. `paillier` exports are reachable via `@manamesh/crypto/paillier`).

- [ ] **Step 3: Confirm no stale relative crypto imports remain**

```bash
cd /Users/cyotee/Development/github-cyotee/manamesh-games/manamesh/packages/frontend
grep -rnE "from ['\"](\.\./)+crypto/" src --include="*.ts" --include="*.tsx" && echo "STALE FOUND" || echo "CLEAN"
grep -rnE "from ['\"](\.\./)+zk['\"]" src --include="*.ts" --include="*.tsx" && echo "STALE FOUND" || echo "CLEAN"
```

Expected: both print `CLEAN`.

- [ ] **Step 4: Verify** — deferred to Task 5 (frontend test run after `yarn install`).

---

## Task 4: Rewire @manamesh/poker to @manamesh/crypto

**Files:**
- Modify: `packages/poker/package.json` — add `"@manamesh/crypto": "workspace:*"` to `dependencies`.
- Modify: `packages/poker/src/crypto.ts`, `packages/poker/src/components/PokerBoard.tsx`, and any other poker source importing `@manamesh/frontend/src/crypto/...`.

- [ ] **Step 1: Add the dependency** to `packages/poker/package.json` `dependencies`:

```json
"@manamesh/crypto": "workspace:*"
```

- [ ] **Step 2: Rewrite poker's crypto imports**

```bash
cd /Users/cyotee/Development/github-cyotee/manamesh-games/packages/poker
grep -rnE "@manamesh/frontend/src/crypto/" src --include="*.ts" --include="*.tsx"
# Rewrite each: @manamesh/frontend/src/crypto/<rest>  ->  @manamesh/crypto/<rest>
grep -rlE "@manamesh/frontend/src/crypto/" src --include="*.ts" --include="*.tsx" | while read f; do
  perl -i -pe "s{\@manamesh/frontend/src/crypto/}{\@manamesh/crypto/}g" "$f"
done
```

Note: poker's NON-crypto frontend imports (`@manamesh/frontend/src/game/modules/types`, `.../components/...`, `.../hooks/...`, `.../assets/...`, `.../blockchain/wallet`) stay pointed at `@manamesh/frontend` — only `crypto/` specifiers move.

- [ ] **Step 3: Confirm no poker→frontend crypto imports remain**

```bash
cd /Users/cyotee/Development/github-cyotee/manamesh-games/packages/poker
grep -rnE "@manamesh/frontend/src/crypto/" src --include="*.ts" --include="*.tsx" && echo "STALE FOUND" || echo "CLEAN"
```

Expected: `CLEAN`.

- [ ] **Step 4: Verify** — deferred to Task 5.

---

## Task 5: Install + full verification gate

- [ ] **Step 1: Install workspaces from the root**

```bash
cd /Users/cyotee/Development/github-cyotee/manamesh-games
yarn install
```

Expected: succeeds and registers `@manamesh/crypto` as a workspace.

- [ ] **Step 2: Run the crypto package's own test suite**

```bash
yarn workspace @manamesh/crypto test
```

Expected: the moved test files (`paillier.test.ts`, `mental-poker/*.test.ts`, `plugin/crypto-plugin.test.ts`, `shamirs/shamirs.test.ts`, `zk/snarkjs-smoke.test.ts`) run and pass — modulo any pre-existing ESM/snarkjs failures already documented in `manamesh/AGENTS.md`. Record any failure as pre-existing only if it reproduces on the original code; do not "fix" by masking.

- [ ] **Step 3: Type-check the crypto package**

```bash
yarn workspace @manamesh/crypto typecheck
```

Expected: clean.

- [ ] **Step 4: Run the frontend test suite**

```bash
yarn workspace @manamesh/frontend test
```

Expected: same pass count as before extraction (~1126), modulo pre-existing failures. Any NEW failure must trace to an import that was missed in Task 3 — fix the import, re-run.

- [ ] **Step 5: Run the poker package tests + typecheck**

```bash
yarn workspace @manamesh/poker test
yarn workspace @manamesh/poker typecheck
```

Expected: pass (modulo the pre-existing `crypto.test.ts` ESM issue noted in the poker plan).

- [ ] **Step 6: Final coupling audit**

```bash
cd /Users/cyotee/Development/github-cyotee/manamesh-games
echo "crypto package must have NO internal imports:"
grep -rnE "from ['\"](\.\./)+(game|components|hooks|assets|blockchain|wallet)" packages/crypto/src --include="*.ts" || echo "LEAF — good"
echo "frontend must not deep-import its own deleted crypto dir:"
grep -rnE "from ['\"](\.\./)+crypto/" manamesh/packages/frontend/src --include="*.ts" --include="*.tsx" || echo "CLEAN"
```

Expected: `LEAF — good` and `CLEAN`. **Do not commit** — per the user's instruction the working tree stays dirty until the whole codebase (crypto + Phase 2 oracle) is confirmed stable.

---

## Self-Review

**Spec coverage:**
- Extract crypto into `@manamesh/crypto` → Tasks 0–2 ✓
- Move common code for reuse across games → Task 3 (frontend modules) + Task 4 (poker) ✓
- One-way dependency / no cycle → Task 2 (local `CoreCard`) + Task 5 Step 6 audit ✓
- Keep working tree (no commits) → commit steps deferred; verification gates replace them ✓
- Preserve code-split friendliness → explicit subpath exports (Task 0 Step 2) ✓

**Placeholder scan:** None — every step has exact paths/commands. The README body (Task 0 Step 6) is prose-by-design.

**Type consistency:** `CoreCard` shape in Task 2 matches the frontend's four fields (`id`, `name`, `imageCid?`, `backImageCid?`). Subpath export keys in Task 0 cover every specifier in the consumer inventory (Task 3 table + Task 4).

**Cross-package consistency:** frontend depends on `@manamesh/crypto` (`*`); poker depends on `@manamesh/crypto` (`workspace:*`) and keeps its non-crypto `@manamesh/frontend` imports; crypto depends on nothing internal.
