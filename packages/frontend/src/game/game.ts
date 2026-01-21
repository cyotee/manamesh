import { Game, Ctx } from 'boardgame.io';
import { INVALID_MOVE } from 'boardgame.io/core';
import {
  GState,
  createInitialState,
  createTestDeck,
  drawCard,
  playCard,
  discardCard,
  isGameOver,
} from './logic';

export interface SimpleCardGameState extends GState {}

export const SimpleCardGame: Game<SimpleCardGameState> = {
  name: 'simple-card-game',

  setup: (): SimpleCardGameState => {
    const deck = createTestDeck(20);
    return createInitialState(deck, 2);
  },

  turn: {
    minMoves: 1,
    maxMoves: 3,
  },

  moves: {
    drawCard: ({ G, ctx }: { G: SimpleCardGameState; ctx: Ctx }) => {
      const result = drawCard(G, ctx.currentPlayer);
      if (!result.drawnCard) {
        return INVALID_MOVE;
      }
      return result.state;
    },

    playCard: (
      { G, ctx }: { G: SimpleCardGameState; ctx: Ctx },
      cardId: string
    ) => {
      const result = playCard(G, ctx.currentPlayer, cardId);
      if (!result.success) {
        return INVALID_MOVE;
      }
      return result.state;
    },

    discardCard: (
      { G, ctx }: { G: SimpleCardGameState; ctx: Ctx },
      cardId: string
    ) => {
      const result = discardCard(G, ctx.currentPlayer, cardId);
      if (!result.success) {
        return INVALID_MOVE;
      }
      return result.state;
    },
  },

  endIf: ({ G }: { G: SimpleCardGameState }) => {
    if (G.winner) {
      return { winner: G.winner };
    }
    if (isGameOver(G)) {
      return { draw: true };
    }
    return undefined;
  },
};
