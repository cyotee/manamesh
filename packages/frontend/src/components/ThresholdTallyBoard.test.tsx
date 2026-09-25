import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Client } from 'boardgame.io/react';
import { describe, expect, it } from 'vitest';
import { elgamalEncryptExp, secpBaseMulHex } from '@cyotee/boardgameio-crypto';
import { createInitialState } from '../game/modules/threshold-tally/logic';
import { ThresholdTallyBoard } from './ThresholdTallyBoard';

describe('ThresholdTallyBoard', () => {
  it('renders both points of a submitted ciphertext without treating it as a string', () => {
    const state = createInitialState(['0', '1', '2']);
    state.phase = 'commit';
    state.crypto.publicKeyHex = secpBaseMulHex(7n);
    const ciphertext = elgamalEncryptExp(state.crypto.publicKeyHex, 3n, 11n);
    state.roundState.ciphertextByPlayer['0'] = ciphertext;
    const BoardClient = Client({
      game: { name: 'tally-render-fixture', setup: () => state },
      board: ThresholdTallyBoard,
      debug: false,
    });
    const html = renderToStaticMarkup(<BoardClient playerID="0" />);
    expect(html).toContain(ciphertext.c1Hex.slice(0, 20));
    expect(html).toContain(ciphertext.c2Hex.slice(0, 20));
    expect(html).toContain('submitted');
  });
});
