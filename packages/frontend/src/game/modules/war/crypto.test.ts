import { describe, expect, it, beforeEach } from 'vitest';
import type { Ctx } from 'boardgame.io';
import {
  CryptoWarGame,
  CryptoWarState,
  createCryptoWarState,
  submitPublicKey,
  encryptDeck,
  shuffleDeck,
  flipCard,
  submitDecryptionShare,
  resolveRound,
  allKeysSubmitted,
  allPlayersEncrypted,
  allPlayersShuffled,
  parseCardId,
  createCardIds,
  getShuffleProofs,
  verifyPlayerShuffle,
} from './crypto';
import { createPlayerCryptoContext, type CryptoPlayerContext } from '../../../crypto';

describe('CryptoWar', () => {
  let state: CryptoWarState;
  let ctx: Ctx;
  let playerA: CryptoPlayerContext;
  let playerB: CryptoPlayerContext;

  beforeEach(() => {
    // Create deterministic player contexts for testing
    const seedA = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const seedB = new Uint8Array([8, 7, 6, 5, 4, 3, 2, 1]);

    playerA = createPlayerCryptoContext('playerA', seedA);
    playerB = createPlayerCryptoContext('playerB', seedB);

    // Initialize game state
    state = createCryptoWarState({
      numPlayers: 2,
      playerIDs: ['playerA', 'playerB'],
    });

    ctx = {
      numPlayers: 2,
      playOrder: ['playerA', 'playerB'],
      currentPlayer: 'playerA',
    } as unknown as Ctx;
  });

  describe('createCardIds', () => {
    it('creates 52 card IDs', () => {
      const ids = createCardIds();
      expect(ids).toHaveLength(52);
    });

    it('includes all suits and ranks', () => {
      const ids = createCardIds();
      expect(ids).toContain('hearts-A');
      expect(ids).toContain('spades-K');
      expect(ids).toContain('diamonds-2');
      expect(ids).toContain('clubs-10');
    });
  });

  describe('parseCardId', () => {
    it('parses card ID into WarCard', () => {
      const card = parseCardId('hearts-A');
      expect(card.id).toBe('hearts-A');
      expect(card.suit).toBe('hearts');
      expect(card.rank).toBe('A');
      expect(card.name).toBe('A of hearts');
    });
  });

  describe('createCryptoWarState', () => {
    it('creates initial state in keyExchange phase', () => {
      expect(state.phase).toBe('keyExchange');
      expect(state.cardIds).toHaveLength(52);
      expect(state.playerOrder).toEqual(['playerA', 'playerB']);
    });

    it('initializes player states correctly', () => {
      expect(state.players.playerA).toBeDefined();
      expect(state.players.playerB).toBeDefined();
      expect(state.players.playerA.publicKey).toBeNull();
      expect(state.players.playerA.hasEncrypted).toBe(false);
      expect(state.players.playerA.hasShuffled).toBe(false);
    });

    it('initializes crypto plugin state', () => {
      expect(state.crypto).toBeDefined();
      expect(state.crypto.phase).toBe('init');
    });
  });

  describe('Key Exchange Phase', () => {
    it('allows players to submit public keys', () => {
      const result = submitPublicKey(state, ctx, 'playerA', playerA.keyPair.publicKey);
      expect(result).not.toBe('INVALID_MOVE');

      const newState = result as CryptoWarState;
      expect(newState.players.playerA.publicKey).toBe(playerA.keyPair.publicKey);
    });

    it('rejects duplicate key submission', () => {
      submitPublicKey(state, ctx, 'playerA', playerA.keyPair.publicKey);
      const result = submitPublicKey(state, ctx, 'playerA', playerA.keyPair.publicKey);
      expect(result).toBe('INVALID_MOVE');
    });

    it('transitions to encrypt phase when all keys submitted', () => {
      submitPublicKey(state, ctx, 'playerA', playerA.keyPair.publicKey);
      expect(state.phase).toBe('keyExchange');

      submitPublicKey(state, ctx, 'playerB', playerB.keyPair.publicKey);
      expect(state.phase).toBe('encrypt');
    });

    it('tracks all keys submitted correctly', () => {
      expect(allKeysSubmitted(state)).toBe(false);

      submitPublicKey(state, ctx, 'playerA', playerA.keyPair.publicKey);
      expect(allKeysSubmitted(state)).toBe(false);

      submitPublicKey(state, ctx, 'playerB', playerB.keyPair.publicKey);
      expect(allKeysSubmitted(state)).toBe(true);
    });
  });

  describe('Encryption Phase', () => {
    beforeEach(() => {
      // Complete key exchange
      submitPublicKey(state, ctx, 'playerA', playerA.keyPair.publicKey);
      submitPublicKey(state, ctx, 'playerB', playerB.keyPair.publicKey);
    });

    it('starts in encrypt phase after key exchange', () => {
      expect(state.phase).toBe('encrypt');
    });

    it('allows first player to encrypt deck', () => {
      const result = encryptDeck(state, ctx, 'playerA', playerA.keyPair.privateKey);
      expect(result).not.toBe('INVALID_MOVE');

      const newState = result as CryptoWarState;
      expect(newState.players.playerA.hasEncrypted).toBe(true);
    });

    it('requires sequential encryption order', () => {
      // Player B can't encrypt before player A
      const result = encryptDeck(state, ctx, 'playerB', playerB.keyPair.privateKey);
      expect(result).toBe('INVALID_MOVE');
    });

    it('transitions to shuffle phase when all encrypted', () => {
      encryptDeck(state, ctx, 'playerA', playerA.keyPair.privateKey);
      expect(state.phase).toBe('encrypt');

      encryptDeck(state, ctx, 'playerB', playerB.keyPair.privateKey);
      expect(state.phase).toBe('shuffle');
    });

    it('tracks all players encrypted correctly', () => {
      expect(allPlayersEncrypted(state)).toBe(false);

      encryptDeck(state, ctx, 'playerA', playerA.keyPair.privateKey);
      expect(allPlayersEncrypted(state)).toBe(false);

      encryptDeck(state, ctx, 'playerB', playerB.keyPair.privateKey);
      expect(allPlayersEncrypted(state)).toBe(true);
    });
  });

  describe('Shuffle Phase', () => {
    beforeEach(() => {
      // Complete key exchange and encryption
      submitPublicKey(state, ctx, 'playerA', playerA.keyPair.publicKey);
      submitPublicKey(state, ctx, 'playerB', playerB.keyPair.publicKey);
      encryptDeck(state, ctx, 'playerA', playerA.keyPair.privateKey);
      encryptDeck(state, ctx, 'playerB', playerB.keyPair.privateKey);
    });

    it('starts in shuffle phase after encryption', () => {
      expect(state.phase).toBe('shuffle');
    });

    it('allows first player to shuffle deck', async () => {
      const result = await shuffleDeck(state, ctx, 'playerA', playerA.keyPair.privateKey);
      expect(result).not.toBe('INVALID_MOVE');

      const newState = result as CryptoWarState;
      expect(newState.players.playerA.hasShuffled).toBe(true);
    });

    it('requires sequential shuffle order', async () => {
      // Player B can't shuffle before player A
      const result = await shuffleDeck(state, ctx, 'playerB', playerB.keyPair.privateKey);
      expect(result).toBe('INVALID_MOVE');
    });

    it('stores shuffle proof', async () => {
      await shuffleDeck(state, ctx, 'playerA', playerA.keyPair.privateKey);

      const proofs = getShuffleProofs(state);
      expect(proofs.playerA).toBeDefined();
      expect(proofs.playerA.commitment).toBeDefined();
    });

    it('transitions to flip phase when all shuffled', async () => {
      await shuffleDeck(state, ctx, 'playerA', playerA.keyPair.privateKey);
      expect(state.phase).toBe('shuffle');

      await shuffleDeck(state, ctx, 'playerB', playerB.keyPair.privateKey);
      expect(state.phase).toBe('flip');
    });

    it('tracks all players shuffled correctly', async () => {
      expect(allPlayersShuffled(state)).toBe(false);

      await shuffleDeck(state, ctx, 'playerA', playerA.keyPair.privateKey);
      expect(allPlayersShuffled(state)).toBe(false);

      await shuffleDeck(state, ctx, 'playerB', playerB.keyPair.privateKey);
      expect(allPlayersShuffled(state)).toBe(true);
    });
  });

  describe('Shuffle Proof Verification', () => {
    beforeEach(async () => {
      // Complete setup
      submitPublicKey(state, ctx, 'playerA', playerA.keyPair.publicKey);
      submitPublicKey(state, ctx, 'playerB', playerB.keyPair.publicKey);
      encryptDeck(state, ctx, 'playerA', playerA.keyPair.privateKey);
      encryptDeck(state, ctx, 'playerB', playerB.keyPair.privateKey);
      await shuffleDeck(state, ctx, 'playerA', playerA.keyPair.privateKey);
      await shuffleDeck(state, ctx, 'playerB', playerB.keyPair.privateKey);
    });

    it('verifies valid shuffle proofs', () => {
      expect(verifyPlayerShuffle(state, 'playerA')).toBe(true);
      expect(verifyPlayerShuffle(state, 'playerB')).toBe(true);
    });

    it('returns false for missing proofs', () => {
      expect(verifyPlayerShuffle(state, 'playerC')).toBe(false);
    });
  });

  describe('CryptoWarGame boardgame.io integration', () => {
    it('has correct game name', () => {
      expect(CryptoWarGame.name).toBe('crypto-war');
    });

    it('has keyExchange as starting phase', () => {
      expect(CryptoWarGame.phases?.keyExchange?.start).toBe(true);
    });

    it('setup creates valid initial state', () => {
      const setupCtx = {
        numPlayers: 2,
        playOrder: ['0', '1'],
      } as unknown as Ctx;

      const initialState = CryptoWarGame.setup?.(setupCtx, {} as any);
      expect(initialState).toBeDefined();
      expect((initialState as CryptoWarState).phase).toBe('keyExchange');
    });

    it('has all required phases', () => {
      expect(CryptoWarGame.phases?.keyExchange).toBeDefined();
      expect(CryptoWarGame.phases?.encrypt).toBeDefined();
      expect(CryptoWarGame.phases?.shuffle).toBeDefined();
      expect(CryptoWarGame.phases?.play).toBeDefined();
    });

    it('has all required moves in play phase', () => {
      const playMoves = CryptoWarGame.phases?.play?.moves;
      expect(playMoves?.flipCard).toBeDefined();
      expect(playMoves?.submitDecryptionShare).toBeDefined();
      expect(playMoves?.resolveRound).toBeDefined();
    });
  });

  describe('Full Game Flow', () => {
    it('completes crypto setup phases correctly', async () => {
      // Phase 1: Key Exchange
      expect(state.phase).toBe('keyExchange');
      submitPublicKey(state, ctx, 'playerA', playerA.keyPair.publicKey);
      submitPublicKey(state, ctx, 'playerB', playerB.keyPair.publicKey);

      // Phase 2: Encryption
      expect(state.phase).toBe('encrypt');
      encryptDeck(state, ctx, 'playerA', playerA.keyPair.privateKey);
      encryptDeck(state, ctx, 'playerB', playerB.keyPair.privateKey);

      // Phase 3: Shuffle
      expect(state.phase).toBe('shuffle');
      await shuffleDeck(state, ctx, 'playerA', playerA.keyPair.privateKey);
      await shuffleDeck(state, ctx, 'playerB', playerB.keyPair.privateKey);

      // Phase 4: Ready to play
      expect(state.phase).toBe('flip');

      // Verify crypto state
      expect(state.crypto.encryptedZones['deck_playerA']).toBeDefined();
      expect(state.crypto.encryptedZones['deck_playerB']).toBeDefined();
    });
  });
});
