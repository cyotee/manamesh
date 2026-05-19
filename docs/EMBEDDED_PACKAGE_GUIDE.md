# Embedded NPM Package Guide (Pre-Publish)

Date: 2026-05-19

## Purpose

Define a package inside this monorepo that behaves like a real npm package now, so app code can migrate to package-based imports before externalizing and publishing.

This guide is for an embedded package that is:

- Developed locally in this repository.
- Consumed through workspace linking.
- Structured for easy future extraction to its own repo and npm publish.

## What "Embedded Package" Means Here

An embedded package is a normal npm package directory under packages/, managed by Yarn workspaces.
It has its own package.json, build config, public exports, tests, and semantic version.
It is consumed by name (for example @manamesh/crypto) by apps in this same repo.

## Recommended Folder Layout

Example for a package named @manamesh/crypto:

packages/
  crypto/
    src/
      index.ts
      ...
    test/
      ...
    package.json
    tsconfig.json
    tsconfig.build.json
    README.md

Optional build output:

packages/
  crypto/
    dist/

## Step 1: Ensure Root Workspace Includes Packages

In the repository root package.json, include at least:

{
  "workspaces": [
    "apps/*",
    "packages/*",
    "vendor/*"
  ]
}

If apps/ is not in use yet, you can keep your current layout and still use packages/*.

## Step 2: Create the Embedded Package Manifest

Create packages/crypto/package.json:

{
  "name": "@manamesh/crypto",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "sideEffects": false,
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "files": [
    "dist",
    "README.md"
  ],
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "clean": "rm -rf dist",
    "test": "vitest run"
  },
  "devDependencies": {
    "typescript": "^5.9.2",
    "vitest": "^3.2.4"
  }
}

Notes:
- Keep private true until ready to publish.
- Keep name final from day one to avoid later import churn.

## Step 3: Add TypeScript Config for the Package

Create packages/crypto/tsconfig.json:

{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "composite": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*", "test/**/*"]
}

Create packages/crypto/tsconfig.build.json:

{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false
  },
  "include": ["src/**/*"],
  "exclude": ["test/**/*", "**/*.test.ts", "**/*.spec.ts"]
}

## Step 4: Define a Stable Public API

Create packages/crypto/src/index.ts and export only approved API surface:

export * from "./merkle";
export * from "./sha256";

Rules:
- Consumers import from package root only.
- Avoid deep imports from internal files.

## Step 5: Wire Consumer App to Use Embedded Package

In consumer package (for example frontend), add dependency:

{
  "dependencies": {
    "@manamesh/crypto": "workspace:*"
  }
}

Then migrate imports in app code:

From:

import { sha256Hex } from "../crypto/sha256";

To:

import { sha256Hex } from "@manamesh/crypto";

This step is the core of de-risking future externalization.

## Step 6: Add Root TypeScript References (Optional but Recommended)

In root tsconfig.json references:

{
  "references": [
    { "path": "./packages/crypto" },
    { "path": "./packages/frontend" },
    { "path": "./packages/backend" }
  ]
}

If frontend depends on crypto via TS project references, also add reference from frontend tsconfig to packages/crypto.

## Step 7: Validate the Embedded Package Contract

Run from repo root:

- yarn install
- yarn workspace @manamesh/crypto build
- yarn workspace @manamesh/frontend build
- yarn test (or targeted tests)

Expected outcome:
- Package builds independently.
- Consumer app builds using package-name imports.
- No cross-package relative imports remain for migrated code.

## Step 8: Enforce Boundary Rules

Enforce these during migration:

- No imports from another package via relative paths.
- No imports from package internals (for example @manamesh/crypto/dist/* or src/*).
- Only import from the package export map.

Optional enforcement:
- ESLint import rules.
- Dependency-cruiser or similar boundary tooling.

## Migration Playbook for Existing Code

When moving code from app to embedded package:

1. Copy source into package src/ with minimal edits.
2. Export needed symbols from package src/index.ts.
3. Update app imports to package name.
4. Run package build + app build.
5. Delete old app-local duplicate code only after passing build/tests.

Do this in small batches by domain (crypto first, then deck, then game-core, etc.).

## Externalization-Ready Checklist

A package is ready to externalize when all are true:

- Consumed only by package name in repo.
- Has stable exports map and README.
- Builds and tests independently.
- No implicit dependencies on app internals.
- Versioning policy is defined.

## Externalize Later with Minimal Churn

When ready:

1. Create standalone repo for the package.
2. Move history (for example subtree split).
3. Re-add at same monorepo path as git submodule.
4. Keep package name unchanged.
5. Flip private to false and publish.
6. Keep monorepo consumers unchanged (same import paths).

## Common Pitfalls

- Deep imports into src/ files create hidden API contracts.
- Keeping browser-only and node-only code mixed in one package complicates reuse.
- Changing package name during extraction forces broad refactors.
- Migrating too much at once increases breakage risk.

## Suggested First Candidate in ManaMesh

Start with @manamesh/crypto.

Why:
- Existing crypto code appears relatively self-contained.
- High reuse potential across frontend/backend and future tools.
- Good template for subsequent package extractions.
