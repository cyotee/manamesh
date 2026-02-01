# Code Review: MM-034

**Reviewer:** OpenCode
**Review Started:** 2026-02-01
**Status:** Complete

---

## Clarifying Questions

Questions asked to understand review criteria:

None.

---

## Review Findings

### Finding 1: App not wrapped with WalletProvider

**File:** `packages/frontend/src/App.tsx`
**Severity:** High
**Description:** TASK.md requires `WalletProvider` wraps the app for wagmi/RainbowKit integration, but the app still uses the legacy `WalletContextProvider` (mock wallet). This means the new wallet module is not actually enabled at the application entrypoint.
**Status:** Resolved
**Resolution:** `WalletProvider` is now applied at the app boundary. Note: the legacy `WalletContextProvider` (mock wallet) is still wrapped inside for backward compatibility.

### Finding 2: WalletPlugin cache key can throw on bigint

**File:** `packages/frontend/src/wallet/plugin/wallet-plugin.ts`
**Severity:** High
**Description:** `computeSignatureHash(... JSON.stringify(signedAction.data))` is used in both `addSignedAction` and `verifyPlayerAction`. EIP-712 action payloads use `bigint` fields (e.g., `timestamp`, `actionIndex`, etc.), and `JSON.stringify` throws on `bigint` values, which can break signing/verification flows at runtime.
**Status:** Resolved
**Resolution:** Cache key now uses `hashTypedAction(actionType, data)` (typed-data hash) instead of `JSON.stringify(data)`.

### Finding 3: EIP-712 tests don’t exercise sign+verify roundtrip

**File:** `packages/frontend/src/wallet/signing/sign.test.ts`, `packages/frontend/src/wallet/signing/verify.test.ts`
**Severity:** Medium
**Description:** Tests currently validate domain fields, schemas, and deterministic hashing, but do not validate that a signed action can be verified back to the expected address (no `recoverTypedDataAddress` roundtrip with a known private key).
**Status:** Resolved
**Resolution:** Added a deterministic viem account sign+verify roundtrip test for `JoinGame`.

### Finding 4: Build/test artifacts present in git status

**File:** `packages/frontend/dist/index.html`, `packages/frontend/node_modules/.vite/vitest/results.json`
**Severity:** Low
**Description:** These look like generated artifacts and should not be committed.
**Status:** Open
**Resolution:** Added ignore for `**/.vite/` at repo root. `dist/` is already ignored. Artifacts should be removed from any commit.

### Finding 5: WalletConnect project id defaults to demo value

**File:** `packages/frontend/src/wallet/config.ts`
**Severity:** Medium
**Description:** `VITE_WALLETCONNECT_PROJECT_ID` falls back to `'demo-project-id'`. This will typically fail in real WalletConnect usage and can confuse deployments.
**Status:** Resolved
**Resolution:** Added a runtime warning when `VITE_WALLETCONNECT_PROJECT_ID` is unset and the placeholder is used.

---

## Suggestions

Actionable items for follow-up tasks:

### Suggestion 1: Use typed-data hash for WalletPlugin cache keys

**Priority:** High
**Description:** Replace `JSON.stringify(signedAction.data)` cache keys with `hashTypedAction(actionType, data)` (optionally combined with signature) to avoid bigint serialization issues and to make cache keys stable.
**Affected Files:**

- `packages/frontend/src/wallet/plugin/wallet-plugin.ts`
  **User Response:** (pending)
  **Notes:** Also consider removing `verificationCache` from persisted state if it’s purely an optimization.

### Suggestion 2: Integrate WalletProvider at the real app boundary

**Priority:** High
**Description:** Wrap the app in `WalletProvider` (wagmi/RainbowKit) and keep the legacy mock wallet behind an explicit “demo mode” toggle if needed.
**Affected Files:**

- `packages/frontend/src/App.tsx`
- `packages/frontend/src/blockchain/wallet/context.tsx`
  **User Response:** (pending)
  **Notes:** This is the main item blocking US-MM-034.1/2 being “actually live”.

### Suggestion 3: Reduce noisy console logging in core wallet flows

**Priority:** Low
**Description:** `console.log` in wallet hooks/signing/plugin can spam production consoles; consider gating behind a debug flag.
**Affected Files:**

- `packages/frontend/src/wallet/hooks/useGameKeys.ts`
- `packages/frontend/src/wallet/signing/sign.ts`
- `packages/frontend/src/wallet/plugin/wallet-plugin.ts`
  **User Response:** (pending)
  **Notes:** Not a blocker, but improves polish.

---

## Review Summary

**Findings:** 5 (2 high, 2 medium, 1 low)
**Suggestions:** 3
**Recommendation:** Changes requested (artifact cleanup / ensure artifacts not committed; known pre-existing flaky P2P transport test still fails).

---

**When review complete, output:** `<promise>PHASE_DONE</promise>`
