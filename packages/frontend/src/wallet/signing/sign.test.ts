/**
 * Tests for EIP-712 Signing Utilities
 *
 * Note: These tests focus on action data creation and type schemas.
 * Hook tests require React context and are covered by integration tests.
 */

import { describe, it, expect } from 'vitest';
// Import types directly to avoid wagmi dependency issues in tests
import { getTypesForAction } from './types';
import { MANAMESH_DOMAIN } from './domain';

describe('EIP-712 Signing', () => {
  describe('Domain', () => {
    it('has correct domain name', () => {
      expect(MANAMESH_DOMAIN.name).toBe('ManaMesh');
    });

    it('has correct version', () => {
      expect(MANAMESH_DOMAIN.version).toBe('1');
    });

    it('is chain-agnostic (no chainId)', () => {
      expect(MANAMESH_DOMAIN.chainId).toBeUndefined();
    });
  });

  describe('Action Type Schemas', () => {
    it('gets GameAction types', () => {
      const types = getTypesForAction('GameAction');
      expect(types.GameAction).toBeDefined();
      expect(types.GameAction.length).toBe(6);
    });

    it('gets JoinGame types', () => {
      const types = getTypesForAction('JoinGame');
      expect(types.JoinGame).toBeDefined();
      expect(types.JoinGame.length).toBe(4);
    });

    it('gets CommitShuffle types', () => {
      const types = getTypesForAction('CommitShuffle');
      expect(types.CommitShuffle).toBeDefined();
      expect(types.CommitShuffle.length).toBe(6);
    });

    it('gets RevealCard types', () => {
      const types = getTypesForAction('RevealCard');
      expect(types.RevealCard).toBeDefined();
      expect(types.RevealCard.length).toBe(6);
    });

    it('gets SubmitResult types', () => {
      const types = getTypesForAction('SubmitResult');
      expect(types.SubmitResult).toBeDefined();
      expect(types.SubmitResult.length).toBe(5);
    });

    it('throws for unknown action type', () => {
      expect(() => getTypesForAction('UnknownAction' as any)).toThrow();
    });
  });

  describe('Action Data Structure', () => {
    it('JoinGame schema has correct fields', () => {
      const types = getTypesForAction('JoinGame');
      const fields = types.JoinGame.map((f) => f.name);

      expect(fields).toContain('gameId');
      expect(fields).toContain('playerId');
      expect(fields).toContain('publicKey');
      expect(fields).toContain('timestamp');
    });

    it('CommitShuffle schema has correct fields', () => {
      const types = getTypesForAction('CommitShuffle');
      const fields = types.CommitShuffle.map((f) => f.name);

      expect(fields).toContain('gameId');
      expect(fields).toContain('playerId');
      expect(fields).toContain('shuffleIndex');
      expect(fields).toContain('commitment');
      expect(fields).toContain('proof');
      expect(fields).toContain('timestamp');
    });

    it('RevealCard schema has correct fields', () => {
      const types = getTypesForAction('RevealCard');
      const fields = types.RevealCard.map((f) => f.name);

      expect(fields).toContain('gameId');
      expect(fields).toContain('playerId');
      expect(fields).toContain('cardIndex');
      expect(fields).toContain('cardId');
      expect(fields).toContain('decryptionShare');
      expect(fields).toContain('timestamp');
    });

    it('SubmitResult schema has correct fields', () => {
      const types = getTypesForAction('SubmitResult');
      const fields = types.SubmitResult.map((f) => f.name);

      expect(fields).toContain('gameId');
      expect(fields).toContain('winnerId');
      expect(fields).toContain('resultHash');
      expect(fields).toContain('payouts');
      expect(fields).toContain('timestamp');
    });
  });
});
