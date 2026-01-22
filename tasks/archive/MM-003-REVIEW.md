# Code Review: MM-003

**Reviewer:** OpenCode
**Review Started:** 2026-01-21
**Status:** Complete

---

## Clarifying Questions

Questions asked to understand review criteria:

- None.

---

## Review Findings

### Finding 1: Public Game Browsing Is Not Implemented (Stub)
**File:** `packages/frontend/src/p2p/discovery/dht.ts`
**Severity:** High
**Description:**
The “Browse Public Games” feature does not actually discover any games.

- `fetchPublicGames()` creates `const games: PublicGame[] = []` and never populates it.
- `getClosestPeers(getPublicGamesKey())` is invoked, but the response is unused and there is no subsequent retrieval of advertised game records.

This fails US-MM-003.3 acceptance criteria: list of discoverable games, metadata, one-click join, auto-refresh (auto-refresh exists, but it refreshes an empty list).
**Status:** Open
**Resolution:** Implement actual public game advertisement + retrieval (see Suggestions).

### Finding 2: Incorrect DHT Key Construction For Public Games
**File:** `packages/frontend/src/p2p/discovery/dht.ts`
**Severity:** High
**Description:**
`addToPublicGames()` builds the DHT key like:

`new TextEncoder().encode(`${getPublicGamesKey()}/${roomCode}`)`

But `getPublicGamesKey()` returns a `Uint8Array`. Interpolating a `Uint8Array` into a string produces a comma-separated list of byte values, not the intended topic string. That means public game keys will not be under a stable, predictable prefix and will not match any later lookup logic.
**Status:** Open
**Resolution:** Create a string key namespace for public games (e.g. export `PUBLIC_GAMES_TOPIC` and use `${PUBLIC_GAMES_TOPIC}/${roomCode}`), or decode the bytes back into a string before concatenation.

### Finding 3: DHT “Initialization Failure” In Tests Indicates Runtime Compatibility Risk
**File:** `packages/frontend/src/p2p/discovery/dht.ts`
**Severity:** Medium
**Description:**
While running tests, DHT initialization logs:

`Promise.withResolvers is not a function`

Tests still pass because they only assert graceful failure, but this error suggests one of the libp2p dependencies relies on `Promise.withResolvers` which is not available in the current runtime used by tests (`node v20.9.0`). This is a compatibility risk for environments/browsers that don’t support it.
**Status:** Open
**Resolution:** Confirm required runtime/browser versions, or polyfill/avoid dependency path that requires `Promise.withResolvers`.

### Finding 4: “Public Game” Records Have No TTL / Cleanup Strategy
**File:** `packages/frontend/src/p2p/discovery/dht.ts`
**Severity:** Medium
**Description:**
DHT values are written without an expiry/republish/cleanup mechanism.

- Room offers/answers and public game advertisements can become stale.
- Code attempts to filter stale games by `createdAt` (5 minutes), but since the list is not actually populated today, this is currently theoretical.

Once public listing is implemented, stale record buildup will become a UX issue.
**Status:** Open
**Resolution:** Add a TTL/republish model (e.g. republish every N minutes, consider embedding expiry and ignoring expired records).

### Finding 5: Guessable Room Keys Enable Enumeration / Interference
**File:** `packages/frontend/src/p2p/libp2p-config.ts`
**Severity:** Low
**Description:**
Room keys are predictable (`${ROOM_TOPIC}/${roomCode}` where room code is 6 chars). Attackers can enumerate room codes and fetch offers, and can also write bogus answers to `${roomCode}-answer`.

This may be acceptable for a prototype, but it is a real security/abuse vector.
**Status:** Open
**Resolution:** Introduce a per-room secret (e.g. extra random nonce in the DHT key, or encrypt/sign payloads), or rate-limit / validate answers.

---

## Suggestions

Actionable items for follow-up tasks:

### Suggestion 1: Implement Public Game Indexing Mechanism
**Priority:** P0
**Description:**
Replace the placeholder “closest peers” scan with a deterministic read model.

Practical options (pick one):

- Publish each public game record under a known prefix key: `${PUBLIC_GAMES_TOPIC}/${roomCode}` and then maintain a separate “index” key that contains recent room codes.
- Or: store the full list of public rooms under a single key `${PUBLIC_GAMES_TOPIC}` (requires conflict handling / last-write-wins semantics).
- Or: shift “public games discovery” to PubSub instead of DHT (DHT is not a great fit for browsing lists).

**Affected Files:**
- `packages/frontend/src/p2p/discovery/dht.ts`
- `packages/frontend/src/p2p/libp2p-config.ts`
**User Response:** Accepted
**Notes:** Converted to task MM-009

### Suggestion 2: Fix Public Game Key Encoding
**Priority:** P0
**Description:**
Stop interpolating `Uint8Array` into a string. Use a string topic constant for key derivation or a helper like `getPublicGameKey(roomCode): Uint8Array` that correctly encodes the full key.
**Affected Files:**
- `packages/frontend/src/p2p/discovery/dht.ts`
- `packages/frontend/src/p2p/libp2p-config.ts`
**User Response:** Accepted
**Notes:** Converted to task MM-010

### Suggestion 3: Confirm/Document Runtime Support for libp2p Build
**Priority:** P1
**Description:**
Given the `Promise.withResolvers` error during tests, document supported browser versions and ensure local dev/test environment is compatible.

Potential actions:
- Bump Node version used for tests if the dependency requires it.
- Add a polyfill in the frontend test environment if appropriate.
- Pin/adjust libp2p dependency versions.
**Affected Files:**
- `packages/frontend/package.json` (if version bumps/pins)
- `packages/frontend/vitest.config.ts` (if polyfill)
**User Response:** Accepted
**Notes:** Converted to task MM-011

### Suggestion 4: Add Expiry/Republish For DHT Records
**Priority:** P2
**Description:**
Add an expiry field and republish strategy for room offers/answers and public game ads, and ensure UI ignores expired records.
**Affected Files:**
- `packages/frontend/src/p2p/discovery/dht.ts`
**User Response:** Accepted
**Notes:** Converted to task MM-012

---

## Review Summary

**Findings:** 5 (2 high, 2 medium, 1 low)
**Suggestions:** 4 (P0-P2)
**Recommendation:** Request changes before considering MM-003 complete, primarily due to US-MM-003.3 (Public Games) not being implemented and a key bug in public game DHT key construction.

## Verification Notes

- Tests: `yarn test --run` passes (83/83) in this worktree.
- Frontend build: `yarn workspace @manamesh/frontend build` succeeds.

---

**When review complete, output:** `<promise>REVIEW_COMPLETE</promise>`
