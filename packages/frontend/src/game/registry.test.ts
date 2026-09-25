import { expect, expectTypeOf, it } from 'vitest';
import type { Game } from 'boardgame.io';
import { PokerGame, CryptoPokerGame, type PokerState, type CryptoPokerState } from '@manamesh/poker';
import { MerkleBattleshipBoard, MerkleBattleshipGame } from '@manamesh/game-battleship-merkle';
import { defineGame, getGameById } from './registry';

it('preserves distinct ordinary and encrypted Poker state types', () => {
  const poker = getGameById('poker');
  expect(poker?.id).toBe('poker');
  if (!poker || poker.id !== 'poker') throw new Error('Poker registration missing');
  expect(poker.getGame()).toBe(PokerGame);
  expect(poker.getCryptoGame?.()).toBe(CryptoPokerGame);
  expectTypeOf(poker.getGame()).toEqualTypeOf<Game<PokerState>>();
  expectTypeOf(poker.getCryptoGame!()).toEqualTypeOf<Game<CryptoPokerState>>();
});
it('retains the Battleship board and its game as one typed registration', () => {
  const battleship = getGameById('merkle-battleship');
  if (!battleship || battleship.id !== 'merkle-battleship') throw new Error('Battleship registration missing');
  expect(battleship.getGame()).toBe(MerkleBattleshipGame);
  expect(battleship.BoardComponent).toBe(MerkleBattleshipBoard);
});

// Compile-time regression: unrelated boards must not be admitted as unknown state.
defineGame<'typecheck-only', { count: number }>({
  id: 'typecheck-only', name: 'Test', description: '', minPlayers: 2, maxPlayers: 2,
  getGame: () => ({ setup: () => ({ count: 0 }) }),
  // @ts-expect-error A board requiring label cannot consume a count-based game state.
  BoardComponent: (_props: { G: { label: string } }) => null,
});
