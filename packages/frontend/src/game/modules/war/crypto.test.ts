import { describe, expect, it, beforeEach } from 'vitest';
import type { Ctx } from 'boardgame.io';
import {
  CryptoWarGame,
  CryptoWarState,
  createCryptoWarState,
  submitPublicKey,
  distributeKeyShares,
  encryptDeck,
  shuffleDeck,
  flipCard,
  submitDecryptionShare,
  resolveRound,
  requestDecrypt,
  approveDecrypt,
  releaseKey,
  surrender,
  allKeysSubmitted,
  allPlayersEncrypted,
  allPlayersShuffled,
  parseCardId,
  createCardIds,
  getShuffleProofs,
  verifyPlayerShuffle,
  checkGameViability,
} from './crypto';
import { createPlayerCryptoContext, type CryptoPlayerContext } from '../../../crypto';
import { createKeyShares } from '../../../crypto/shamirs';

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
      expect(state.players.playerA.hasDistributedShares).toBe(false);
      expect(state.players.playerA.isConnected).toBe(true);
    });

    it('initializes crypto plugin state', () => {
      expect(state.crypto).toBeDefined();
      expect(state.crypto.phase).toBe('init');
    });

    it('initializes abandonment support fields', () => {
      expect(state.releasedKeys).toEqual({});
      expect(state.keyEscrowShares).toEqual({});
      expect(state.escrowThreshold).toBeGreaterThanOrEqual(1);
      expect(state.disconnectedPlayers).toEqual([]);
    });

    it('initializes cooperative decryption fields', () => {
      expect(state.decryptRequests).toEqual([]);
      expect(state.decryptNotifications).toEqual([]);
      expect(state.revealNotifications).toEqual([]);
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

    it('transitions to keyEscrow phase when all keys submitted', () => {
      submitPublicKey(state, ctx, 'playerA', playerA.keyPair.publicKey);
      expect(state.phase).toBe('keyExchange');

      submitPublicKey(state, ctx, 'playerB', playerB.keyPair.publicKey);
      expect(state.phase).toBe('keyEscrow');
    });

    it('tracks all keys submitted correctly', () => {
      expect(allKeysSubmitted(state)).toBe(false);

      submitPublicKey(state, ctx, 'playerA', playerA.keyPair.publicKey);
      expect(allKeysSubmitted(state)).toBe(false);

      submitPublicKey(state, ctx, 'playerB', playerB.keyPair.publicKey);
      expect(allKeysSubmitted(state)).toBe(true);
    });

    it('stores public keys in crypto state', () => {
      submitPublicKey(state, ctx, 'playerA', playerA.keyPair.publicKey);
      submitPublicKey(state, ctx, 'playerB', playerB.keyPair.publicKey);

      expect(state.crypto.publicKeys['playerA']).toBe(playerA.keyPair.publicKey);
      expect(state.crypto.publicKeys['playerB']).toBe(playerB.keyPair.publicKey);
    });

    it('builds card point lookup after all keys submitted', () => {
      submitPublicKey(state, ctx, 'playerA', playerA.keyPair.publicKey);
      submitPublicKey(state, ctx, 'playerB', playerB.keyPair.publicKey);

      expect(Object.keys(state.crypto.cardPointLookup)).toHaveLength(52);
    });
  });

  describe('Key Escrow Phase', () => {
    beforeEach(() => {
      // Complete key exchange
      submitPublicKey(state, ctx, 'playerA', playerA.keyPair.publicKey);
      submitPublicKey(state, ctx, 'playerB', playerB.keyPair.publicKey);
    });

    it('starts in keyEscrow phase after key exchange', () => {
      expect(state.phase).toBe('keyEscrow');
    });

    it('allows players to distribute key shares', () => {
      const shares = createKeyShares(playerA.keyPair.privateKey, 'playerA', ['playerB'], state.escrowThreshold);
      const result = distributeKeyShares(state, ctx, 'playerA', playerA.keyPair.privateKey, shares);
      expect(result).not.toBe('INVALID_MOVE');

      const newState = result as CryptoWarState;
      expect(newState.players.playerA.hasDistributedShares).toBe(true);
    });

    it('stores private keys in demo mode', () => {
      const sharesA = createKeyShares(playerA.keyPair.privateKey, 'playerA', ['playerB'], state.escrowThreshold);
      distributeKeyShares(state, ctx, 'playerA', playerA.keyPair.privateKey, sharesA);

      expect(state.crypto.privateKeys?.['playerA']).toBe(playerA.keyPair.privateKey);
    });

    it('transitions to encrypt phase when all shares distributed', () => {
      const sharesA = createKeyShares(playerA.keyPair.privateKey, 'playerA', ['playerB'], state.escrowThreshold);
      const sharesB = createKeyShares(playerB.keyPair.privateKey, 'playerB', ['playerA'], state.escrowThreshold);

      distributeKeyShares(state, ctx, 'playerA', playerA.keyPair.privateKey, sharesA);
      expect(state.phase).toBe('keyEscrow');

      distributeKeyShares(state, ctx, 'playerB', playerB.keyPair.privateKey, sharesB);
      expect(state.phase).toBe('encrypt');
    });

    it('rejects duplicate share distribution', () => {
      const shares = createKeyShares(playerA.keyPair.privateKey, 'playerA', ['playerB'], state.escrowThreshold);
      distributeKeyShares(state, ctx, 'playerA', playerA.keyPair.privateKey, shares);
      const result = distributeKeyShares(state, ctx, 'playerA', playerA.keyPair.privateKey, shares);
      expect(result).toBe('INVALID_MOVE');
    });
  });

  describe('Encryption Phase', () => {
    beforeEach(() => {
      // Complete key exchange and key escrow
      submitPublicKey(state, ctx, 'playerA', playerA.keyPair.publicKey);
      submitPublicKey(state, ctx, 'playerB', playerB.keyPair.publicKey);

      const sharesA = createKeyShares(playerA.keyPair.privateKey, 'playerA', ['playerB'], state.escrowThreshold);
      const sharesB = createKeyShares(playerB.keyPair.privateKey, 'playerB', ['playerA'], state.escrowThreshold);
      distributeKeyShares(state, ctx, 'playerA', playerA.keyPair.privateKey, sharesA);
      distributeKeyShares(state, ctx, 'playerB', playerB.keyPair.privateKey, sharesB);
    });

    it('starts in encrypt phase after key escrow', () => {
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

    it('creates encrypted deck in crypto state', () => {
      encryptDeck(state, ctx, 'playerA', playerA.keyPair.privateKey);
      expect(state.crypto.encryptedZones['deck']).toBeDefined();
      expect(state.crypto.encryptedZones['deck']).toHaveLength(52);
    });

    it('adds encryption layers', () => {
      encryptDeck(state, ctx, 'playerA', playerA.keyPair.privateKey);
      expect(state.crypto.encryptedZones['deck'][0].layers).toBe(1);

      encryptDeck(state, ctx, 'playerB', playerB.keyPair.privateKey);
      expect(state.crypto.encryptedZones['deck'][0].layers).toBe(2);
    });
  });

  describe('Shuffle Phase', () => {
    beforeEach(() => {
      // Complete key exchange, key escrow, and encryption
      submitPublicKey(state, ctx, 'playerA', playerA.keyPair.publicKey);
      submitPublicKey(state, ctx, 'playerB', playerB.keyPair.publicKey);

      const sharesA = createKeyShares(playerA.keyPair.privateKey, 'playerA', ['playerB'], state.escrowThreshold);
      const sharesB = createKeyShares(playerB.keyPair.privateKey, 'playerB', ['playerA'], state.escrowThreshold);
      distributeKeyShares(state, ctx, 'playerA', playerA.keyPair.privateKey, sharesA);
      distributeKeyShares(state, ctx, 'playerB', playerB.keyPair.privateKey, sharesB);

      encryptDeck(state, ctx, 'playerA', playerA.keyPair.privateKey);
      encryptDeck(state, ctx, 'playerB', playerB.keyPair.privateKey);
    });

    it('starts in shuffle phase after encryption', () => {
      expect(state.phase).toBe('shuffle');
    });

    it('allows first player to shuffle deck', () => {
      const result = shuffleDeck(state, ctx, 'playerA', playerA.keyPair.privateKey);
      expect(result).not.toBe('INVALID_MOVE');

      const newState = result as CryptoWarState;
      expect(newState.players.playerA.hasShuffled).toBe(true);
    });

    it('requires sequential shuffle order', () => {
      // Player B can't shuffle before player A
      const result = shuffleDeck(state, ctx, 'playerB', playerB.keyPair.privateKey);
      expect(result).toBe('INVALID_MOVE');
    });

    it('transitions to flip phase when all shuffled', () => {
      shuffleDeck(state, ctx, 'playerA', playerA.keyPair.privateKey);
      expect(state.phase).toBe('shuffle');

      shuffleDeck(state, ctx, 'playerB', playerB.keyPair.privateKey);
      expect(state.phase).toBe('flip');
    });

    it('tracks all players shuffled correctly', () => {
      expect(allPlayersShuffled(state)).toBe(false);

      shuffleDeck(state, ctx, 'playerA', playerA.keyPair.privateKey);
      expect(allPlayersShuffled(state)).toBe(false);

      shuffleDeck(state, ctx, 'playerB', playerB.keyPair.privateKey);
      expect(allPlayersShuffled(state)).toBe(true);
    });
  });

  describe('Cooperative Decryption', () => {
    beforeEach(() => {
      // Complete full setup to get to play phase
      submitPublicKey(state, ctx, 'playerA', playerA.keyPair.publicKey);
      submitPublicKey(state, ctx, 'playerB', playerB.keyPair.publicKey);

      const sharesA = createKeyShares(playerA.keyPair.privateKey, 'playerA', ['playerB'], state.escrowThreshold);
      const sharesB = createKeyShares(playerB.keyPair.privateKey, 'playerB', ['playerA'], state.escrowThreshold);
      distributeKeyShares(state, ctx, 'playerA', playerA.keyPair.privateKey, sharesA);
      distributeKeyShares(state, ctx, 'playerB', playerB.keyPair.privateKey, sharesB);

      encryptDeck(state, ctx, 'playerA', playerA.keyPair.privateKey);
      encryptDeck(state, ctx, 'playerB', playerB.keyPair.privateKey);

      shuffleDeck(state, ctx, 'playerA', playerA.keyPair.privateKey);
      shuffleDeck(state, ctx, 'playerB', playerB.keyPair.privateKey);
    });

    it('allows players to request decryption', () => {
      const result = requestDecrypt(state, ctx, 'playerA', 'deck_playerA', [0]);
      expect(result).not.toBe('INVALID_MOVE');

      expect(state.decryptRequests).toHaveLength(1);
      expect(state.decryptRequests[0].requestingPlayer).toBe('playerA');
    });

    it('auto-approves for requesting player', () => {
      requestDecrypt(state, ctx, 'playerA', 'deck_playerA', [0]);

      expect(state.decryptRequests[0].approvals['playerA']).toBe(true);
      expect(state.decryptRequests[0].approvals['playerB']).toBe(false);
    });

    it('creates notification on request', () => {
      requestDecrypt(state, ctx, 'playerA', 'deck_playerA', [0]);

      expect(state.decryptNotifications).toHaveLength(1);
      expect(state.decryptNotifications[0].type).toBe('request');
    });

    it('allows other player to approve', () => {
      requestDecrypt(state, ctx, 'playerA', 'deck_playerA', [0]);
      const requestId = state.decryptRequests[0].id;

      const result = approveDecrypt(state, ctx, 'playerB', requestId, playerB.keyPair.privateKey);
      expect(result).not.toBe('INVALID_MOVE');

      expect(state.decryptRequests[0].approvals['playerB']).toBe(true);
    });

    it('completes decryption when all approve', () => {
      requestDecrypt(state, ctx, 'playerA', 'deck_playerA', [0]);
      const requestId = state.decryptRequests[0].id;

      // Submit requesting player's key as part of approval
      approveDecrypt(state, ctx, 'playerA', requestId, playerA.keyPair.privateKey);
      approveDecrypt(state, ctx, 'playerB', requestId, playerB.keyPair.privateKey);

      expect(state.decryptRequests[0].status).toBe('completed');
    });
  });

  describe('Abandonment Support', () => {
    beforeEach(() => {
      // Complete full setup
      submitPublicKey(state, ctx, 'playerA', playerA.keyPair.publicKey);
      submitPublicKey(state, ctx, 'playerB', playerB.keyPair.publicKey);

      const sharesA = createKeyShares(playerA.keyPair.privateKey, 'playerA', ['playerB'], state.escrowThreshold);
      const sharesB = createKeyShares(playerB.keyPair.privateKey, 'playerB', ['playerA'], state.escrowThreshold);
      distributeKeyShares(state, ctx, 'playerA', playerA.keyPair.privateKey, sharesA);
      distributeKeyShares(state, ctx, 'playerB', playerB.keyPair.privateKey, sharesB);

      encryptDeck(state, ctx, 'playerA', playerA.keyPair.privateKey);
      encryptDeck(state, ctx, 'playerB', playerB.keyPair.privateKey);

      shuffleDeck(state, ctx, 'playerA', playerA.keyPair.privateKey);
      shuffleDeck(state, ctx, 'playerB', playerB.keyPair.privateKey);
    });

    it('allows players to release their key', () => {
      const result = releaseKey(state, ctx, 'playerA', playerA.keyPair.privateKey);
      expect(result).not.toBe('INVALID_MOVE');

      expect(state.releasedKeys['playerA']).toBe(playerA.keyPair.privateKey);
      expect(state.players.playerA.hasReleasedKey).toBe(true);
    });

    it('rejects duplicate key release', () => {
      releaseKey(state, ctx, 'playerA', playerA.keyPair.privateKey);
      const result = releaseKey(state, ctx, 'playerA', playerA.keyPair.privateKey);
      expect(result).toBe('INVALID_MOVE');
    });

    it('allows player to surrender', () => {
      const result = surrender(state, ctx, 'playerA', playerA.keyPair.privateKey);
      expect(result).not.toBe('INVALID_MOVE');

      expect(state.winner).toBe('playerB');
      expect(state.phase).toBe('gameOver');
      expect(state.releasedKeys['playerA']).toBe(playerA.keyPair.privateKey);
    });

    it('checkGameViability returns continue when all keys available', () => {
      expect(checkGameViability(state)).toBe('continue');
    });
  });

  describe('CryptoWarGame boardgame.io integration', () => {
    it('has correct game name', () => {
      expect(CryptoWarGame.name).toBe('crypto-war');
    });

    it('has setup as starting phase', () => {
      expect(CryptoWarGame.phases?.setup?.start).toBe(true);
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

    it('has setup and play phases', () => {
      expect(CryptoWarGame.phases?.setup).toBeDefined();
      expect(CryptoWarGame.phases?.play).toBeDefined();
    });

    it('has all required moves in setup phase', () => {
      const setupMoves = CryptoWarGame.phases?.setup?.moves;
      expect(setupMoves?.submitPublicKey).toBeDefined();
      expect(setupMoves?.distributeKeyShares).toBeDefined();
      expect(setupMoves?.encryptDeck).toBeDefined();
      expect(setupMoves?.shuffleDeck).toBeDefined();
    });

    it('has all required moves in play phase', () => {
      const playMoves = CryptoWarGame.phases?.play?.moves;
      expect(playMoves?.flipCard).toBeDefined();
      expect(playMoves?.submitDecryptionShare).toBeDefined();
      expect(playMoves?.resolveRound).toBeDefined();
      expect(playMoves?.requestDecrypt).toBeDefined();
      expect(playMoves?.approveDecrypt).toBeDefined();
      expect(playMoves?.releaseKey).toBeDefined();
      expect(playMoves?.surrender).toBeDefined();
    });
  });

  describe('Full Game Flow', () => {
    it('completes crypto setup phases correctly', () => {
      // Phase 1: Key Exchange
      expect(state.phase).toBe('keyExchange');
      submitPublicKey(state, ctx, 'playerA', playerA.keyPair.publicKey);
      submitPublicKey(state, ctx, 'playerB', playerB.keyPair.publicKey);

      // Phase 2: Key Escrow
      expect(state.phase).toBe('keyEscrow');
      const sharesA = createKeyShares(playerA.keyPair.privateKey, 'playerA', ['playerB'], state.escrowThreshold);
      const sharesB = createKeyShares(playerB.keyPair.privateKey, 'playerB', ['playerA'], state.escrowThreshold);
      distributeKeyShares(state, ctx, 'playerA', playerA.keyPair.privateKey, sharesA);
      distributeKeyShares(state, ctx, 'playerB', playerB.keyPair.privateKey, sharesB);

      // Phase 3: Encryption
      expect(state.phase).toBe('encrypt');
      encryptDeck(state, ctx, 'playerA', playerA.keyPair.privateKey);
      encryptDeck(state, ctx, 'playerB', playerB.keyPair.privateKey);

      // Phase 4: Shuffle
      expect(state.phase).toBe('shuffle');
      shuffleDeck(state, ctx, 'playerA', playerA.keyPair.privateKey);
      shuffleDeck(state, ctx, 'playerB', playerB.keyPair.privateKey);

      // Phase 5: Ready to play
      expect(state.phase).toBe('flip');

      // Verify crypto state
      expect(state.crypto.encryptedZones['deck_playerA']).toBeDefined();
      expect(state.crypto.encryptedZones['deck_playerB']).toBeDefined();
    });
  });
});
