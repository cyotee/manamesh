/**
 * War Game Module Tests
 *
 * Tests for the War card game implementation.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { INVALID_MOVE } from 'boardgame.io/core';
import type { Ctx } from 'boardgame.io';
import {
  WarModule,
  WarGame,
  createStandardDeck,
  shuffleDeck,
  createInitialState,
  getPlayerCardCount,
  checkGameOver,
  bothPlayersFlipped,
  flipCard,
  placeWarCards,
  resolveRound,
  validateMove,
  compareCards,
  getCardValue,
  RANK_VALUES,
} from './index';
import type { WarCard, WarState } from './types';

// =============================================================================
// Test Utilities
// =============================================================================

function createTestCard(suit: WarCard['suit'], rank: WarCard['rank']): WarCard {
  return {
    id: `${suit}-${rank}`,
    name: `${rank} of ${suit}`,
    suit,
    rank,
  };
}

function createMockCtx(currentPlayer: string = '0'): Ctx {
  return {
    numPlayers: 2,
    turn: 1,
    currentPlayer,
    playOrder: ['0', '1'],
    playOrderPos: 0,
    phase: 'play',
    activePlayers: null,
  } as Ctx;
}

function createTestState(): WarState {
  return createInitialState({
    numPlayers: 2,
    playerIDs: ['0', '1'],
  });
}

// =============================================================================
// Card Utilities Tests
// =============================================================================

describe('Card Utilities', () => {
  describe('createStandardDeck', () => {
    it('should create 52 cards', () => {
      const deck = createStandardDeck();
      expect(deck).toHaveLength(52);
    });

    it('should have 4 suits with 13 cards each', () => {
      const deck = createStandardDeck();
      const suits = ['hearts', 'diamonds', 'clubs', 'spades'];

      for (const suit of suits) {
        const suitCards = deck.filter((c) => c.suit === suit);
        expect(suitCards).toHaveLength(13);
      }
    });

    it('should have unique card IDs', () => {
      const deck = createStandardDeck();
      const ids = deck.map((c) => c.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(52);
    });
  });

  describe('shuffleDeck', () => {
    it('should return same number of cards', () => {
      const deck = createStandardDeck();
      const shuffled = shuffleDeck(deck);
      expect(shuffled).toHaveLength(52);
    });

    it('should not modify original deck', () => {
      const deck = createStandardDeck();
      const originalIds = deck.map((c) => c.id);
      shuffleDeck(deck);
      expect(deck.map((c) => c.id)).toEqual(originalIds);
    });

    it('should produce different orderings', () => {
      const deck = createStandardDeck();
      const results = new Set<string>();

      for (let i = 0; i < 10; i++) {
        const shuffled = shuffleDeck(deck);
        results.add(shuffled.map((c) => c.id).join(','));
      }

      expect(results.size).toBeGreaterThan(1);
    });
  });

  describe('getCardValue', () => {
    it('should return correct values for number cards', () => {
      expect(getCardValue(createTestCard('hearts', '2'))).toBe(2);
      expect(getCardValue(createTestCard('hearts', '10'))).toBe(10);
    });

    it('should return correct values for face cards', () => {
      expect(getCardValue(createTestCard('hearts', 'J'))).toBe(11);
      expect(getCardValue(createTestCard('hearts', 'Q'))).toBe(12);
      expect(getCardValue(createTestCard('hearts', 'K'))).toBe(13);
    });

    it('should return 14 for Ace (Ace high)', () => {
      expect(getCardValue(createTestCard('hearts', 'A'))).toBe(14);
    });
  });

  describe('compareCards', () => {
    it('should return positive when first card wins', () => {
      const ace = createTestCard('hearts', 'A');
      const king = createTestCard('spades', 'K');
      expect(compareCards(ace, king)).toBeGreaterThan(0);
    });

    it('should return negative when second card wins', () => {
      const two = createTestCard('hearts', '2');
      const three = createTestCard('spades', '3');
      expect(compareCards(two, three)).toBeLessThan(0);
    });

    it('should return 0 for matching ranks', () => {
      const queen1 = createTestCard('hearts', 'Q');
      const queen2 = createTestCard('spades', 'Q');
      expect(compareCards(queen1, queen2)).toBe(0);
    });
  });
});

// =============================================================================
// State Management Tests
// =============================================================================

describe('State Management', () => {
  describe('createInitialState', () => {
    it('should create state with two players', () => {
      const state = createTestState();
      expect(Object.keys(state.players)).toHaveLength(2);
    });

    it('should deal 26 cards to each player', () => {
      const state = createTestState();
      expect(state.players['0'].deck).toHaveLength(26);
      expect(state.players['1'].deck).toHaveLength(26);
    });

    it('should start with empty played and won piles', () => {
      const state = createTestState();
      expect(state.players['0'].played).toHaveLength(0);
      expect(state.players['0'].won).toHaveLength(0);
      expect(state.players['1'].played).toHaveLength(0);
      expect(state.players['1'].won).toHaveLength(0);
    });

    it('should not have war in progress', () => {
      const state = createTestState();
      expect(state.warInProgress).toBe(false);
    });

    it('should start in flip phase', () => {
      const state = createTestState();
      expect(state.phase).toBe('flip');
    });

    it('should have no winner initially', () => {
      const state = createTestState();
      expect(state.winner).toBeNull();
    });

    it('should sync zones with player state', () => {
      const state = createTestState();
      expect(state.zones.deck['0']).toEqual(state.players['0'].deck);
      expect(state.zones.deck['1']).toEqual(state.players['1'].deck);
    });
  });

  describe('getPlayerCardCount', () => {
    it('should count all cards across zones', () => {
      const state = createTestState();
      expect(getPlayerCardCount(state.players['0'])).toBe(26);
    });

    it('should count cards in played and won zones', () => {
      const state = createTestState();
      // Move some cards
      state.players['0'].played.push(state.players['0'].deck.shift()!);
      state.players['0'].won.push(state.players['0'].deck.shift()!);

      expect(getPlayerCardCount(state.players['0'])).toBe(26);
    });
  });

  describe('checkGameOver', () => {
    it('should return null when game is not over', () => {
      const state = createTestState();
      expect(checkGameOver(state)).toBeNull();
    });

    it('should return winner when one player has 52 cards', () => {
      const state = createTestState();
      // Give all cards to player 0
      state.players['0'].deck = [...state.players['0'].deck, ...state.players['1'].deck];
      state.players['1'].deck = [];

      expect(checkGameOver(state)).toBe('0');
    });

    it('should return other player when one has 0 cards', () => {
      const state = createTestState();
      state.players['1'].deck = [];
      state.players['1'].played = [];
      state.players['1'].won = [];

      expect(checkGameOver(state)).toBe('0');
    });
  });

  describe('bothPlayersFlipped', () => {
    it('should return false initially', () => {
      const state = createTestState();
      expect(bothPlayersFlipped(state)).toBe(false);
    });

    it('should return false when only one player flipped', () => {
      const state = createTestState();
      state.players['0'].played.push(state.players['0'].deck.shift()!);
      expect(bothPlayersFlipped(state)).toBe(false);
    });

    it('should return true when both players flipped', () => {
      const state = createTestState();
      state.players['0'].played.push(state.players['0'].deck.shift()!);
      state.players['1'].played.push(state.players['1'].deck.shift()!);
      expect(bothPlayersFlipped(state)).toBe(true);
    });
  });
});

// =============================================================================
// Move Tests
// =============================================================================

describe('Moves', () => {
  describe('flipCard', () => {
    it('should flip top card from deck to played', () => {
      const state = createTestState();
      const ctx = createMockCtx('0');
      const topCard = state.players['0'].deck[0];

      flipCard(state, ctx);

      expect(state.players['0'].played).toContain(topCard);
      expect(state.players['0'].deck).not.toContain(topCard);
    });

    it('should return INVALID_MOVE if already flipped (no war)', () => {
      const state = createTestState();
      const ctx = createMockCtx('0');

      flipCard(state, ctx);
      const result = flipCard(state, ctx);

      expect(result).toBe(INVALID_MOVE);
    });

    it('should allow flip during war even if already have played cards', () => {
      const state = createTestState();
      const ctx = createMockCtx('0');

      // First flip
      flipCard(state, ctx);

      // Start a war
      state.warInProgress = true;

      // Second flip should work during war
      const result = flipCard(state, ctx);
      expect(result).not.toBe(INVALID_MOVE);
    });

    it('should transition to resolve phase when both players flip', () => {
      const state = createTestState();

      flipCard(state, createMockCtx('0'));
      expect(state.phase).toBe('flip');

      flipCard(state, createMockCtx('1'));
      expect(state.phase).toBe('resolve');
    });

    it('should reshuffle won pile when deck is empty', () => {
      const state = createTestState();
      const ctx = createMockCtx('0');

      // Move all deck cards to won pile
      state.players['0'].won = state.players['0'].deck;
      state.players['0'].deck = [];

      flipCard(state, ctx);

      // Should have reshuffled won pile into deck and drawn
      expect(state.players['0'].played).toHaveLength(1);
      expect(state.players['0'].deck.length + state.players['0'].won.length).toBe(25);
    });

    it('should return INVALID_MOVE when no cards left', () => {
      const state = createTestState();
      const ctx = createMockCtx('0');

      state.players['0'].deck = [];
      state.players['0'].won = [];

      const result = flipCard(state, ctx);
      expect(result).toBe(INVALID_MOVE);
    });
  });

  describe('placeWarCards', () => {
    it('should place up to 3 face-down cards during war', () => {
      const state = createTestState();
      const ctx = createMockCtx('0');

      state.warInProgress = true;

      placeWarCards(state, ctx);

      expect(state.players['0'].played).toHaveLength(3);
      expect(state.players['0'].deck).toHaveLength(23);
    });

    it('should return INVALID_MOVE when not in war', () => {
      const state = createTestState();
      const ctx = createMockCtx('0');

      const result = placeWarCards(state, ctx);
      expect(result).toBe(INVALID_MOVE);
    });

    it('should place fewer cards if deck is small', () => {
      const state = createTestState();
      const ctx = createMockCtx('0');

      state.warInProgress = true;
      state.players['0'].deck = state.players['0'].deck.slice(0, 2);

      placeWarCards(state, ctx);

      expect(state.players['0'].played).toHaveLength(2);
      expect(state.players['0'].deck).toHaveLength(0);
    });
  });

  describe('resolveRound', () => {
    it('should award cards to winner (higher card)', () => {
      const state = createTestState();
      const ctx = createMockCtx();

      // Set up known cards
      state.players['0'].played = [createTestCard('hearts', 'A')];
      state.players['1'].played = [createTestCard('spades', 'K')];
      state.phase = 'resolve';

      resolveRound(state, ctx);

      // Player 0 (Ace) should win
      expect(state.players['0'].won).toHaveLength(2);
      expect(state.players['1'].won).toHaveLength(0);
      expect(state.players['0'].played).toHaveLength(0);
      expect(state.players['1'].played).toHaveLength(0);
    });

    it('should trigger war on matching cards', () => {
      const state = createTestState();
      const ctx = createMockCtx();

      // Set up matching cards
      state.players['0'].played = [createTestCard('hearts', 'Q')];
      state.players['1'].played = [createTestCard('spades', 'Q')];
      state.phase = 'resolve';

      resolveRound(state, ctx);

      // Should trigger war
      expect(state.warInProgress).toBe(true);
      expect(state.phase).toBe('flip');
      // Cards should stay in played zone
      expect(state.players['0'].played).toHaveLength(1);
      expect(state.players['1'].played).toHaveLength(1);
    });

    it('should return INVALID_MOVE if not both players flipped', () => {
      const state = createTestState();
      const ctx = createMockCtx();

      state.players['0'].played = [createTestCard('hearts', 'A')];
      // Player 1 has no played cards

      const result = resolveRound(state, ctx);
      expect(result).toBe(INVALID_MOVE);
    });

    it('should detect game over', () => {
      const state = createTestState();
      const ctx = createMockCtx();

      // Give player 0 almost all cards
      state.players['0'].won = createStandardDeck().slice(0, 50);
      state.players['0'].deck = [];
      state.players['1'].deck = [];
      state.players['1'].won = [];

      state.players['0'].played = [createTestCard('hearts', 'A')];
      state.players['1'].played = [createTestCard('spades', 'K')];
      state.phase = 'resolve';

      resolveRound(state, ctx);

      expect(state.winner).toBe('0');
      expect(state.phase).toBe('gameOver');
    });
  });
});

// =============================================================================
// Move Validation Tests
// =============================================================================

describe('validateMove', () => {
  describe('flipCard', () => {
    it('should validate successful flip', () => {
      const state = createTestState();
      const result = validateMove(state, 'flipCard', '0');
      expect(result.valid).toBe(true);
    });

    it('should reject when not in flip phase', () => {
      const state = createTestState();
      state.phase = 'resolve';

      const result = validateMove(state, 'flipCard', '0');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Not in flip phase');
    });

    it('should reject when already flipped', () => {
      const state = createTestState();
      state.players['0'].played.push(state.players['0'].deck.shift()!);

      const result = validateMove(state, 'flipCard', '0');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Already flipped');
    });

    it('should reject when no cards left', () => {
      const state = createTestState();
      state.players['0'].deck = [];
      state.players['0'].won = [];

      const result = validateMove(state, 'flipCard', '0');
      expect(result.valid).toBe(false);
      expect(result.error).toContain('No cards left');
    });
  });

  describe('resolveRound', () => {
    it('should validate successful resolve', () => {
      const state = createTestState();
      state.phase = 'resolve';
      state.players['0'].played.push(state.players['0'].deck.shift()!);
      state.players['1'].played.push(state.players['1'].deck.shift()!);

      const result = validateMove(state, 'resolveRound', '0');
      expect(result.valid).toBe(true);
    });

    it('should reject when not in resolve phase', () => {
      const state = createTestState();

      const result = validateMove(state, 'resolveRound', '0');
      expect(result.valid).toBe(false);
    });
  });

  it('should reject unknown moves', () => {
    const state = createTestState();
    const result = validateMove(state, 'unknownMove', '0');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Unknown move');
  });
});

// =============================================================================
// Module Tests
// =============================================================================

describe('WarModule', () => {
  it('should have correct identity', () => {
    expect(WarModule.id).toBe('war');
    expect(WarModule.name).toBe('War');
    expect(WarModule.version).toBe('1.0.0');
  });

  it('should define correct zones', () => {
    expect(WarModule.zones).toHaveLength(3);
    expect(WarModule.zones.map((z) => z.id)).toEqual(['deck', 'played', 'won']);
  });

  it('should require card_face assets', () => {
    expect(WarModule.assetRequirements.required).toContain('card_face');
    expect(WarModule.assetRequirements.idFormat).toBe('standard_52');
  });

  it('should have valid card schema', () => {
    const validCard = createTestCard('hearts', 'A');
    const invalidCard = { id: '1', name: 'test' };

    expect(WarModule.cardSchema.validate(validCard)).toBe(true);
    expect(WarModule.cardSchema.validate(invalidCard)).toBe(false);
  });

  it('should generate correct asset key', () => {
    const card = createTestCard('hearts', 'A');
    expect(WarModule.cardSchema.getAssetKey(card)).toBe('hearts-A');
  });

  it('should provide boardgame.io game', () => {
    const game = WarModule.getBoardgameIOGame();
    expect(game.name).toBe('war');
    expect(game.setup).toBeDefined();
    expect(game.endIf).toBeDefined();
  });
});

// =============================================================================
// Integration Tests
// =============================================================================

describe('Full Game Flow', () => {
  it('should play a complete round', () => {
    const state = createTestState();

    // Both players flip
    flipCard(state, createMockCtx('0'));
    flipCard(state, createMockCtx('1'));

    expect(state.phase).toBe('resolve');

    // Resolve the round
    resolveRound(state, createMockCtx());

    // One player should have won cards, played zones clear
    const p0Won = state.players['0'].won.length;
    const p1Won = state.players['1'].won.length;

    // Either p0 won, p1 won, or war started
    expect(p0Won === 2 || p1Won === 2 || state.warInProgress).toBe(true);

    if (!state.warInProgress) {
      expect(state.players['0'].played).toHaveLength(0);
      expect(state.players['1'].played).toHaveLength(0);
    }
  });

  it('should handle war scenario', () => {
    const state = createTestState();

    // Set up matching cards for war
    state.players['0'].deck = [
      createTestCard('hearts', 'K'),
      createTestCard('hearts', '2'),
      createTestCard('hearts', '3'),
      createTestCard('hearts', '4'),
      createTestCard('hearts', '5'),
    ];
    state.players['1'].deck = [
      createTestCard('spades', 'K'),
      createTestCard('spades', '2'),
      createTestCard('spades', '3'),
      createTestCard('spades', '4'),
      createTestCard('spades', '6'),
    ];

    // First flip - matching Kings
    flipCard(state, createMockCtx('0'));
    flipCard(state, createMockCtx('1'));
    resolveRound(state, createMockCtx());

    // Should be in war
    expect(state.warInProgress).toBe(true);

    // Place war cards (3 face-down)
    placeWarCards(state, createMockCtx('0'));
    placeWarCards(state, createMockCtx('1'));

    // Flip final card
    flipCard(state, createMockCtx('0'));
    flipCard(state, createMockCtx('1'));

    // Resolve war
    resolveRound(state, createMockCtx());

    // War should be over, one player has all 10 cards
    expect(state.warInProgress).toBe(false);
    const totalWon = state.players['0'].won.length + state.players['1'].won.length;
    expect(totalWon).toBe(10);
  });

  it('should detect game end', () => {
    const state = createTestState();

    // Give player 0 all but 2 cards, player 1 only 2
    const allCards = createStandardDeck();
    state.players['0'].deck = allCards.slice(0, 50);
    state.players['1'].deck = allCards.slice(50, 52);
    state.players['0'].won = [];
    state.players['1'].won = [];

    // Force player 0 to win this round
    state.players['0'].played = [createTestCard('hearts', 'A')];
    state.players['1'].played = [createTestCard('spades', '2')];
    state.phase = 'resolve';

    resolveRound(state, createMockCtx());

    // Game should be over
    expect(state.winner).toBe('0');
    expect(state.phase).toBe('gameOver');
  });
});
