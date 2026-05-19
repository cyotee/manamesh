/**
 * OnePiecePhaserBoard — One Piece TCG board powered by Phaser 3.
 *
 * Receives boardgame.io BoardProps<OnePieceState>, converts the game state
 * into a SceneState snapshot, and feeds it to the generic PhaserBoard wrapper.
 * Maps card interaction events from Phaser back to boardgame.io moves.
 *
 * Includes a deck-loading phase: when the local player's deck isn't loaded,
 * shows a deck selection UI that resolves cards and calls the loadDeck move.
 */

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import type { BoardProps } from "boardgame.io/react";
import type {
  OnePieceState,
  OnePieceCard,
  OnePieceDonCard,
} from "../game/modules/onepiece/types";
import { PhaserBoard } from "../phaser/PhaserBoard";
import { OnePieceZoneLayout } from "../phaser/layout/OnePieceLayout";
import type {
  SceneState,
  PlayerSceneState,
  ZoneSceneState,
  CardSceneState,
  SlotSceneState,
  CardInteractionEvent,
} from "../phaser/types";
import { useDeckStorage } from "../hooks/useDeckStorage";
import { useGameCardImages } from "../hooks/useGameCardImages";
import {
  useAssetSharing,
  type AssetSharingChannel,
} from "../hooks/useAssetSharing";
import type { DeckList } from "../deck/types";
import { resolveDeckList } from "../game/modules/onepiece/deckResolver";
import { CardPreviewPane } from "./CardPreviewPane";
import { generateKeyPair } from "../crypto/mental-poker";
import type { CryptoKeyPair } from "../crypto/mental-poker/types";
import type {
  OnePieceCryptoState,
  OnePieceCryptoPlayerState,
} from "../game/modules/onepiece/types";

/**
 * Convert a OnePieceCard or DON card to renderable CardSceneState.
 * When isLocalPlayer is false, 'owner-known' visibility is downgraded to
 * 'encrypted' so opponents' private cards appear face-down.
 */
function toCardSceneState(
  card: OnePieceCard | OnePieceDonCard,
  index: number,
  visibility: Record<string, string>,
  isLocalPlayer: boolean,
): CardSceneState {
  let vis = (visibility[card.id] ??
    "encrypted") as CardSceneState["visibility"];
  // Opponent's 'owner-known' cards must appear face-down to us
  if (!isLocalPlayer && vis === "owner-known") {
    vis = "encrypted";
  }
  return {
    id: card.id,
    name: card.name,
    visibility: vis,
    isTapped: false,
    counter: "counter" in card && card.counter != null ? card.counter : null,
    power: "power" in card && card.power != null ? card.power : null,
    attachedDon: 0,
    position: index,
  };
}

/** Build ZoneSceneState from a card array. */
function buildZoneState(
  zoneId: string,
  cards: (OnePieceCard | OnePieceDonCard)[],
  visibility: Record<string, string>,
  isLocalPlayer: boolean,
): ZoneSceneState {
  return {
    zoneId,
    cards: cards.map((card, i) =>
      toCardSceneState(card, i, visibility, isLocalPlayer),
    ),
  };
}

/** Convert an OnePiecePlayerState to PlayerSceneState. */
function toPlayerSceneState(
  playerId: string,
  G: OnePieceState,
  isLocalPlayer: boolean,
  extraCards?: Map<string, OnePieceCard>,
): PlayerSceneState {
  const player = G.players[playerId];
  if (!player) {
    return { zones: {}, playArea: [] };
  }

  const vis = G.cardVisibility ?? {};

  // Build card-lookup map for resolving slot cardIds (defensive ?? [])
  const allCards = new Map<string, OnePieceCard | OnePieceDonCard>();
  for (const card of player.mainDeck ?? []) allCards.set(card.id, card);
  for (const card of player.hand ?? []) allCards.set(card.id, card);
  for (const card of player.trash ?? []) allCards.set(card.id, card);
  for (const card of player.lifeDeck ?? []) allCards.set(card.id, card);
  for (const card of player.donDeck ?? []) allCards.set(card.id, card);
  for (const card of player.donArea ?? []) allCards.set(card.id, card);
  // Include card registry for play area cards (leader, played characters)
  // that have been removed from zone arrays
  if (extraCards) {
    for (const [id, card] of extraCards) {
      if (!allCards.has(id)) allCards.set(id, card);
    }
  }

  const zones: Record<string, ZoneSceneState> = {
    mainDeck: buildZoneState(
      "mainDeck",
      player.mainDeck ?? [],
      vis,
      isLocalPlayer,
    ),
    lifeDeck: buildZoneState(
      "lifeDeck",
      player.lifeDeck ?? [],
      vis,
      isLocalPlayer,
    ),
    donDeck: buildZoneState(
      "donDeck",
      player.donDeck ?? [],
      vis,
      isLocalPlayer,
    ),
    trash: buildZoneState("trash", player.trash ?? [], vis, isLocalPlayer),
    hand: buildZoneState("hand", player.hand ?? [], vis, isLocalPlayer),
    donArea: buildZoneState(
      "donArea",
      player.donArea ?? [],
      vis,
      isLocalPlayer,
    ),
  };

  // Convert play area slots
  const playArea: SlotSceneState[] = (player.playArea ?? []).map((slot) => {
    let card: CardSceneState | null = null;
    if (slot.cardId) {
      const resolved = allCards.get(slot.cardId);
      if (resolved) {
        let slotVis = (vis[resolved.id] ??
          "public") as CardSceneState["visibility"];
        if (!isLocalPlayer && slotVis === "owner-known") {
          slotVis = "encrypted";
        }
        card = {
          id: resolved.id,
          name: resolved.name,
          visibility: slotVis,
          isTapped: false, // TODO: track tap state per slot in game state
          counter:
            "counter" in resolved && resolved.counter != null
              ? resolved.counter
              : null,
          power:
            "power" in resolved && resolved.power != null
              ? resolved.power
              : null,
          attachedDon: slot.attachedDon,
          position: slot.position,
        };
      }
    }
    return {
      slotType: slot.slotType,
      card,
      attachedDon: slot.attachedDon,
      position: slot.position,
    };
  });

  return { zones, playArea };
}

// =============================================================================
// Deck Selection UI (shown when player's deck isn't loaded)
// =============================================================================

interface DeckSelectionProps {
  decks: DeckList[];
  isLoadingDecks: boolean;
  isLoadingDeck: boolean;
  loadError: string | null;
  onLoadDeck: (deck: DeckList) => void;
  playerId: string;
}

function DeckSelectionScreen({
  decks,
  isLoadingDecks,
  isLoadingDeck,
  loadError,
  onLoadDeck,
  playerId,
}: DeckSelectionProps) {
  return (
    <div
      style={{
        width: "100%",
        maxWidth: "800px",
        margin: "40px auto",
        padding: "24px",
        fontFamily: "system-ui, sans-serif",
        color: "#e4e4e4",
      }}
    >
      <div
        style={{
          backgroundColor: "#16213e",
          borderRadius: "12px",
          padding: "32px",
          border: "1px solid #3a3a5c",
        }}
      >
        <h2 style={{ margin: "0 0 8px", color: "#e4e4e4", fontSize: "20px" }}>
          One Piece TCG — Select Your Deck
        </h2>
        <p style={{ margin: "0 0 24px", color: "#a0a0c0", fontSize: "14px" }}>
          Player {playerId} — choose a deck to load into the game
        </p>

        {isLoadingDecks ? (
          <div
            style={{ textAlign: "center", padding: "40px", color: "#a0a0c0" }}
          >
            Loading saved decks...
          </div>
        ) : decks.length === 0 ? (
          <div style={{ textAlign: "center", padding: "40px" }}>
            <p style={{ color: "#ff9800", marginBottom: "16px" }}>
              No saved decks found.
            </p>
            <p style={{ color: "#a0a0c0", fontSize: "14px" }}>
              Build a deck in the Deck Builder first, then come back to play.
            </p>
          </div>
        ) : (
          <div
            style={{ display: "flex", flexDirection: "column", gap: "10px" }}
          >
            {decks.map((deck) => {
              const cardCount = Object.values(deck.cards).reduce(
                (sum, q) => sum + q,
                0,
              );
              return (
                <div
                  key={deck.id}
                  style={{
                    padding: "14px 18px",
                    backgroundColor: "#1a1a2e",
                    border: "1px solid #3a3a5c",
                    borderRadius: "8px",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, marginBottom: "4px" }}>
                      {deck.name}
                    </div>
                    <div style={{ fontSize: "12px", color: "#a0a0c0" }}>
                      Leader: {deck.leaderId} &bull; {cardCount} cards
                      {deck.packId !== "multi" && (
                        <>
                          {" "}
                          &bull; Pack: {deck.packId.slice(0, 16)}
                          {deck.packId.length > 16 ? "..." : ""}
                        </>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => onLoadDeck(deck)}
                    disabled={isLoadingDeck}
                    style={{
                      padding: "8px 20px",
                      backgroundColor: isLoadingDeck ? "#3a3a5c" : "#4CAF50",
                      color: "#fff",
                      border: "none",
                      borderRadius: "6px",
                      cursor: isLoadingDeck ? "not-allowed" : "pointer",
                      fontSize: "14px",
                      fontWeight: 600,
                      opacity: isLoadingDeck ? 0.6 : 1,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {isLoadingDeck ? "Loading..." : "Load Deck"}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {loadError && (
          <div
            style={{
              marginTop: "16px",
              padding: "12px 16px",
              backgroundColor: "rgba(255, 107, 107, 0.15)",
              border: "1px solid #ff6b6b",
              borderRadius: "6px",
              color: "#ff6b6b",
              fontSize: "14px",
            }}
          >
            {loadError}
          </div>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// Main Board Component
// =============================================================================

import type { JoinCodeConnection } from "../p2p";

export function OnePiecePhaserBoard(
  props: BoardProps<OnePieceState> & { p2pConnection?: JoinCodeConnection },
) {
  const { G, ctx, moves, playerID, p2pConnection } = props as any;

  const localPlayerId = playerID ?? "0";

  // -----------------------------------------------------------------------
  // Deck loading state
  // -----------------------------------------------------------------------
  const [isLoadingDeck, setIsLoadingDeck] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cardPackMap, setCardPackMap] = useState<Map<string, string>>(
    new Map(),
  );
  const [cardRegistry, setCardRegistry] = useState<Map<string, OnePieceCard>>(
    new Map(),
  );

  const [previewCardId, setPreviewCardId] = useState<string | null>(null);
  const [previewCardName, setPreviewCardName] = useState<string | null>(null);

  const { decks, isLoading: isLoadingDecks } = useDeckStorage();

  // Asset sharing channel wrapper (optional). Map JoinCodeConnection -> AssetSharingChannel
  const channel: AssetSharingChannel | null = useMemo(() => {
    if (!p2pConnection) return null;
    return {
      send: (msg: any) => {
        // sendSignal is used by JoinCodeConnection for out-of-band messages
        if ((p2pConnection as any).sendSignal)
          (p2pConnection as any).sendSignal(msg);
        else if ((p2pConnection as any).send) (p2pConnection as any).send(msg);
      },
      onMessage: (cb: (msg: any) => void) => {
        if ((p2pConnection as any).onSignal) {
          (p2pConnection as any).onSignal(cb);
          return () => (p2pConnection as any).offSignal?.(cb);
        }
        if ((p2pConnection as any).onMessage) {
          (p2pConnection as any).onMessage(cb);
          return () => (p2pConnection as any).offMessage?.(cb);
        }
        return () => {};
      },
    };
  }, [p2pConnection]);

  // Known card ids derived from current card registry
  const knownCardIds = useMemo(
    () => new Set(Array.from(cardRegistry.keys())),
    [cardRegistry],
  );

  const assetSharing = useAssetSharing(channel, knownCardIds);

  // Check if the local player's deck is loaded
  const player = G.players[localPlayerId];
  const hasLeader = (player?.playArea ?? []).some(
    (slot) => slot.slotType === "leader" && slot.cardId !== null,
  );
  const hasDeck =
    (player?.mainDeck?.length ?? 0) > 0 || (player?.lifeDeck?.length ?? 0) > 0;
  const isDeckLoaded = hasLeader || hasDeck;

  const handleLoadDeck = useCallback(
    async (deck: DeckList) => {
      setIsLoadingDeck(true);
      setLoadError(null);

      try {
        const resolved = await resolveDeckList(deck, localPlayerId);
        if (!resolved) {
          throw new Error(
            `Asset pack "${deck.packId}" not found. Please load it in Asset Pack Management first.`,
          );
        }

        setCardPackMap(resolved.cardPackMap);
        // Build a card registry for play area lookups (slots only store cardId, not the full object)
        const registry = new Map<string, OnePieceCard>();
        for (const card of resolved.cards) {
          registry.set(card.id, card);
        }
        setCardRegistry(registry);
        moves.loadDeck?.(localPlayerId, resolved.cards);

        // Share deck list with peer (if asset-sharing channel available)
        try {
          if (assetSharing && assetSharing.shareDeckList) {
            const deckList = {
              name: deck.name,
              game: "onepiece",
              pack: deck.packId,
              leader: deck.leaderId,
              cards: deck.cards,
            } as any;
            const packMeta = {
              id: deck.packId,
              name: deck.packId,
              game: "onepiece",
              cardCount: resolved.cards.length,
            } as any;
            assetSharing.shareDeckList(deckList, packMeta);
          }
        } catch (err) {
          console.warn("[OnePiece] shareDeckList failed", err);
        }
      } catch (err) {
        setLoadError(
          err instanceof Error ? err.message : "Failed to load deck",
        );
      } finally {
        setIsLoadingDeck(false);
      }
    },
    [localPlayerId, moves],
  );

  // -----------------------------------------------------------------------
  // Card image loading — use card registry (all resolved cards from deck load)
  // -----------------------------------------------------------------------
  const allGameCards = useMemo(() => {
    if (cardRegistry.size === 0) return null;
    return Array.from(cardRegistry.values());
  }, [cardRegistry]);

  const gameCardImages = useGameCardImages(allGameCards, cardPackMap);

  // Crypto helpers: key pair ref and in-progress guard
  const cryptoKeyPairRef = useRef<CryptoKeyPair | null>(null);
  const cryptoSetupInProgress = useRef<Set<string>>(new Set());

  // -----------------------------------------------------------------------
  // Deck selection phase
  // -----------------------------------------------------------------------
  if (!isDeckLoaded) {
    return (
      <DeckSelectionScreen
        decks={decks}
        isLoadingDecks={isLoadingDecks}
        isLoadingDeck={isLoadingDeck}
        loadError={loadError}
        onLoadDeck={handleLoadDeck}
        playerId={localPlayerId}
      />
    );
  }

  // If deck is loaded locally but peer deck not yet received, show waiting overlay
  const isWaitingForPeer =
    isDeckLoaded && !!assetSharing && !assetSharing.peerDeckList;

  // -----------------------------------------------------------------------
  // Game board (deck loaded)
  // -----------------------------------------------------------------------

  // Convert game state to SceneState
  const sceneState: SceneState = (() => {
    const players: Record<string, PlayerSceneState> = {};
    for (const pid of Object.keys(G.players)) {
      const isLocal = pid === localPlayerId;
      players[pid] = toPlayerSceneState(pid, G, isLocal, cardRegistry);
    }

    return {
      players,
      currentPlayer: ctx.currentPlayer,
      viewingPlayer: localPlayerId,
      phase: G.phase ?? ctx.phase ?? "play",
      cardImages: gameCardImages,
      cardBackUrl: "",
      interactionsEnabled:
        G.phase === "play" && ctx.currentPlayer === localPlayerId,
    };
  })();

  // ===========================================================================
  // Crypto auto-setup hooks (key exchange, escrow, encrypt, shuffle)
  // ===========================================================================
  useEffect(() => {
    // Cast G to crypto state if present
    const cryptoG = G as unknown as OnePieceCryptoState | undefined;
    if (!cryptoG || !cryptoG.crypto) return;

    const phase = G.phase;
    const actionKey = `${phase}-${localPlayerId}`;

    // Avoid duplicate attempts
    if (cryptoSetupInProgress.current.has(actionKey)) return;

    // Helper to get or create key pair
    const getOrCreateKeyPair = (): CryptoKeyPair => {
      if (cryptoKeyPairRef.current) return cryptoKeyPairRef.current;
      const kp = generateKeyPair();
      cryptoKeyPairRef.current = kp;
      return kp;
    };

    // Player crypto state
    const myCrypto = cryptoG.players?.[localPlayerId] as
      | OnePieceCryptoPlayerState
      | undefined;

    // Key Exchange: submit public key
    if (phase === "keyExchange" && myCrypto && !myCrypto.publicKey) {
      cryptoSetupInProgress.current.add(actionKey);
      const kp = getOrCreateKeyPair();
      setTimeout(() => {
        try {
          moves.submitPublicKey?.(localPlayerId, kp.publicKey);
        } catch (err) {
          console.error("[OnePiece] submitPublicKey failed", err);
        }
      }, 80);
      return;
    }

    // Encrypt: when it's our setupPlayerIndex turn, encryptDeck
    if (
      phase === "encrypt" &&
      cryptoG.setupPlayerIndex != null &&
      myCrypto &&
      !myCrypto.hasEncrypted
    ) {
      const currentSetupPlayer =
        cryptoG.playerOrder?.[cryptoG.setupPlayerIndex];
      if (currentSetupPlayer === localPlayerId) {
        const kp = getOrCreateKeyPair();
        cryptoSetupInProgress.current.add(actionKey);
        setTimeout(() => {
          try {
            moves.encryptDeck?.(localPlayerId, kp.privateKey);
          } catch (err) {
            console.error("[OnePiece] encryptDeck failed", err);
          }
        }, 120);
      }
      return;
    }

    // Shuffle: commit/reveal flow and shuffleEncryptedDeck
    if (
      phase === "shuffle" &&
      cryptoG.shuffleRng &&
      myCrypto &&
      !myCrypto.hasShuffled
    ) {
      const rng = cryptoG.shuffleRng;
      const kp = getOrCreateKeyPair();

      // Commit phase
      if (rng.phase === "commit" && !rng.commits?.[localPlayerId]) {
        cryptoSetupInProgress.current.add(actionKey);
        // simple seed: random hex from keypair privateKey slice
        const seedHex =
          kp.privateKey.slice(0, 32) || Math.random().toString(16).slice(2, 34);
        const commitHash = seedHex; // game will hash server-side; keep simple
        setTimeout(() => {
          try {
            moves.commitShuffleSeed?.(localPlayerId, commitHash);
          } catch (err) {
            console.error("[OnePiece] commitShuffleSeed failed", err);
          }
        }, 80);
        return;
      }

      // Reveal phase
      if (rng.phase === "reveal" && !rng.reveals?.[localPlayerId]) {
        cryptoSetupInProgress.current.add(actionKey);
        const seedHex =
          kp.privateKey.slice(0, 32) || Math.random().toString(16).slice(2, 34);
        setTimeout(() => {
          try {
            moves.revealShuffleSeed?.(localPlayerId, seedHex);
          } catch (err) {
            console.error("[OnePiece] revealShuffleSeed failed", err);
          }
        }, 120);
        return;
      }

      // Ready: perform shuffle when it's our turn
      if (rng.phase === "ready") {
        const currentSetupPlayer =
          cryptoG.playerOrder?.[cryptoG.setupPlayerIndex];
        if (currentSetupPlayer === localPlayerId) {
          cryptoSetupInProgress.current.add(actionKey);
          setTimeout(() => {
            try {
              moves.shuffleEncryptedDeck?.(localPlayerId);
            } catch (err) {
              console.error("[OnePiece] shuffleEncryptedDeck failed", err);
            }
          }, 120);
        }
      }
    }
  }, [G.phase, G.players, G.turnCount, localPlayerId, moves]);

  return (
    <div style={{ width: "100%", margin: "0 auto" }}>
      {/* Waiting overlay when we've loaded a deck but are awaiting peer's deck list */}
      {isWaitingForPeer && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0,0,0,0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1200,
          }}
        >
          <div
            style={{
              backgroundColor: "#16213e",
              padding: 24,
              borderRadius: 12,
              border: "1px solid #3a3a5c",
              color: "#e4e4e4",
              textAlign: "center",
              maxWidth: 420,
            }}
          >
            <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>
              Waiting for opponent's deck…
            </div>
            <div style={{ color: "#9ca3af", fontSize: 13 }}>
              Your deck is loaded and synchronized locally. Waiting for the
              opponent to share their deck list.
            </div>
            <div style={{ marginTop: 12 }}>
              <button
                onClick={() => assetSharing?.dismissMissing?.()}
                style={{
                  padding: "8px 14px",
                  borderRadius: 8,
                  border: "none",
                  backgroundColor: "#374151",
                  color: "#e4e4e4",
                }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Header: phase strip + leader life */}
      <div
        style={{
          padding: "8px 16px",
          display: "flex",
          alignItems: "center",
          gap: "12px",
        }}
      >
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            {/* Stage strip */}
            {["keyExchange", "encrypt", "shuffle", "play"].map(
              (p) => {
                const label =
                  p === "keyExchange"
                    ? "🔐 Key Exchange"
                    : p === "encrypt"
                      ? "🔐 Encrypt"
                      : p === "shuffle"
                        ? "🔐 Shuffle"
                        : "🎮 Play";
                const isCurrent = G.phase === p;
                const ordering = [
                  "keyExchange",
                  "encrypt",
                  "shuffle",
                ];
                const isPast =
                  ordering.indexOf(G.phase as any) > ordering.indexOf(p as any);
                return (
                  <div
                    key={p}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                    }}
                  >
                    <div
                      style={{
                        padding: "6px 10px",
                        borderRadius: "8px",
                        backgroundColor: isCurrent
                          ? "#1e3a5f"
                          : isPast
                            ? "#133a2b"
                            : "#1f2937",
                        border: `1px solid ${isCurrent ? "#3b82f6" : isPast ? "#22c55e" : "#374151"}`,
                        color: isCurrent || isPast ? "#fff" : "#9ca3af",
                        fontSize: "12px",
                      }}
                    >
                      {label}
                    </div>
                  </div>
                );
              },
            )}
          </div>
          <div
            style={{
              marginTop: "6px",
              color: "#a0a0c0",
              fontSize: "12px",
              fontFamily: "monospace",
            }}
          >
            <span style={{ marginRight: "12px" }}>
              Turn: {G.turnCount ?? 0}
            </span>
            <span>
              {ctx.currentPlayer === localPlayerId
                ? "Your turn"
                : "Opponent's turn"}
            </span>
          </div>
        </div>

        {/* Leader life display for each player */}
        <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
          {Object.keys(G.players).map((pid) => (
            <div
              key={pid}
              style={{
                padding: "8px 12px",
                backgroundColor: "#16213e",
                borderRadius: "8px",
                border: "1px solid #3a3a5c",
              }}
            >
              <div style={{ fontSize: "12px", color: "#9ca3af" }}>
                Player {pid}
              </div>
              <div
                style={{ fontSize: "16px", fontWeight: 700, color: "#fbbf24" }}
              >
                {G.leaderLife?.[pid] ?? "-"}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}>
        <CardPreviewPane
          cardId={previewCardId}
          cardImages={gameCardImages}
          cardName={previewCardName}
        />
        <PhaserBoard
          sceneState={sceneState}
          zoneLayout={OnePieceZoneLayout}
          playerId={localPlayerId}
          onInteraction={(event: CardInteractionEvent) => {
            if (event.type === "preview") {
              setPreviewCardId(event.cardId ?? null);
              if (event.cardId) {
                const card = cardRegistry.get(event.cardId);
                setPreviewCardName(card?.name ?? null);
              } else {
                setPreviewCardName(null);
              }
              return;
            }

            if (!moves) return;

            switch (event.type) {
              case "play":
                if (event.cardId && event.targetSlot != null) {
                  moves.playCard?.(
                    localPlayerId,
                    event.cardId,
                    event.targetSlot,
                  );
                }
                break;

              case "draw":
                if (event.sourceZone === "mainDeck") {
                  moves.drawCard?.(localPlayerId);
                } else if (event.sourceZone === "donDeck") {
                  moves.drawDon?.(localPlayerId);
                }
                break;

              case "attachDon":
                if (event.targetSlot != null) {
                  moves.attachDon?.(localPlayerId, event.targetSlot, 1);
                }
                break;

              case "discard":
                if (event.cardId) {
                  const slot = G.players[localPlayerId]?.playArea?.find(
                    (s) => s.cardId === event.cardId,
                  );
                  if (slot) {
                    moves.trashFromPlay?.(localPlayerId, slot.position);
                  }
                }
                break;

              default:
                break;
            }
          }}
          height="1300px"
        />
      </div>

      {/* Transfer list UI (if asset sharing active) */}
      {assetSharing && (
        <div style={{ maxWidth: 800, margin: "12px auto" }}>
          {/* Show missing packs notice with action to request */}
          {assetSharing.missingPacks?.length > 0 && (
            <div
              style={{
                marginBottom: 8,
                padding: 10,
                backgroundColor: "#0f172a",
                border: "1px solid #3a3a5c",
                borderRadius: 8,
              }}
            >
              <div style={{ fontSize: 13, color: "#e4e4e4", fontWeight: 700 }}>
                Missing assets detected
              </div>
              <div style={{ fontSize: 12, color: "#9ca3af" }}>
                {assetSharing.missingPacks[0].missingCardIds.length} cards
                missing from pack {assetSharing.missingPacks[0].packName}
              </div>
              <div style={{ marginTop: 8 }}>
                <button
                  onClick={() => {
                    const mp = assetSharing.missingPacks[0];
                    assetSharing.requestFromPeer(mp.packId, mp.missingCardIds);
                  }}
                  style={{
                    padding: "8px 12px",
                    borderRadius: 8,
                    border: "none",
                    backgroundColor: "#1d4ed8",
                    color: "#fff",
                  }}
                >
                  Request missing cards
                </button>
              </div>
            </div>
          )}

          {/* Transfers */}
          <div>
            {/* Import TransferList lazily to avoid extra bundle if not used */}
            {/* We import from AssetPackSharing index */}
            {/* eslint-disable-next-line @typescript-eslint/no-var-requires */}
            {(() => {
              const { TransferList } = require("./AssetPackSharing");
              return (
                <TransferList
                  transfers={assetSharing.transfers}
                  onCancel={(packId: string) =>
                    assetSharing.cancelTransfer(packId)
                  }
                />
              );
            })()}
          </div>
        </div>
      )}
    </div>
  );
}
