import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type * as Harness from './history-signing-harness';
declare global { interface Window { historySigningHarness: typeof Harness } }
test.use({ trace: 'off' });
if (process.env.CI && !process.env.POKER_SHUFFLE_WASM) throw new Error('Controller checks require pinned WASM');
test.skip(!process.env.POKER_SHUFFLE_WASM, 'Requires the pinned local candidate');

for (const [seats, finish] of [[2, 'showdown'], [5, 'showdown'], [2, 'uncontested'], [2, 'cancel']] as const) {
  test(`${seats}-seat table UI dispatches ${finish} without automatic signatures`, async ({ browser }) => {
    test.setTimeout(300_000);
    const contexts = await Promise.all(Array.from({ length: seats }, () => browser.newContext()));
    try {
      const pages = await Promise.all(contexts.map(context => context.newPage()));
      await Promise.all(pages.map(async page => {
        page.setDefaultTimeout(30_000); await page.goto('/e2e/history-signing.html');
        await page.waitForFunction(() => Boolean(window.historySigningHarness));
      }));
      const walletKeys = pages.map(() => generatePrivateKey());
      const wallets = walletKeys.map(key => privateKeyToAccount(key).address);
      const participants = await Promise.all(pages.map((page, seat) => page.evaluate(wallet => window.historySigningHarness.createLocalPokerParticipant(wallet), wallets[seat])));
      const domain = { chainId: 31337, settler: privateKeyToAccount(generatePrivateKey()).address };
      const wire = await pages[0].evaluate(input => window.historySigningHarness.makePokerInvitation(input), { ...domain, dealer: 0, smallBlind: 1, bigBlind: 2, seats: participants.map(participant => ({ ...participant, stack: 100 })) });
      for (let seat = 1; seat < seats; seat++) {
        const offer = await pages[0].evaluate(seat => window.historySigningHarness.createHistoryPeerOffer(seat), seat);
        const answer = await pages[seat].evaluate(offer => window.historySigningHarness.acceptHistoryPeerOffer(offer), offer);
        await pages[0].evaluate(({ seat, answer }) => window.historySigningHarness.finishHistoryPeerAnswer(seat, answer), { seat, answer });
      }
      await Promise.all(pages.map(page => page.waitForFunction(() => window.historySigningHarness.allHistoryPeerConnectionsOpen())));
      await Promise.all(pages.map((page, seat) => page.evaluate(input => window.historySigningHarness.startInvitationBootstrap(input), { wire, wallets, ...domain, walletKey: walletKeys[seat] })));
      await Promise.all(pages.map(page => page.waitForFunction(() => window.historySigningHarness.enrollmentBootstrapStatus().ready)));
      for (let seat = 0; seat < seats; seat++) {
        await pages[seat].evaluate(() => window.historySigningHarness.approveEnrollmentBootstrap());
        await Promise.all(pages.map(page => page.waitForFunction(seat => !window.historySigningHarness.enrollmentBootstrapStatus().missing.includes(seat), seat)));
      }
      await Promise.all(pages.map(page => page.evaluate(() => window.historySigningHarness.openInvitationHistory())));
      const wasm = [...readFileSync(process.env.POKER_SHUFFLE_WASM!)];
      await Promise.all(pages.map(page => page.evaluate(wasm => window.historySigningHarness.startProtectedPoker(wasm), wasm)));
      await Promise.all(pages.map(page => page.evaluate(() => window.historySigningHarness.startProtectedHandController())));
      await Promise.all(pages.map(page => page.evaluate(() => window.historySigningHarness.mountProtectedTable())));
      const waitStage = async (stage: string) => Promise.all(pages.map(page => page.waitForFunction(stage => window.historySigningHarness.protectedHandStatus()?.stage === stage, stage)));
      await waitStage('rosterApproval');
      for (const page of pages) expect(await page.evaluate(() => window.historySigningHarness.signCount())).toBe(0);
      if (finish === 'cancel') {
        await pages[1].getByRole('button', { name: 'Leave table', exact: true }).click();
        await waitStage('closed');
        for (const page of pages) {
          expect(await page.evaluate(() => window.historySigningHarness.localHistoryClosed())).toBe(true);
          expect(await page.evaluate(() => window.historySigningHarness.signCount())).toBe(0);
        }
        return;
      }
      for (const [kind, next] of [['roster', 'deckApproval'], ['deck', 'dealApproval'], ['deal', 'actionReady']] as const) {
        for (let seat = 0; seat < seats; seat++) {
          const button = pages[seat].getByRole('button', { name: `Approve ${{ roster: 'encryption roster', deck: 'encrypted deck', deal: 'private deal' }[kind]}`, exact: true });
          await expect(button).toBeDisabled();
          await pages[seat].getByLabel('Review protocol approval', { exact: true }).check();
          await button.click();
        }
        await waitStage(next);
        for (const page of pages) expect(await page.evaluate(() => window.historySigningHarness.signCount())).toBe({ roster: 1, deck: 2, deal: 3 }[kind]);
      }
      const localHands = await Promise.all(pages.map(page => page.evaluate(() => window.historySigningHarness.protectedHandStatus()!.privateCards)));
      for (const hand of localHands) expect(hand).toHaveLength(2);
      expect(new Set(localHands.flat().map(card => card.card)).size).toBe(seats * 2);

      async function commit(actor: number, payload: string) {
        const sequence = (await pages[0].evaluate(() => window.historySigningHarness.checkpoint())).sequence + 1;
        await pages[actor].waitForFunction(() => window.historySigningHarness.tableGameplayStatus().canPropose);
        const move = JSON.parse(payload).move;
        const label = ['beginBetting', 'revealFlop', 'revealTurn', 'revealRiver', 'finishShowdown', 'finishUncontested'].includes(move) ? 'Propose table transition' : `Propose ${move}`;
        await pages[actor].getByRole('button', { name: label, exact: true }).click();
        await Promise.all(pages.map(page => page.waitForFunction(() => window.historySigningHarness.tableGameplayStatus().ready)));
        for (const page of pages) {
          const approve = page.getByRole('button', { name: 'Approve proposed action', exact: true });
          await expect(approve).toBeDisabled();
          await page.getByLabel('Review proposed action', { exact: true }).check();
          await approve.click();
        }
        await pages[0].waitForFunction(() => window.historySigningHarness.tableGameplayStatus().missing.length === 0);
        await pages[0].getByRole('button', { name: 'Commit approved action', exact: true }).click();
        await Promise.all(pages.map(page => page.waitForFunction(sequence => window.historySigningHarness.checkpoint().sequence === sequence, sequence)));
        const heads = await Promise.all(pages.map(page => page.evaluate(() => window.historySigningHarness.checkpoint().head)));
        expect(new Set(heads).size).toBe(1);
      }
      for (let transition = 0; transition < 40; transition++) {
        const state = JSON.parse((await pages[0].evaluate(() => window.historySigningHarness.checkpoint())).stateJSON);
        if (state.phase === 'complete') break;
        if (state.phase === 'awaitingDeal' || state.betting.round.isComplete) {
          const before = await Promise.all(pages.map(page => page.evaluate(() => window.historySigningHarness.signCount())));
          await waitStage('actionReady');
          const suggestions = await Promise.all(pages.map(page => page.evaluate(() => window.historySigningHarness.protectedHandStatus()!.action!)));
          for (const [seat, suggestion] of suggestions.entries()) {
            expect(suggestion).toEqual(suggestions[0]);
            expect(await pages[seat].evaluate(() => window.historySigningHarness.signCount())).toBe(before[seat]);
          }
          await commit(suggestions[0].actor, suggestions[0].payloadJSON);
        } else {
          const actor = state.betting.round.activeSeat;
          const move = finish === 'uncontested' ? 'fold' : state.betting.players[actor].bet < state.betting.round.currentBet ? 'call' : 'check';
          await commit(actor, JSON.stringify({ move }));
        }
      }
      await waitStage('complete');
      const result = JSON.parse((await pages[0].evaluate(() => window.historySigningHarness.checkpoint())).stateJSON);
      expect(result.result.reason).toBe(finish);
      expect(result.betting.players.reduce((sum: number, player: { chips: number }) => sum + player.chips, 0)).toBe(seats * 100);
      if (finish === 'uncontested') expect(result.community).toEqual([]);
      await pages[0].getByRole('button', { name: 'Leave table', exact: true }).click();
      await waitStage('closed');
    } finally { await Promise.all(contexts.map(context => context.close())); }
  });
}
