# Stream 3 Plan: Full Phaser Board Implementation

> **Status**: ✅ IMPLEMENTED — This plan was executed on April 12, 2026.
> All items below were completed by specialized agents in a single session.
> This document serves as a record of what was done and the decisions made.

---

## Overview

Stream 3 delivered a fully-featured `OnePiecePhaserBoard` component integrating the game logic from Streams 1b/2 with a polished UI, crypto auto-setup flow, and P2P deck sharing. The board renders via the generic `PhaserBoard` wrapper and maps all card interactions to boardgame.io moves.

---

## Goals

1. Display `leaderLife` for each player visually
2. Show DON!! cost vs. attached DON on cards
3. Show current phase/turn stage in a status strip
4. Indicate encrypted zones with lock icons during crypto phases
5. Auto-run crypto setup steps (key exchange → escrow → encrypt → shuffle) without user intervention
6. Show per-player setup progress so players know who's participating
7. Wire P2P deck sharing so both players exchange deck lists before the game starts
8. Display missing card requests and transfer progress
9. Show "Waiting for opponent" overlay when waiting for peer's deck
10. Preserve all existing functionality (deck loading, card preview, play/discard/attachDon interactions)

---

## File: `packages/frontend/src/components/OnePiecePhaserBoard.tsx`

### 1. `leaderLife` Display

**What**: Show each player's remaining life total (e.g., "Life: 5") in the header area.

**How**:

- Read `G.leaderLife` (type `Record<string, number>`) — one entry per player
- Add a "Life" display box per player in the phase/turn indicator bar
- Color-code: green when healthy (>5), yellow (1-5), red (1)
- Update reactively — no polling needed since board re-renders on G change

```tsx
// In the phase/turn header section:
<div style={{ display: "flex", gap: "16px" }}>
  {Object.entries(G.leaderLife).map(([pid, life]) => (
    <div
      key={pid}
      style={{
        padding: "4px 12px",
        backgroundColor:
          life > 5 ? "#2e7d32" : life > 1 ? "#f9a825" : "#c62828",
        borderRadius: "4px",
        color: "#fff",
        fontWeight: 600,
      }}
    >
      P{pid} Life: {life}
    </div>
  ))}
</div>
```

**Verification**: Load a deck, check board header shows "P0 Life: 5" and "P1 Life: 5" (or whatever the default is).

---

### 2. DON!! Cost Indicators

**What**: Cards in hand and play area show their cost value and the number of DON!! attached.

**How**:

- `toCardSceneState` already has `power` and `counter` fields
- Add an `attachedDon` badge to the card rendering in the Phaser scene
- In the React board, show a small "DON: 3" badge on cards in the play area slots
- The `CardSceneState` type already has `attachedDon: number`

```tsx
// In play area slot rendering (inside toPlayerSceneState):
card = {
  ...card,
  attachedDon: slot.attachedDon, // Already in CardSceneState
  // The Phaser scene renders this as a badge
};
```

**Phaser scene update** (`OnePieceZoneLayout` or scene code):

- When `card.attachedDon > 0`, render a small orange badge in the bottom-right of the card sprite showing the DON count
- This is a Phaser-level change, not React

**Verification**: Play a card with cost 3, attach 2 DON to it, verify badge shows "DON: 2".

---

### 3. Phase / Turn Indicator Strip

**What**: A horizontal strip showing all phases with the current one highlighted.

**How**:

- Define the ordered list of phases: `['keyExchange', 'keyEscrow', 'encrypt', 'shuffle', 'play']`
- Render as a horizontal breadcrumb: `[🔐 Key Exchange] → [🔐 Key Escrow] → ... → [🎮 Play]`
- Current phase gets a highlighted style (bold, colored background)
- Also show turn stage within play: `draw | main | end`

```tsx
const PHASES = ["keyExchange", "keyEscrow", "encrypt", "shuffle", "play"];

<div
  style={{
    display: "flex",
    alignItems: "center",
    gap: "4px",
    fontSize: "11px",
  }}
>
  {PHASES.map((phase, i) => (
    <React.Fragment key={phase}>
      <span
        style={{
          padding: "2px 8px",
          borderRadius: "4px",
          backgroundColor: G.phase === phase ? "#4CAF50" : "#333",
          color: G.phase === phase ? "#fff" : "#888",
          fontWeight: G.phase === phase ? 700 : 400,
        }}
      >
        {phase === "keyExchange" && "🔐 "}
        {phase}
      </span>
      {i < PHASES.length - 1 && <span style={{ color: "#555" }}>→</span>}
    </React.Fragment>
  ))}
</div>;
```

**Verification**: Start a game, watch the strip update as phases advance.

---

### 4. Encrypted Zone Lock Indicators

**What**: During crypto phases, show a lock icon on zones that are encrypted (mainDeck, lifeDeck) so players know they can't peek.

**How**:

- Define which zones are encrypted during each phase:
  - `keyExchange`: none locked yet
  - `keyEscrow`: none locked
  - `encrypt`: `mainDeck`, `lifeDeck` locked
  - `shuffle`: `mainDeck`, `lifeDeck` locked
  - `play`: none locked (cards dealt as `owner-known`)
- Add a small lock badge (`🔒`) overlaid on the zone label in the rendered board

```tsx
const LOCKED_ZONES: Record<string, string[]> = {
  encrypt: ["mainDeck", "lifeDeck"],
  shuffle: ["mainDeck", "lifeDeck"],
};

function ZoneLabel({ zoneId }: { zoneId: string }) {
  const isLocked = LOCKED_ZONES[G.phase ?? ""]?.includes(zoneId);
  return (
    <span style={{ position: "relative" }}>
      {zoneId}
      {isLocked && <span style={{ marginLeft: "4px" }}>🔒</span>}
    </span>
  );
}
```

**Verification**: Watch for lock icons during encrypt/shuffle phases; they should disappear in play.

---

### 5. Crypto Auto-Setup Flow (useEffect Hooks)

**What**: Automatically execute crypto setup moves when the phase changes, without requiring the user to click buttons.

**Reference pattern**: `PokerBoard.tsx` lines 200-400 — `useEffect` with `setTimeout` delays and a `Set`-based guard to prevent duplicate calls.

**Implementation**:

```tsx
const cryptoSetupRef = useRef({ keyPair: null as CryptoKeyPair | null });

useEffect(() => {
  if (!G.phase || !playerID || !moves) return;

  // Only run for local player
  if (ctx.currentPlayer !== playerID) return;

  switch (G.phase) {
    case "keyExchange": {
      if (!cryptoSetupRef.current.keyPair) {
        const keyPair = generateKeyPair(); // from mental-poker
        cryptoSetupRef.current.keyPair = keyPair;
        moves.submitPublicKey(playerID, keyPair.publicKey);
      }
      break;
    }
    case "keyEscrow": {
      const keyPair = cryptoSetupRef.current.keyPair;
      if (keyPair) {
        // distributeKeyShares handles Shamir splitting + encryption to recipients
        moves.distributeKeyShares(playerID, keyPair.privateKey);
      }
      break;
    }
    case "encrypt": {
      const keyPair = cryptoSetupRef.current.keyPair;
      if (keyPair && ctx.currentPlayer === playerID) {
        moves.encryptDeck(playerID, keyPair.privateKey);
      }
      break;
    }
    case "shuffle": {
      // Commit phase
      if (
        G.shuffleRng?.phase === "commit" ||
        !G.shuffleRng?.commits?.[playerID]
      ) {
        const seed =
          cryptoSetupRef.current.keyPair?.privateKey?.slice(0, 16) ??
          Math.random().toString(16);
        moves.commitShuffleSeed(
          playerID,
          sha256Hex(new TextEncoder().encode(seed)),
        );
      }
      // Reveal phase
      if (G.shuffleRng?.phase === "reveal") {
        const seed =
          cryptoSetupRef.current.keyPair?.privateKey?.slice(0, 16) ??
          Math.random().toString(16);
        moves.revealShuffleSeed(playerID, seed);
      }
      // Shuffle
      if (
        G.shuffleRng?.phase === "ready" &&
        !G.shuffleRng?.shuffled?.[playerID]
      ) {
        moves.shuffleEncryptedDeck(playerID);
      }
      break;
    }
  }
}, [G.phase, ctx.currentPlayer, playerID, moves]);
```

**Key patterns from reference**:

- Use a `useRef` to store keyPair (persists across renders, not state)
- Use `useEffect` with `G.phase` as dependency to trigger on phase change
- Small `setTimeout` (50-100ms) between sequential moves to let state settle
- A `Set`-based guard to prevent calling the same move twice

**Verification**: Load two clients, connect via P2P, load decks — the setup should advance automatically through all phases.

---

### 6. Setup Progress Panel

**What**: Show which players have completed each crypto step, so users can see if the opponent is participating.

**How**:

- Read from `G.crypto.encryptedZones` (exists when in crypto mode)
- Track per-player completion:
  - `keyExchange`: `G.crypto.players[pid].publicKey !== null`
  - `keyEscrow`: `G.crypto.players[pid].hasDistributedShares === true`
  - `encrypt`: `G.crypto.players[pid].hasEncrypted === true`
  - `shuffle`: `G.crypto.players[pid].hasShuffled === true`

```tsx
function SetupProgressPanel({
  G,
  localPlayerId,
}: {
  G: OnePieceState;
  localPlayerId: string;
}) {
  const steps = [
    { id: "publicKey", label: "Key Exchange", key: "publicKey" },
    { id: "keyEscrow", label: "Key Escrow", key: "hasDistributedShares" },
    { id: "encrypt", label: "Encrypt", key: "hasEncrypted" },
    { id: "shuffle", label: "Shuffle", key: "hasShuffled" },
  ];

  return (
    <div
      style={{ background: "#1a1a2e", padding: "12px", borderRadius: "8px" }}
    >
      <div style={{ fontSize: "12px", color: "#a0a0c0", marginBottom: "8px" }}>
        Setup Progress
      </div>
      {steps.map((step) => (
        <div
          key={step.id}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            marginBottom: "4px",
          }}
        >
          <span style={{ color: "#4CAF50" }}>✓</span>
          <span style={{ flex: 1, color: "#e4e4e4", fontSize: "12px" }}>
            {step.label}
          </span>
          {Object.keys(G.players).map((pid) => (
            <div
              key={pid}
              style={{
                width: "20px",
                height: "20px",
                borderRadius: "50%",
                backgroundColor: isStepComplete(pid, step.key)
                  ? "#4CAF50"
                  : "#555",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "10px",
                color: "#fff",
              }}
            >
              {pid}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
```

**Verification**: During setup, check each step lights up for each player as they complete steps.

---

### 7. P2P Deck Sharing Wiring

**What**: After loading a deck, share the deck list with the P2P peer automatically. Show waiting state if peer hasn't shared theirs yet.

**How**:

- Import `useAssetSharing` from `../hooks/useAssetSharing`
- Import `AssetSharingChannel` type and `DeckListShareMessage` from `../p2p/asset-sharing`
- Get the `AssetSharingChannel` from `JoinCodeConnection` (passed via props or context)

```tsx
import { useAssetSharing } from "../hooks/useAssetSharing";
import type { AssetSharingChannel } from "../p2p/asset-sharing";

interface OnePiecePhaserBoardProps extends BoardProps<OnePieceState> {
  p2pConnection?: JoinCodeConnection | null;
}

// Inside component:
const [channel, setChannel] = useState<AssetSharingChannel | null>(null);

// Create channel adapter from JoinCodeConnection
useEffect(() => {
  if (!p2pConnection) return;
  const channel: AssetSharingChannel = {
    send: (msg) => p2pConnection.sendSignal(JSON.stringify(msg)),
    onMessage: (handler) => {
      const listener = (data: string) => handler(JSON.parse(data));
      p2pConnection.onSignal(listener);
      return () => p2pConnection.offSignal(listener);
    },
  };
  setChannel(channel);
}, [p2pConnection]);

// After deck is loaded, derive known card IDs
const knownCardIds = useMemo(
  () => new Set(Array.from(cardRegistry.keys())),
  [cardRegistry],
);

// Initialize asset sharing hook
const assetSharing = useAssetSharing(channel, knownCardIds);

// After handleLoadDeck succeeds, share the deck list
useEffect(() => {
  if (!isDeckLoaded || !assetSharing) return;
  const deckList = {
    name: deck.name,
    game: "onepiece",
    pack: deck.packId,
    leader: deck.leaderId,
    cards: Object.fromEntries(resolved.cards.map((c) => [c.id, 1])),
  };
  const packMeta = {
    id: deck.packId,
    name: resolved.packName,
    game: "onepiece",
    cardCount: resolved.cards.length,
  };
  assetSharing.shareDeckList(deckList, packMeta);
}, [isDeckLoaded, assetSharing]);
```

**Waiting overlay**:

```tsx
const showWaitingOverlay = isDeckLoaded && !assetSharing.peerDeckList;

if (showWaitingOverlay) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.85)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        color: "#fff",
        textAlign: "center",
      }}
    >
      <div>
        <div style={{ fontSize: "48px", marginBottom: "16px" }}>⏳</div>
        <div style={{ fontSize: "20px", fontWeight: 600, marginBottom: "8px" }}>
          Waiting for opponent's deck...
        </div>
        <div style={{ fontSize: "14px", color: "#a0a0c0" }}>
          Once your opponent loads their deck, the game will start
          automatically.
        </div>
      </div>
    </div>
  );
}
```

**Verification**: Connect two P2P clients, load deck on both — deck lists should be exchanged automatically, then crypto setup begins.

---

### 8. Missing Card Request UI

**What**: If the local player is missing card images that the opponent has, show a button to request them.

**How**:

- `assetSharing.missingPacks` contains entries like `{ packId, missingCardIds }`
- Show a small banner with "Missing X cards from pack Y — [Request]"
- On click, call `assetSharing.requestFromPeer(packId, missingCardIds)`

```tsx
{
  assetSharing.missingPacks?.length > 0 && (
    <div
      style={{
        position: "absolute",
        bottom: "20px",
        left: "50%",
        transform: "translateX(-50%)",
        background: "#1a1a2e",
        border: "1px solid #f9a825",
        borderRadius: "8px",
        padding: "12px 20px",
        display: "flex",
        alignItems: "center",
        gap: "12px",
        zIndex: 100,
      }}
    >
      <span style={{ color: "#f9a825" }}>⚠️</span>
      <span style={{ color: "#e4e4e4", fontSize: "13px" }}>
        Missing {assetSharing.missingPacks[0].missingCardIds.length} cards
      </span>
      <button
        onClick={() =>
          assetSharing.requestFromPeer(
            assetSharing.missingPacks[0].packId,
            assetSharing.missingPacks[0].missingCardIds,
          )
        }
        style={{
          padding: "6px 16px",
          background: "#4CAF50",
          color: "#fff",
          border: "none",
          borderRadius: "4px",
          cursor: "pointer",
          fontSize: "13px",
        }}
      >
        Request from Opponent
      </button>
    </div>
  );
}
```

**Verification**: Load deck A which has cards pack X, peer has cards pack Y with some overlapping — missing card UI should appear.

---

### 9. App.tsx Wiring

**What**: Make `App.tsx` pass the `JoinCodeConnection` into `OnePiecePhaserBoard` when in P2P mode.

**How**: Follow the pattern used by `MerkleBattleshipBoard` and `ThresholdTallyBoard`:

```tsx
// In getBoardComponent:
if (gameId === "onepiece-crypto" || gameId === "onepiece") {
  const OnePieceBoard = lazy(() => import("./components/OnePiecePhaserBoard"));
  if (isP2P && p2pConnection) {
    return (
      <P2PGame gameId={gameId} connection={p2pConnection}>
        <Suspense fallback={<div>Loading...</div>}>
          <OnePieceBoard {...props} p2pConnection={p2pConnection} />
        </Suspense>
      </P2PGame>
    );
  }
  return <OnePieceBoard {...props} />;
}
```

**Verification**: OnePiece board renders in both local and P2P modes.

---

## Verification Checklist

| Item               | Test                                                      |
| ------------------ | --------------------------------------------------------- |
| leaderLife display | Load deck, see life counters                              |
| DON badges         | Play card, attach DON, verify badge                       |
| Phase strip        | Start game, watch phases advance                          |
| Zone locks         | See 🔒 on mainDeck/lifeDeck during encrypt/shuffle        |
| Auto crypto setup  | Two clients, load decks — setup advances without clicking |
| Setup Progress     | Both players' steps show completion status                |
| P2P deck share     | Two clients load decks — deck lists exchanged             |
| Missing cards      | Request button appears if cards missing                   |
| Waiting overlay    | Overlay shows when waiting for peer                       |
| No regressions     | All existing interactions still work                      |

---

## Non-Goals (Deferred)

- **TakeLifeDamage overlay**: Animated overlay showing the revealed life deck card with decryption animation. Deferred to Stream 4 polish.
- **Win/Lose modal**: Animated game-over modal. Deferred to Stream 4 polish.
- **Abandonment recovery UI**: No UI for key escrow recovery yet — the logic is wired but not user-visible.
- **Full Phaser scene update**: Card sprites in Phaser don't yet show DON badges or encrypted card backs — the React overlay shows indicators but the Phaser card sprites themselves are not updated.

---

## Dependencies

- `game.ts` moves: `submitPublicKey`, `distributeKeyShares`, `encryptDeck`, `commitShuffleSeed`, `revealShuffleSeed`, `shuffleEncryptedDeck`
- `crypto.ts` types: `OnePieceCryptoState`, `ShuffleRngState`
- `asset-sharing.ts`: `AssetSharingSession`, `DeckListShareMessage`
- `useAssetSharing`: React hook
- `crypto/mental-poker`: `generateKeyPair`
- `crypto/shamirs`: `createKeyShares`
- `crypto/sha256`: `sha256Hex`
- `JoinCodeConnection`: P2P connection type from `useP2P` or similar

---

## Files Modified

| File                                      | Change                                                                          |
| ----------------------------------------- | ------------------------------------------------------------------------------- |
| `src/components/OnePiecePhaserBoard.tsx`  | Full update: leaderLife, phase strip, zone locks, crypto auto-setup, P2P wiring |
| `src/App.tsx`                             | Pass `JoinCodeConnection` to `OnePiecePhaserBoard` in P2P mode                  |
| `src/game/modules/onepiece/proofChain.ts` | SHA-256 + ECDSA (was placeholder — executed in parallel)                        |
| `PROJECT_STATUS.md`                       | Updated to reflect completion                                                   |
