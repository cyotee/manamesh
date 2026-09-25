import { expect, it } from 'vitest';
import { createOnePieceShuffleSeed } from './onepiece-shuffle-seed';
import { createCryptoInitialState, commitShuffleSeed, revealShuffleSeed } from '@manamesh/onepiece/crypto';
import { InitializeGame } from 'boardgame.io/internal';

it('generates independent random seeds accepted by the game commit/reveal verifier', () => {
  const state = createCryptoInitialState({ numPlayers: 2, playerIDs: ['0', '1'] });
  state.phase = 'shuffle';
  const ctx = InitializeGame({ game: { setup: () => ({}) }, numPlayers: 2 }).ctx;
  const seeds = [createOnePieceShuffleSeed(), createOnePieceShuffleSeed()];
  expect(seeds[0].seedHex).toMatch(/^[0-9a-f]{64}$/);
  expect(seeds[0].seedHex).not.toBe(seeds[1].seedHex);
  expect(seeds[0].commitHashHex).not.toBe(seeds[0].seedHex);
  for (const id of ['0', '1']) {
    expect(commitShuffleSeed(state, ctx, id, seeds[Number(id)].commitHashHex, id)).toBe(state);
  }
  for (const id of ['0', '1']) {
    expect(revealShuffleSeed(state, ctx, id, seeds[Number(id)].seedHex, id)).toBe(state);
  }
  expect(state.shuffleRng?.phase).toBe('ready');
});
