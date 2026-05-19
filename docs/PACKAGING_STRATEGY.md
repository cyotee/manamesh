# Packaging Strategy for ManaMesh

Date: 2026-05-19

## Goal

Segment the monorepo into publishable packages now, while keeping active development in this repository.
Design the layout so each package can later be moved to its own repository and re-included as a git submodule with minimal churn.

## Current Baseline

- Yarn v4 workspaces already enabled at repo root.
- Existing workspaces: packages/*, vendor/*.
- Two app-like workspaces today:
  - packages/frontend
  - packages/backend
- Frontend source already has clean domain seams:
  - src/crypto
  - src/game
  - src/p2p
  - src/deck

## Recommended Target Structure

Use a clear apps-vs-libraries split.

- apps/
  - frontend/
  - backend/
- packages/
  - crypto/
  - game-core/
  - p2p/
  - deck/
  - ui-react/ (optional, only if reusable UI is needed)
- vendor/
  - (unchanged)

Notes:
- Keep package folder names stable from day one.
- Keep package names stable from day one.
- This enables replacing any local package folder with a submodule later without changing imports.

## Naming and API Rules

### Package names

Use scoped names and keep them permanent:

- @manamesh/crypto
- @manamesh/game-core
- @manamesh/p2p
- @manamesh/deck
- @manamesh/ui-react (optional)

### Import policy

Inside apps and other packages:

- Always import shared code via package names.
- Never import shared code via relative cross-package paths.

Good:

import { createMerkleRoot } from "@manamesh/crypto";

Avoid:

import { createMerkleRoot } from "../../frontend/src/crypto/merkle";

### Public API policy

Each package should expose a narrow entrypoint using exports maps.
Do not rely on deep imports into internal files.

## Migration Plan (Incremental)

## Phase 1 - Internal package extraction (no external repos yet)

1. Create one package first (recommended: crypto).
2. Move source into packages/crypto/src.
3. Add package metadata:
   - package.json
   - tsconfig.json
   - build script
   - exports map
4. Update frontend imports to use @manamesh/crypto.
5. Verify build and tests.

## Phase 2 - Repeat for additional seams

1. Extract game-core from frontend game logic that is UI-independent.
2. Extract p2p utilities/runtime modules.
3. Extract deck parsing/normalization and data model logic.
4. Optionally extract reusable React UI components into ui-react.

## Phase 3 - Add release workflow while still monorepo-local

1. Add Changesets for package versioning and changelogs.
2. Mark packages private until stable.
3. Add CI per package (build, test, typecheck).
4. Add package ownership and semver policy.

## Phase 4 - Externalize a package when ready

1. Create external repo for the package.
2. Move history using subtree split.
3. Add it back as a git submodule at the same path.
4. Keep package name and folder path unchanged.
5. Continue workspace-based local development.
6. Publish to npm when desired.

## Why this supports submodules later

If path and package name remain the same:

- Existing imports remain valid.
- Existing tsconfig/workspace wiring remains mostly unchanged.
- Replacing a package directory with a submodule becomes a repository operation, not an app refactor.

## Minimal Standards for Every Publishable Package

Each package should include:

- package.json with:
  - name
  - version
  - type
  - main/module/types
  - exports
  - files
  - sideEffects
- src/index.ts as the stable public entrypoint.
- tsconfig.json (composite true if using project references).
- build and test scripts.
- README.md with API and examples.
- CHANGELOG.md (or Changesets generated output).
- LICENSE strategy (repo-root or per-package references).

## Dependency Direction Guidelines

Keep dependencies one-way to avoid cycles:

- game-core can depend on crypto and deck.
- p2p can depend on crypto (if needed), not on ui-react.
- ui-react can depend on game-core/deck, not vice versa.
- apps can depend on all internal packages.

## Immediate Next Step (Recommended)

First extraction target: @manamesh/crypto

Reason:
- The crypto directory is already relatively self-contained.
- It provides immediate reuse value.
- It sets patterns for the next extractions.

Execution checklist:

1. Create packages/crypto package scaffolding.
2. Move frontend src/crypto code into packages/crypto/src.
3. Export stable API via packages/crypto/src/index.ts.
4. Update frontend imports to @manamesh/crypto.
5. Add root workspace references for apps/* and packages/*.
6. Run build and tests.

## Optional Future Enhancements

- Add package boundary lint rules to ban cross-package relative imports.
- Add API extraction (for example, TypeDoc or API report tooling).
- Add provenance/signing for published packages.
- Add dual ESM/CJS output only if consumers require it.

## Success Criteria

The strategy is working when:

- Shared logic is consumed only through package imports.
- At least one package can be versioned independently.
- Replacing a local package directory with a submodule requires no import rewrites.
- CI can build/test packages independently and as a whole.
