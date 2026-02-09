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

import { useState, useCallback, useMemo } from 'react';
import type { BoardProps } from 'boardgame.io/react';
import type { OnePieceState, OnePieceCard, OnePieceDonCard } from '../game/modules/onepiece/types';
import { PhaserBoard } from '../phaser/PhaserBoard';
import { OnePieceZoneLayout } from '../phaser/layout/OnePieceLayout';
import type {
  SceneState,
  PlayerSceneState,
  ZoneSceneState,
  CardSceneState,
  SlotSceneState,
  CardInteractionEvent,
} from '../phaser/types';
import { useDeckStorage } from '../hooks/useDeckStorage';
import { useGameCardImages } from '../hooks/useGameCardImages';
import type { DeckList } from '../deck/types';
import { resolveDeckList } from '../game/modules/onepiece/deckResolver';

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
  let vis = (visibility[card.id] ?? 'encrypted') as CardSceneState['visibility'];
  // Opponent's 'owner-known' cards must appear face-down to us
  if (!isLocalPlayer && vis === 'owner-known') {
    vis = 'encrypted';
  }
  return {
    id: card.id,
    name: card.name,
    visibility: vis,
    isTapped: false,
    counter: 'counter' in card && card.counter != null ? card.counter : null,
    power: 'power' in card && card.power != null ? card.power : null,
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
    cards: cards.map((card, i) => toCardSceneState(card, i, visibility, isLocalPlayer)),
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
    mainDeck: buildZoneState('mainDeck', player.mainDeck ?? [], vis, isLocalPlayer),
    lifeDeck: buildZoneState('lifeDeck', player.lifeDeck ?? [], vis, isLocalPlayer),
    donDeck: buildZoneState('donDeck', player.donDeck ?? [], vis, isLocalPlayer),
    trash: buildZoneState('trash', player.trash ?? [], vis, isLocalPlayer),
    hand: buildZoneState('hand', player.hand ?? [], vis, isLocalPlayer),
    donArea: buildZoneState('donArea', player.donArea ?? [], vis, isLocalPlayer),
  };

  // Convert play area slots
  const playArea: SlotSceneState[] = (player.playArea ?? []).map((slot) => {
    let card: CardSceneState | null = null;
    if (slot.cardId) {
      const resolved = allCards.get(slot.cardId);
      if (resolved) {
        let slotVis = (vis[resolved.id] ?? 'public') as CardSceneState['visibility'];
        if (!isLocalPlayer && slotVis === 'owner-known') {
          slotVis = 'encrypted';
        }
        card = {
          id: resolved.id,
          name: resolved.name,
          visibility: slotVis,
          isTapped: false, // TODO: track tap state per slot in game state
          counter: 'counter' in resolved && resolved.counter != null ? resolved.counter : null,
          power: 'power' in resolved && resolved.power != null ? resolved.power : null,
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
        width: '100%',
        maxWidth: '800px',
        margin: '40px auto',
        padding: '24px',
        fontFamily: 'system-ui, sans-serif',
        color: '#e4e4e4',
      }}
    >
      <div
        style={{
          backgroundColor: '#16213e',
          borderRadius: '12px',
          padding: '32px',
          border: '1px solid #3a3a5c',
        }}
      >
        <h2 style={{ margin: '0 0 8px', color: '#e4e4e4', fontSize: '20px' }}>
          One Piece TCG — Select Your Deck
        </h2>
        <p style={{ margin: '0 0 24px', color: '#a0a0c0', fontSize: '14px' }}>
          Player {playerId} — choose a deck to load into the game
        </p>

        {isLoadingDecks ? (
          <div style={{ textAlign: 'center', padding: '40px', color: '#a0a0c0' }}>
            Loading saved decks...
          </div>
        ) : decks.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px' }}>
            <p style={{ color: '#ff9800', marginBottom: '16px' }}>
              No saved decks found.
            </p>
            <p style={{ color: '#a0a0c0', fontSize: '14px' }}>
              Build a deck in the Deck Builder first, then come back to play.
            </p>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {decks.map((deck) => {
              const cardCount = Object.values(deck.cards).reduce(
                (sum, q) => sum + q,
                0,
              );
              return (
                <div
                  key={deck.id}
                  style={{
                    padding: '14px 18px',
                    backgroundColor: '#1a1a2e',
                    border: '1px solid #3a3a5c',
                    borderRadius: '8px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, marginBottom: '4px' }}>
                      {deck.name}
                    </div>
                    <div style={{ fontSize: '12px', color: '#a0a0c0' }}>
                      Leader: {deck.leaderId} &bull; {cardCount} cards
                      {deck.packId !== 'multi' && (
                        <>
                          {' '}&bull; Pack: {deck.packId.slice(0, 16)}
                          {deck.packId.length > 16 ? '...' : ''}
                        </>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => onLoadDeck(deck)}
                    disabled={isLoadingDeck}
                    style={{
                      padding: '8px 20px',
                      backgroundColor: isLoadingDeck ? '#3a3a5c' : '#4CAF50',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '6px',
                      cursor: isLoadingDeck ? 'not-allowed' : 'pointer',
                      fontSize: '14px',
                      fontWeight: 600,
                      opacity: isLoadingDeck ? 0.6 : 1,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {isLoadingDeck ? 'Loading...' : 'Load Deck'}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {loadError && (
          <div
            style={{
              marginTop: '16px',
              padding: '12px 16px',
              backgroundColor: 'rgba(255, 107, 107, 0.15)',
              border: '1px solid #ff6b6b',
              borderRadius: '6px',
              color: '#ff6b6b',
              fontSize: '14px',
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

export function OnePiecePhaserBoard(props: BoardProps<OnePieceState>) {
  const { G, ctx, moves, playerID } = props;

  const localPlayerId = playerID ?? '0';

  // -----------------------------------------------------------------------
  // Deck loading state
  // -----------------------------------------------------------------------
  const [isLoadingDeck, setIsLoadingDeck] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [cardPackMap, setCardPackMap] = useState<Map<string, string>>(new Map());
  const [cardRegistry, setCardRegistry] = useState<Map<string, OnePieceCard>>(new Map());

  const { decks, isLoading: isLoadingDecks } = useDeckStorage();

  // Check if the local player's deck is loaded
  const player = G.players[localPlayerId];
  const hasLeader = (player?.playArea ?? []).some(
    (slot) => slot.slotType === 'leader' && slot.cardId !== null,
  );
  const hasDeck = (player?.mainDeck?.length ?? 0) > 0 || (player?.lifeDeck?.length ?? 0) > 0;
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
      } catch (err) {
        setLoadError(
          err instanceof Error ? err.message : 'Failed to load deck',
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
      phase: G.phase ?? ctx.phase ?? 'play',
      cardImages: gameCardImages,
      cardBackUrl: '',
      interactionsEnabled: G.phase === 'play' && ctx.currentPlayer === localPlayerId,
    };
  })();

  return (
    <div style={{ width: '100%', maxWidth: '1200px', margin: '0 auto' }}>
      {/* Phase / turn indicator */}
      <div
        style={{
          padding: '8px 16px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          color: '#a0a0c0',
          fontSize: '12px',
          fontFamily: 'monospace',
        }}
      >
        <span>Phase: {G.phase ?? 'unknown'}</span>
        <span>Turn: {G.turnCount ?? 0}</span>
        <span>
          {ctx.currentPlayer === localPlayerId ? 'Your turn' : "Opponent's turn"}
        </span>
      </div>

      <PhaserBoard
        sceneState={sceneState}
        zoneLayout={OnePieceZoneLayout}
        playerId={localPlayerId}
        onInteraction={(event: CardInteractionEvent) => {
          if (!moves) return;

          switch (event.type) {
            case 'play':
              if (event.cardId && event.targetSlot != null) {
                moves.playCard?.(localPlayerId, event.cardId, event.targetSlot);
              }
              break;

            case 'draw':
              if (event.sourceZone === 'mainDeck') {
                moves.drawCard?.(localPlayerId);
              } else if (event.sourceZone === 'donDeck') {
                moves.drawDon?.(localPlayerId);
              }
              break;

            case 'attachDon':
              if (event.targetSlot != null) {
                moves.attachDon?.(localPlayerId, event.targetSlot, 1);
              }
              break;

            case 'discard':
              if (event.cardId) {
                // Find the slot position for the card to trash from play
                const slot = G.players[localPlayerId]?.playArea?.find(
                  (s) => s.cardId === event.cardId,
                );
                if (slot) {
                  moves.trashFromPlay?.(localPlayerId, slot.position);
                }
              }
              break;

            default:
              // 'preview', 'peek', 'tap', 'untap', 'detachDon' — handled by UI overlays or not yet implemented
              break;
          }
        }}
        height="650px"
      />
    </div>
  );
}
