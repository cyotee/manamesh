/**
 * OnePiecePhaserBoard — One Piece TCG board powered by Phaser 3.
 *
 * Receives boardgame.io BoardProps<OnePieceState>, converts the game state
 * into a SceneState snapshot, and feeds it to the generic PhaserBoard wrapper.
 * Maps card interaction events from Phaser back to boardgame.io moves.
 */

import { useCallback, useMemo } from 'react';
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

/** Convert a OnePieceCard or DON card to renderable CardSceneState. */
function toCardSceneState(
  card: OnePieceCard | OnePieceDonCard,
  index: number,
  visibility: Record<string, string>,
): CardSceneState {
  const vis = (visibility[card.id] ?? 'encrypted') as CardSceneState['visibility'];
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
): ZoneSceneState {
  return {
    zoneId,
    cards: cards.map((card, i) => toCardSceneState(card, i, visibility)),
  };
}

/** Convert an OnePiecePlayerState to PlayerSceneState. */
function toPlayerSceneState(
  playerId: string,
  G: OnePieceState,
): PlayerSceneState {
  const player = G.players[playerId];
  if (!player) {
    return { zones: {}, playArea: [] };
  }

  const vis = G.cardVisibility ?? {};

  // Build card-lookup map for resolving slot cardIds
  const allCards = new Map<string, OnePieceCard | OnePieceDonCard>();
  for (const card of player.mainDeck) allCards.set(card.id, card);
  for (const card of player.hand) allCards.set(card.id, card);
  for (const card of player.trash) allCards.set(card.id, card);
  for (const card of player.lifeDeck) allCards.set(card.id, card);
  for (const card of player.donDeck) allCards.set(card.id, card);
  for (const card of player.donArea) allCards.set(card.id, card);

  const zones: Record<string, ZoneSceneState> = {
    mainDeck: buildZoneState('mainDeck', player.mainDeck, vis),
    lifeDeck: buildZoneState('lifeDeck', player.lifeDeck, vis),
    donDeck: buildZoneState('donDeck', player.donDeck, vis),
    trash: buildZoneState('trash', player.trash, vis),
    hand: buildZoneState('hand', player.hand, vis),
    donArea: buildZoneState('donArea', player.donArea, vis),
  };

  // Convert play area slots
  const playArea: SlotSceneState[] = player.playArea.map((slot) => {
    let card: CardSceneState | null = null;
    if (slot.cardId) {
      const resolved = allCards.get(slot.cardId);
      if (resolved) {
        card = {
          id: resolved.id,
          name: resolved.name,
          visibility: (vis[resolved.id] ?? 'public') as CardSceneState['visibility'],
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

export function OnePiecePhaserBoard(props: BoardProps<OnePieceState>) {
  const { G, ctx, moves, playerID } = props;

  const localPlayerId = playerID ?? '0';

  // Convert game state to SceneState
  const sceneState: SceneState = useMemo(() => {
    const players: Record<string, PlayerSceneState> = {};
    for (const pid of Object.keys(G.players)) {
      players[pid] = toPlayerSceneState(pid, G);
    }

    return {
      players,
      currentPlayer: ctx.currentPlayer,
      viewingPlayer: localPlayerId,
      phase: G.phase ?? ctx.phase ?? 'play',
      cardImages: {}, // TODO: integrate with useCardImage hook when asset pipeline is ready
      cardBackUrl: '',
      interactionsEnabled: G.phase === 'play' && ctx.currentPlayer === localPlayerId,
    };
  }, [G, ctx, localPlayerId]);

  // Map Phaser interaction events to boardgame.io moves
  const handleInteraction = useCallback(
    (event: CardInteractionEvent) => {
      if (!moves) return;

      switch (event.type) {
        case 'play':
          if (event.cardId && event.targetSlot != null) {
            moves.playCard?.(event.cardId, event.targetSlot);
          } else if (event.cardId && event.targetZone) {
            moves.playCard?.(event.cardId, event.targetZone);
          }
          break;

        case 'draw':
          if (event.sourceZone === 'mainDeck') {
            moves.drawCard?.();
          } else if (event.sourceZone === 'donDeck') {
            moves.drawDon?.();
          }
          break;

        case 'tap':
          if (event.cardId) {
            moves.tapCard?.(event.cardId);
          }
          break;

        case 'untap':
          if (event.cardId) {
            moves.untapCard?.(event.cardId);
          }
          break;

        case 'attachDon':
          if (event.cardId && event.targetSlot != null) {
            moves.attachDon?.(event.cardId, event.targetSlot);
          }
          break;

        case 'discard':
          if (event.cardId) {
            moves.discardCard?.(event.cardId);
          }
          break;

        default:
          // 'preview', 'peek', 'detachDon' — handled by UI overlays, not moves
          break;
      }
    },
    [moves],
  );

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
        onInteraction={handleInteraction}
        height="650px"
      />
    </div>
  );
}
