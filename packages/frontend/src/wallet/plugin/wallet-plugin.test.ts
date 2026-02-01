/**
 * Tests for Wallet Plugin
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  WalletPlugin,
  hasWalletState,
  initWalletState,
  type WalletPluginGameState,
} from './wallet-plugin';

describe('WalletPlugin', () => {
  describe('setup', () => {
    it('returns initial state with empty collections', () => {
      const state = WalletPlugin.setup();

      expect(state.playerAddresses).toEqual({});
      expect(state.playerPublicKeys).toEqual({});
      expect(state.actionSignatures).toEqual([]);
      expect(state.verificationCache).toEqual({});
    });
  });

  describe('api', () => {
    let gameState: WalletPluginGameState;
    let api: ReturnType<typeof WalletPlugin.api>;

    beforeEach(() => {
      gameState = {
        wallet: WalletPlugin.setup(),
      };

      api = WalletPlugin.api({
        G: gameState,
        ctx: { currentPlayer: '0', numPlayers: 2 } as any,
        data: gameState.wallet,
      });
    });

    describe('registerPlayer', () => {
      it('registers player address and public key', () => {
        api.registerPlayer('0', '0x1234567890AbCdEf', 'pubkey123');

        expect(api.getPlayerAddress('0')).toBe('0x1234567890abcdef');
        expect(api.getPlayerPublicKey('0')).toBe('pubkey123');
      });

      it('normalizes address to lowercase', () => {
        api.registerPlayer('0', '0xABCDEF', 'pubkey');

        expect(api.getPlayerAddress('0')).toBe('0xabcdef');
      });

      it('allows registering multiple players', () => {
        api.registerPlayer('0', '0xaaa', 'pubkey0');
        api.registerPlayer('1', '0xbbb', 'pubkey1');

        expect(api.getRegisteredPlayerCount()).toBe(2);
        expect(api.getPlayerAddress('0')).toBe('0xaaa');
        expect(api.getPlayerAddress('1')).toBe('0xbbb');
      });
    });

    describe('getPlayerAddress', () => {
      it('returns null for unregistered player', () => {
        expect(api.getPlayerAddress('nonexistent')).toBeNull();
      });

      it('returns address for registered player', () => {
        api.registerPlayer('0', '0x123', 'key');
        expect(api.getPlayerAddress('0')).toBe('0x123');
      });
    });

    describe('getPlayerPublicKey', () => {
      it('returns null for unregistered player', () => {
        expect(api.getPlayerPublicKey('nonexistent')).toBeNull();
      });

      it('returns public key for registered player', () => {
        api.registerPlayer('0', '0x123', 'myPublicKey');
        expect(api.getPlayerPublicKey('0')).toBe('myPublicKey');
      });
    });

    describe('getAllPlayerAddresses', () => {
      it('returns empty object when no players', () => {
        expect(api.getAllPlayerAddresses()).toEqual({});
      });

      it('returns all registered addresses', () => {
        api.registerPlayer('0', '0xaaa', 'key0');
        api.registerPlayer('1', '0xbbb', 'key1');

        const addresses = api.getAllPlayerAddresses();
        expect(addresses).toEqual({
          '0': '0xaaa',
          '1': '0xbbb',
        });
      });

      it('returns a copy (not reference)', () => {
        api.registerPlayer('0', '0xaaa', 'key0');
        const addresses = api.getAllPlayerAddresses();
        addresses['0'] = '0xzzz';

        expect(api.getPlayerAddress('0')).toBe('0xaaa');
      });
    });

    describe('getPlayerByAddress', () => {
      it('returns null for unknown address', () => {
        expect(api.getPlayerByAddress('0xunknown')).toBeNull();
      });

      it('returns player ID for registered address', () => {
        api.registerPlayer('0', '0xaaa', 'key');
        expect(api.getPlayerByAddress('0xaaa')).toBe('0');
      });

      it('matches case-insensitively', () => {
        api.registerPlayer('0', '0xAAA', 'key');
        expect(api.getPlayerByAddress('0xaaa')).toBe('0');
        expect(api.getPlayerByAddress('0xAAA')).toBe('0');
      });
    });

    describe('allPlayersRegistered', () => {
      it('returns false when no players registered', () => {
        expect(api.allPlayersRegistered(['0', '1'])).toBe(false);
      });

      it('returns false when only some players registered', () => {
        api.registerPlayer('0', '0xaaa', 'key0');
        expect(api.allPlayersRegistered(['0', '1'])).toBe(false);
      });

      it('returns true when all players registered', () => {
        api.registerPlayer('0', '0xaaa', 'key0');
        api.registerPlayer('1', '0xbbb', 'key1');
        expect(api.allPlayersRegistered(['0', '1'])).toBe(true);
      });
    });

    describe('getRegisteredPlayerCount', () => {
      it('returns 0 initially', () => {
        expect(api.getRegisteredPlayerCount()).toBe(0);
      });

      it('returns correct count after registrations', () => {
        api.registerPlayer('0', '0xaaa', 'key0');
        expect(api.getRegisteredPlayerCount()).toBe(1);

        api.registerPlayer('1', '0xbbb', 'key1');
        expect(api.getRegisteredPlayerCount()).toBe(2);
      });
    });

    describe('reset', () => {
      it('clears all wallet state', () => {
        api.registerPlayer('0', '0xaaa', 'key0');
        api.registerPlayer('1', '0xbbb', 'key1');

        api.reset();

        expect(api.getRegisteredPlayerCount()).toBe(0);
        expect(api.getPlayerAddress('0')).toBeNull();
        expect(api.getPlayerAddress('1')).toBeNull();
      });
    });

    describe('getSignedActionsForPlayer', () => {
      it('returns empty array for unregistered player', () => {
        expect(api.getSignedActionsForPlayer('0')).toEqual([]);
      });

      it('returns empty array for player with no actions', () => {
        api.registerPlayer('0', '0xaaa', 'key');
        expect(api.getSignedActionsForPlayer('0')).toEqual([]);
      });
    });

    describe('getSignedActionsByType', () => {
      it('returns empty array when no actions', () => {
        expect(api.getSignedActionsByType('JoinGame')).toEqual([]);
      });
    });
  });

  describe('hasWalletState', () => {
    it('returns false for null', () => {
      expect(hasWalletState(null)).toBe(false);
    });

    it('returns false for non-object', () => {
      expect(hasWalletState('string')).toBe(false);
      expect(hasWalletState(123)).toBe(false);
    });

    it('returns false for object without wallet', () => {
      expect(hasWalletState({ other: 'data' })).toBe(false);
    });

    it('returns true for object with wallet', () => {
      const state = { wallet: WalletPlugin.setup() };
      expect(hasWalletState(state)).toBe(true);
    });
  });

  describe('initWalletState', () => {
    it('adds wallet state to existing object', () => {
      const original = { gameData: 'something' };
      const withWallet = initWalletState(original);

      expect(withWallet.gameData).toBe('something');
      expect(withWallet.wallet).toBeDefined();
      expect(withWallet.wallet.playerAddresses).toEqual({});
    });

    it('preserves original properties', () => {
      const original = { a: 1, b: 'two', c: [3] };
      const withWallet = initWalletState(original);

      expect(withWallet.a).toBe(1);
      expect(withWallet.b).toBe('two');
      expect(withWallet.c).toEqual([3]);
    });
  });
});
