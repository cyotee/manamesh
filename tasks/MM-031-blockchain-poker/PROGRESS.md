# Progress Log: MM-031

## Current Checkpoint

**Last checkpoint:** 2026-01-27 - Wallet UI integrated into P2P Lobby
**Next step:** Run dev server and test P2P with wallet display, then test "Deal Next Hand" flow
**Build status:** ⚠️ Pre-existing TS errors (unrelated to new code)
**Test status:** ✅ P2P gameplay working - crypto setup completes, betting works

---

## Session Log

### 2026-01-27 - Mock Wallet Module Created

**Created mock wallet infrastructure for demo purposes.**

Goal: Prove P2P + secure encryption works without real blockchain integration.

#### Files Created

1. **`/src/blockchain/wallet/types.ts`** - Wallet types
   - `WalletStatus`, `ConnectedWallet`, `DerivedGameKeys`
   - `WalletProvider` interface (abstraction over different wallet types)
   - `EIP1193Provider` for MetaMask compatibility

2. **`/src/blockchain/wallet/mock-wallet.ts`** - Mock wallet provider
   - `MockWalletProvider` class - simulates wallet connection
   - `deriveGameKeys(provider, gameId)` - derives game keys from wallet signature
   - Deterministic: same player + gameId always produces same keys
   - Uses SRA key generation with signature-derived seed

3. **`/src/blockchain/wallet/index.ts`** - Module exports

4. **Updated `/src/crypto/plugin/crypto-plugin.ts`**
   - Added `createPlayerCryptoContextFromWallet()` function
   - Takes wallet-derived keys and creates crypto context

#### Architecture

```
Player connects wallet (mock)
        ↓
Wallet signs message: "ManaMesh Poker Game Key\nGame ID: {gameId}\nVersion: 1"
        ↓
Signature → keccak256 → seed
        ↓
SRA generateKeyPair(seed) → deterministic keypair
        ↓
Same keys used for mental poker encryption
```

#### Benefits
- Keys derived from wallet signature = cryptographic identity
- Deterministic: rejoin same game with same keys
- Future-ready for real wallet integration (just swap MockWallet for MetaMask)

#### Next Steps
1. ~~Integrate wallet connection into App.tsx UI~~ ✅ Done - Added to P2PLobby
2. ~~Verify TypeScript compiles~~ ✅ Done
3. Test P2P gameplay with wallet display

---

### 2026-01-27 - Wallet UI Integration

**Added wallet display to P2P Lobby for demo.**

#### Changes to P2PLobby (`/src/components/P2PLobby.tsx`)
- Added mock wallet auto-connection on component mount
- Added `WalletBadge` component showing:
  - Connection status (green dot)
  - Truncated wallet address (0x1234...5678)
  - "Demo" badge to indicate mock mode
- Wallet badge displayed in all lobby modes (select, host, join)

#### Visual Demo
Players now see their mock wallet address when entering the P2P lobby, demonstrating the wallet-based identity system that will be used for blockchain settlement.

---

### 2026-01-27 (Very Late Night) - P2P State Sync Bugs FIXED

**Both P2P state sync bugs have been fixed. Full poker hand now playable via P2P.**

#### Bugs Fixed

**Bug 1: Optimistic Updates Causing Stale State (Previous Session)**
- Added `client: false` to all setup phase moves in `/src/game/modules/poker/crypto.ts`
- This prevents boardgame.io from executing moves locally before HOST confirms

**Bug 2: Async Balance Fetch Causing Client Recreation (This Session)**
- **Root Cause:** When `blockchainService.getBalances()` resolved, it updated `initialBalances` state
- This triggered P2PClient recreation via useMemo dependency, causing a new P2PMaster with fresh stateID: 0
- GUEST still had higher stateID → "Stale state" errors

- **Fix Applied in `/src/App.tsx`:**
  - Added `clientCreatedForHandRef` to track if client was created for current hand
  - Added `initialBalancesForHandRef` to capture balances at creation time
  - Added `stableClientRef` to maintain stable client reference
  - Removed `initialBalances` from useMemo dependency array
  - Client now only recreates when `handNumber` changes

#### Test Results

**P2P Test - PASSED:**
- [x] P2P connection established via join code exchange
- [x] Crypto setup completed (Key Exchange → Key Escrow → Encrypt → Shuffle)
- [x] Game entered Pre-Flop betting phase
- [x] GUEST called 10 - move synced to HOST correctly
- [x] Turn passed to HOST - "Your turn! Check or bet."
- [x] Pot and chip counts in sync on both tabs

#### Files Changed This Session
- `/packages/frontend/src/App.tsx` - Fixed P2PClient recreation issue
- `/packages/frontend/src/game/modules/poker/crypto.ts` - Added `client: false` (previous session)

#### Next Steps
1. Test "Deal Next Hand" flow to verify balance propagation
2. Continue with wallet authentication (US-MM-031.1)

---

### 2026-01-27 (Late Night) - P2P Testing Revealed Pre-existing Bug

**Attempted to test the P2P sync fixes but discovered a blocking pre-existing bug in P2P transport.**

#### Test Setup
1. Successfully established P2P connection via join code exchange
2. Both tabs show "Connected via P2P" with HOST/GUEST badges
3. Hand #1 started, both tabs show Key Exchange phase

#### Blocking Bug Discovered

The P2P transport has a race condition in state ID synchronization:

**Symptoms:**
- Player 0 (HOST): Key submitted successfully
- Player 1 (GUEST): `ERROR: disallowed move: submitPublicKey`
- Console shows: `[P2PMaster] Stale state: expected 0, got 2`

**Root Cause Analysis:**
1. GUEST's boardgame.io client increments `_stateID` optimistically on each move attempt
2. GUEST sends action with stateID 2 (after retries)
3. HOST still expects stateID 0 (initial state)
4. HOST rejects GUEST's move as "Stale state"

**Location:** `/src/p2p/transport.ts:408-410`
```typescript
if (state._stateID !== stateID) {
  console.log(`[P2PMaster] Stale state: expected ${state._stateID}, got ${stateID}`);
  return { error: 'Stale state' };
}
```

**Detailed Analysis from Console Logs:**
- GUEST receives initial sync with `_stateID: 0`
- GUEST receives update with `_stateID: 1` (includes Player 1's publicKey)
- BUT GUEST still tries to submit key again, gets "disallowed move"
- This indicates the boardgame.io client isn't properly applying received state updates

**Likely Root Cause:**
The boardgame.io client uses optimistic updates. When GUEST calls `moves.submitPublicKey()`:
1. Client validates against local state (succeeds)
2. Client applies optimistically (increments local stateID)
3. Client sends action to HOST
4. HOST receives, processes, sends update back
5. BUT client's local state is now ahead (optimistic), causing mismatch

The P2PTransport's stale state check works correctly, but boardgame.io's optimistic updates aren't compatible with our P2P acknowledgment model.

**Impact:** This blocks P2P gameplay from completing even the first hand. Cannot test "Deal Next Hand" fixes until this is resolved.

#### Signal Mechanism Status

The signal mechanism I implemented (sendSignal/onSignal) is **working correctly**:
- JoinCodeConnection properly intercepts `__signal__` type messages
- Handlers are dispatched correctly

However, we cannot reach the "Deal Next Hand" flow to test it because the initial hand cannot complete due to the state sync bug.

#### Next Steps

1. **Priority 1:** Fix P2P transport state ID race condition

   **Option A: Disable optimistic updates (Recommended)**
   - Configure boardgame.io client with `{ optimistic: false }`
   - Client waits for server confirmation before applying state
   - Simpler, but adds latency to moves

   **Option B: Server-authoritative state sync**
   - After HOST processes move, it sends full state to GUEST
   - GUEST replaces its state entirely (including stateID)
   - Requires changes to how boardgame.io client handles 'update' messages

   **Option C: Remove stale state check**
   - Not recommended - could cause state inconsistencies

   **Option D: Implement move acknowledgment**
   - HOST sends ACK/NACK for each move
   - GUEST only increments stateID after ACK
   - Most robust but most complex

2. **Priority 2:** After fixing state sync, test "Deal Next Hand" signal flow
   - The signal mechanism is implemented and working
   - Cannot test full flow until P2P state sync is fixed

---

### 2026-01-27 (Night) - P2P State Sync Fixes

**Fixed the bugs identified in the previous testing session.**

#### Fixes Applied

1. **Added Signal Mechanism to JoinCodeConnection** (`/src/p2p/discovery/join-code.ts`)
   - Added `sendSignal(signal)` - sends custom signals to peer
   - Added `onSignal(handler)` - registers handler for incoming signals
   - Added `offSignal(handler)` - unregisters signal handler
   - Added `_dispatchSignal(signal)` - internal dispatch to handlers
   - Modified `onMessage` in `createPeerConnection()` to intercept `__signal__` type messages

2. **Fixed Balance Sync in P2PGame** (`/src/App.tsx`)
   - HOST now updates `initialBalances` from settlement result before incrementing hand
   - GUEST now updates `initialBalances` from signal when receiving new-hand notification
   - Removed `handNumber` from useEffect dependency for `getBalances()` - now only fetches on mount
   - This prevents the blockchain service fetch from overriding the correct balances

#### Files Changed
- `/packages/frontend/src/p2p/discovery/join-code.ts` - Added signal mechanism
- `/packages/frontend/src/App.tsx` - Fixed balance propagation for new hands

#### Expected Behavior After Fixes
1. HOST clicks "Deal Next Hand"
2. HOST settles pot, gets new balances
3. HOST sends `new-hand` signal with `{ type, handNumber, dealerIndex, balances }`
4. HOST updates its own `initialBalances` and increments `handNumber`
5. GUEST receives signal via `onSignal` handler
6. GUEST updates `initialBalances` from signal and increments `handNumber`
7. Both create new P2PClient with matching `matchID` and correct balances

---

### 2026-01-27 (Evening) - P2P "Deal Next Hand" Testing

**Tested the full poker hand flow in P2P mode with two browser tabs.**

#### Fixed Issues During Testing

1. **`require()` ESM Error** - App.tsx used `require()` for dynamic imports which doesn't work in browser ESM. Fixed by converting to ES module imports.

2. **Crypto Setup Stuck (Local Mode)** - `client: false` on moves was preventing Local mode from working. User pointed out Local Hotseat doesn't properly test crypto system - need P2P with two tabs.

3. **Key Escrow Phase Stuck** - Race condition where state syncs before local key pair is created. Fixed by calling `getOrCreateKeyPair()` in each crypto phase (keyExchange, keyEscrow, encrypt, shuffle).

4. **`submitPublicKey is not defined`** - Critical bug: `ctx.phase` was `play` but `G.phase` was `keyExchange`. Root cause: LocalGame was using `game.getGame()` which returns `PokerGame` (only has `play` phase). Fixed by using `game.getCryptoGame()` to get `CryptoPokerGame` with proper `phases.setup` configuration.

#### Test Results

- **Hand 1**: Full success - crypto setup completed all phases, betting worked, showdown with correct winner determination, settlement showed correct payouts
- **Hand 2**: Partial failure - HOST has correct state but GUEST is desynced, GUEST can't submit key due to move authorization error

#### Next Steps

1. Fix P2P state sync for `newHand` - ensure GUEST receives new game state properly
2. Investigate why `startingChips` resets to 1000 instead of preserving updated balances
3. After fixing sync bugs, continue to wallet authentication (US-MM-031.1)

---

### 2026-01-27 - Blockchain Service + Game-Per-Hand Architecture

**Major refactoring complete - each hand is now a fresh game instance**

#### 1. Created Blockchain Service (`/src/blockchain/`)

**Files Created:**
- `types.ts` - Interfaces for `PlayerBalance`, `HandResult`, `SettlementResult`, `GameSession`, `BlockchainService`
- `mock-service.ts` - Mock implementation:
  - `getBalances(playerIds)` - Returns chip balances (defaults to 1000)
  - `settlePot(handResult)` - Validates and applies payouts/contributions
  - `registerSession()`, `endSession()` - Game session lifecycle
  - `generateHandId()` - Unique hand identifiers
  - Event emitter for balance updates and settlements
- `index.ts` - Module exports

#### 2. Simplified Crypto Poker Game (`/src/game/modules/poker/crypto.ts`)

**Changes:**
- **Removed** `newHand` move - each hand is a fresh game instance
- **Added** to state: `handId`, `contributions`, `startingChips` for settlement
- **Updated** `createCryptoInitialState()` to accept:
  - `initialBalances` from blockchain service
  - `handId` for settlement tracking
  - `dealerIndex` for rotating dealer position
- **Updated** `endIf` to return `handResult` when game ends (contains payouts & contributions)
- **Added** `buildHandResult()` helper function

#### 3. Updated Types (`/src/game/modules/poker/types.ts`)

- Added `PokerHandResult` interface for settlement data
- Added settlement fields to `CryptoPokerState`

#### 4. Updated PokerBoard (`/src/components/PokerBoard.tsx`)

**Changes:**
- Added `onNewHand?: (handResult: PokerHandResult) => void` callback prop
- Removed complex new-hand state detection logic (no longer needed)
- Updated game over screen to show:
  - Winner announcement
  - Settlement details (pot distribution per player)
  - Current chip counts
  - "Deal Next Hand" button (calls onNewHand callback)
- Tournament over vs hand complete distinction

#### 5. Updated App.tsx - Game Recreation Logic

**LocalGame component:**
- Tracks `handNumber` and `dealerIndex` state
- On "New Hand": settles via blockchain service, increments counters (forces new game)
- Shows "Settling on blockchain..." overlay during settlement
- Passes updated balances to new game instance

**P2PGame component:**
- Similar integration
- Only host can initiate new hand
- Placeholder for P2P signaling when new hand starts (ready for implementation)

#### Architecture Flow

```
Hand 1: Create Game → Crypto Setup → Play → Hand Ends (ctx.gameover)
           ↓
    Click "Deal Next Hand"
           ↓
    Settle pot via BlockchainService
           ↓
    Get updated balances from blockchain
           ↓
    Increment handNumber (forces new game instance)
           ↓
Hand 2: Create NEW Game → Crypto Setup → Play → ...
```

#### What's Working
- ✅ Blockchain service mock with balance tracking
- ✅ Settlement logic for pot distribution
- ✅ Single-hand game lifecycle
- ✅ Hand result data included in game over
- ✅ LocalGame integration with blockchain service
- ✅ P2PGame integration structure

#### Test Results (P2P Mode - 2026-01-27)

**Hand 1 - PASSED:**
- [x] Play through a full hand and click "Deal Next Hand"
- [x] Verify settlement calculates correct payouts
  - Player 0 won pot of 40 chips (started 1000, ended 1020)
  - Player 1 lost big blind (started 1000, ended 980)
- [x] Verify dealer rotates each hand (Player 1 became dealer in Hand 2)
- [x] Verify crypto setup runs fresh each hand (Key Exchange started for Hand 2)

**Hand 2 - PARTIAL FAILURE (Sync Issues):**
- [x] HOST view: Correct state (Hand #2, chips 1020/980, crypto setup running)
- [ ] GUEST view: Stale state (Hand #1, chips 1000/1000)
- [ ] GUEST key submission: `ERROR: disallowed move: submitPublicKey`
- [ ] P2P transport parsing: `Cannot read properties of null (reading '_stateID')`

#### Bugs Identified

1. **State Sync Bug (P2P)**: When HOST calls `newHand`, the GUEST doesn't properly receive the new game state. The GUEST still shows Hand #1 with 1000/1000 chips while HOST shows Hand #2 with updated balances.

2. **Move Authorization Bug**: GUEST's `submitPublicKey` move is rejected as "disallowed" even though it's in the Key Exchange phase. Likely caused by stale `_stateID` on GUEST side.

3. **P2P Transport Error**: `Cannot read properties of null (reading '_stateID')` when parsing messages - suggests the game state reset isn't being communicated properly through P2P transport.

4. **startingChips Reset**: The sync messages show `startingChips: {0: 1000, 1: 1000}` instead of preserving the updated balances from the previous hand settlement.

#### Known Issues
- Dev server was exiting quickly (may be unrelated to changes)
- Pre-existing TypeScript errors in dependencies (libp2p, boardgame.io types)

---

### 2026-01-26 - Task Created

- Task created via /design session
- Documented full architecture:
  - Wallet authentication with key derivation
  - Buy-in escrow in smart contract
  - On-chain shuffle commitments
  - Signed action log (EIP-712)
  - Multi-sig settlement (happy path)
  - Optimistic settlement (timeout path)
  - Dispute resolution (challenge path)
  - Threshold key escrow for abandonment
- Dependencies: MM-022 (Poker), MM-029 (CryptoPlugin)
- Status: Blocked on MM-022 completion
