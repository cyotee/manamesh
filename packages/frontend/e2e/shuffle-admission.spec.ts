import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type * as Harness from './history-signing-harness';
declare global { interface Window { historySigningHarness: typeof Harness } }
// The isolated candidate artifact is built by experiments/poker-shuffle/wasm/peers.
// It is deliberately not shipped as a production dependency or auto-downloaded.
test.use({ trace: 'off' });
if (process.env.CI && !process.env.POKER_SHUFFLE_WASM) throw new Error('CI shuffle admission checks require POKER_SHUFFLE_WASM');
test.skip(!process.env.POKER_SHUFFLE_WASM, 'Requires the pinned locally built candidate WASM');
for (const [scenario, seats] of [2, 3, 4, 5, 2, 3, 2, 2, 3, 3, 2, 2, 2, 2, 5, 3].entries()) {
  test(`${seats} admitted signing identities verify ${scenario >= 13 ? `autonomous cards and ${scenario === 15 ? 'folded-hand' : 'contested'} showdown` : scenario === 12 ? 'cancellation during worker startup' : scenario === 11 ? 'local shutdown during pending approval' : scenario === 10 ? 'tampered key announcement refusal' : scenario === 9 ? 'forged approval seat refusal' : scenario === 8 ? 'tampered private contribution refusal' : scenario === 7 ? 'tampered public contribution refusal' : scenario === 6 ? 'tampered peer shuffle refusal' : scenario === 4 ? 'uncontested completion' : scenario === 5 ? 'showdown with a folded hand' : 'contested showdown'}`, async ({ browser }) => {
    // Five independent workers verify every shuffle, card contribution and
    // signed transition. Bound individual browser waits separately from this
    // full-hand CPU budget; protocol/worker deadlines remain unchanged.
    test.setTimeout(seats === 5 ? 300_000 : 120_000);
    const started = Date.now();
    let stage = 'bootstrap';
    let bodyFailed = false;
    const contexts = await Promise.all(Array.from({ length: seats }, () => browser.newContext()));
    try {
      const pages = await Promise.all(contexts.map(context => context.newPage()));
      await Promise.all(pages.map(async page => {
        page.setDefaultTimeout(20_000);
        await page.goto('/e2e/history-signing.html');
        await page.waitForFunction(() => Boolean(window.historySigningHarness));
      }));
      async function deliverPublicContributions(position: number) {
        stage = `public-contributions:${position}`;
        await Promise.all(pages.map((page, seat) => page.evaluate(({ position, seat }) => window.historySigningHarness.preparePublicTableContribution(position, seat), { position, seat })));
        await expect(pages[0].evaluate(position => window.historySigningHarness.publicShuffleCommand('open', position), position)).rejects.toThrow('proof_or_phase');
        await Promise.all(pages.map((page, author) => page.evaluate(({ position, author }) => window.historySigningHarness.sendPublicTableContribution(position, author), { position, author })));
        await Promise.all(pages.flatMap(page => pages.map((_, author) => page.waitForFunction(({ position, author }) => window.historySigningHarness.hasPublicTableContribution(position, author), { position, author }))));
      }
      const keys = Array.from({ length: seats }, () => generatePrivateKey());
      const roster = keys.map(key => privateKeyToAccount(key).address);
      const walletKeys = keys.map(() => generatePrivateKey());
      const wallets = walletKeys.map(key => privateKeyToAccount(key));
      const inputs = keys.map((key, seat) => ({ key, seat, roster, wallets: wallets.map(wallet => wallet.address), mode: 'dealtBetting' as const, dealer: (seats + 1) % seats }));
      for (let seat = 1; seat < seats; seat++) {
        const offer = await pages[0].evaluate(seat => window.historySigningHarness.createHistoryPeerOffer(seat), seat);
        const answer = await pages[seat].evaluate(offer => window.historySigningHarness.acceptHistoryPeerOffer(offer), offer);
        await pages[0].evaluate(({ seat, answer }) => window.historySigningHarness.finishHistoryPeerAnswer(seat, answer), { seat, answer });
      }
      await Promise.all(pages.map(page => page.waitForFunction(() => window.historySigningHarness.allHistoryPeerConnectionsOpen())));
      await Promise.all(pages.map((page, seat) => page.evaluate(input => window.historySigningHarness.startEnrollmentBootstrap(input), { ...inputs[seat], walletKey: walletKeys[seat] })));
      await Promise.all(pages.map(page => page.waitForFunction(() => window.historySigningHarness.enrollmentBootstrapStatus().ready)));
      for (let seat = 0; seat < seats; seat++) {
        await pages[seat].evaluate(() => window.historySigningHarness.approveEnrollmentBootstrap());
        await Promise.all(pages.map(page => page.waitForFunction(seat => !window.historySigningHarness.enrollmentBootstrapStatus().missing.includes(seat), seat)));
      }
      await Promise.all(pages.map((page, seat) => page.evaluate(input => window.historySigningHarness.initializeArchivedFromBootstrap(input), inputs[seat])));
      const wasm = [...readFileSync(process.env.POKER_SHUFFLE_WASM!)];
      const bad = wasm.slice(); bad[bad.length - 1] ^= 1;
      await expect(pages[0].evaluate(bytes => window.historySigningHarness.initializeShuffleAdmission(bytes, 0), bad)).rejects.toThrow('module_hash');
      if (seats === 2) {
        const fresh = await Promise.all(pages.map((page, seat) => page.evaluate(({ wasm, seat }) => window.historySigningHarness.initializeShuffleAdmission(wasm, seat), { wasm, seat })));
        const original = fresh[1];
        fresh[1] = `${original.slice(0, -2)}${(parseInt(original.slice(-2), 16) ^ 1).toString(16).padStart(2, '0')}` as typeof original;
        const calls = await pages[0].evaluate(() => window.historySigningHarness.signCount());
        await expect(pages[0].evaluate(announcements => window.historySigningHarness.reviewShuffleRoster(announcements), fresh)).rejects.toThrow('proof_or_phase');
        await expect(pages[0].evaluate(() => window.historySigningHarness.signShuffleRoster())).rejects.toThrow('closed');
        expect(await pages[0].evaluate(() => window.historySigningHarness.signCount())).toBe(calls);
        await Promise.all(pages.map(page => page.evaluate(() => window.historySigningHarness.closeShuffleAdmission())));
      }
      if (scenario === 12) {
        const result = await pages[0].evaluate(wasm => window.historySigningHarness.cancelProtectedStartupForTest(wasm), wasm);
        expect(result).toMatchObject({ terminations: 1, stage: 'closed', localClosed: true });
        expect(result.reason).toContain('poker_protected:disposed');
        await Promise.all(pages.map(page => page.waitForFunction(() => window.historySigningHarness.localHistoryClosed())));
        for (const page of pages) expect(await page.evaluate(() => window.historySigningHarness.signCount())).toBe(0);
        return;
      }
      if (seats === 5) {
        await Promise.all(pages.slice(0, -1).map((page, seat) => page.evaluate(wasm => window.historySigningHarness.startProtectedPoker(wasm), wasm)));
        await pages[1].waitForFunction(() => window.historySigningHarness.pokerProtocolSessionStage() === 'waitingPeers');
        expect(await pages[1].evaluate(() => window.historySigningHarness.historyTableStatus().ready)).toBe(false);
        await pages[seats - 1].evaluate(wasm => window.historySigningHarness.startProtectedPoker(wasm), wasm);
      } else {
        await Promise.all(pages.map((page, seat) => page.evaluate(wasm => window.historySigningHarness.startProtectedPoker(wasm), wasm)));
      }
      await Promise.all(pages.map(page => page.waitForFunction(() => window.historySigningHarness.historyTableStatus().ready)));
      const announcements = await Promise.all(pages.map(page => page.evaluate(() => window.historySigningHarness.localShuffleAnnouncement())));
      for (const page of pages) {
        await expect(page.evaluate(() => window.historySigningHarness.shuffleCommand('shuffle'))).rejects.toThrow('unauthorized');
        expect(await page.evaluate(() => window.historySigningHarness.signCount())).toBe(0);
      }
      const substituted = [...announcements]; [substituted[0], substituted[1]] = [substituted[1], substituted[0]];
      await expect(pages[0].evaluate(announcements => window.historySigningHarness.reviewShuffleRoster(announcements), substituted)).rejects.toThrow('own_key_substitution');

      if (scenario === 10) {
        await pages[0].evaluate(() => window.historySigningHarness.sendTableAnnouncement(0, true));
        await Promise.all(pages.map(page => page.waitForFunction(() => Boolean(window.historySigningHarness.historyTableStatus().closed))));
        for (const page of pages) {
          expect(await page.evaluate(() => window.historySigningHarness.proofExchangeStatus().workerClosed)).toBe(true);
          expect(await page.evaluate(() => window.historySigningHarness.localHistoryClosed())).toBe(true);
        }
        expect(await pages[1].evaluate(() => window.historySigningHarness.missingTableAnnouncements())).toEqual([0, 1]);
        expect(await pages[1].evaluate(() => window.historySigningHarness.proofExchangeStatus().reason)).toContain('proof_or_phase');
        for (const page of pages) {
          expect(await page.evaluate(() => window.historySigningHarness.signCount())).toBe(0);
          await expect(page.evaluate(() => window.historySigningHarness.signShuffleRoster())).rejects.toThrow();
        }
        await Promise.all(pages.map(page => page.evaluate(() => window.historySigningHarness.closeShuffleAdmission())));
        return;
      }
      // Honest peers may finish worker initialization together. Exercise real
      // overlapping delivery rather than having the runner serialize authors.
      for (const page of pages) {
        await expect(page.evaluate(() => window.historySigningHarness.signShuffleRoster())).rejects.toThrow('roster_unreviewed');
      }
      if (scenario >= 13) {
        const rosters = await Promise.all(pages.map(page => page.evaluate(() => window.historySigningHarness.exchangeProtectedAnnouncements())));
        for (const roster of rosters) expect(roster).toEqual(announcements);
      } else await Promise.all(pages.map((page, seat) => page.evaluate(seat => window.historySigningHarness.sendTableAnnouncement(seat), seat)));
      await Promise.all(pages.map(page => page.waitForFunction(() => window.historySigningHarness.missingTableAnnouncements().length === 0)));
      for (const page of pages) expect(await page.evaluate(() => window.historySigningHarness.signCount())).toBe(0);
      for (const page of pages) {
        const references = await page.evaluate(() => Promise.all([
          window.historySigningHarness.prepareTableRosterSigning(), window.historySigningHarness.prepareTableRosterSigning(),
        ]));
        expect(references[0]).toEqual(references[1]);
      }
      if (scenario === 11) {
        await pages[0].evaluate(() => window.historySigningHarness.holdSigningForTest());
        const pending = pages[0].evaluate(() => window.historySigningHarness.signShuffleRoster())
          .then(() => 'unexpected_signature', error => String(error));
        await pages[0].waitForFunction(() => window.historySigningHarness.signCount() === 1);
        // Closing a guest's local owner must terminate both protocol peers and
        // revoke the relay account before its delayed approval can escape.
        await pages[1].evaluate(() => window.historySigningHarness.closeLocalHistory());
        await Promise.all(pages.map(page => page.waitForFunction(() => window.historySigningHarness.localHistoryClosed()
          && Boolean(window.historySigningHarness.historyTableStatus().closed))));
        await pages[0].evaluate(() => window.historySigningHarness.releaseSigningForTest());
        expect(await pending).toContain('poker_local:closed');
        for (const page of pages) {
          expect(await page.evaluate(() => window.historySigningHarness.proofExchangeStatus().workerClosed)).toBe(true);
          expect(await page.evaluate(() => window.historySigningHarness.missingTableApprovals('roster'))).toEqual([0, 1]);
          await expect(page.evaluate(() => window.historySigningHarness.signShuffleRoster())).rejects.toThrow();
        }
        expect(await pages[0].evaluate(() => window.historySigningHarness.signCount())).toBe(1);
        expect(await pages[1].evaluate(() => window.historySigningHarness.signCount())).toBe(0);
        return;
      }
      async function collectApprovals(kind: 'roster' | 'deck' | 'deal') {
        for (let seat = 0; seat < seats; seat++) {
          await pages[seat].evaluate(({ kind, seat }) => window.historySigningHarness.sendTableApproval(kind, seat), { kind, seat });
          await Promise.all(pages.map(page => page.waitForFunction(({ kind, seat }) => !window.historySigningHarness.missingTableApprovals(kind).includes(seat), { kind, seat })));
          if (seat < seats - 1) for (const page of pages) {
            await expect(page.evaluate(kind => window.historySigningHarness.tableApprovalEnvelope(kind), kind)).rejects.toThrow('incomplete');
          }
        }
      }
      if (scenario === 9) {
        // Guest 2 signs its own approval but the packet falsely claims guest 1.
        await pages[2].evaluate(() => window.historySigningHarness.sendTableApproval('roster', 2, 1));
        await Promise.all(pages.map(page => page.waitForFunction(() => Boolean(window.historySigningHarness.historyTableStatus().closed))));
        for (const page of pages) {
          expect(await page.evaluate(() => window.historySigningHarness.proofExchangeStatus().workerClosed)).toBe(true);
          expect(await page.evaluate(() => window.historySigningHarness.localHistoryClosed())).toBe(true);
        }
        for (const seat of [0, 1]) {
          expect(await pages[seat].evaluate(() => window.historySigningHarness.missingTableApprovals('roster'))).toEqual([0, 1, 2]);
          expect(await pages[seat].evaluate(() => window.historySigningHarness.signCount())).toBe(0);
        }
        expect(await pages[0].evaluate(() => window.historySigningHarness.historyChannelEvents().some(event => event.kind === 'rejected' && event.message?.includes('wrong_signer')))).toBe(true);
        await Promise.all(pages.map(page => page.evaluate(() => window.historySigningHarness.closeShuffleAdmission())));
        return;
      }
      stage = 'roster-approvals';
      await collectApprovals('roster');
      const approvals = JSON.parse(await pages[0].evaluate(() => window.historySigningHarness.tableApprovalEnvelope('roster'))).signatures;

      const forged = [...approvals]; forged[1] = forged[0];
      await expect(pages[0].evaluate(signatures => window.historySigningHarness.authorizeShuffleRoster(signatures), forged)).rejects.toThrow('wrong_signer');
      await expect(pages[0].evaluate(() => window.historySigningHarness.shuffleCommand('shuffle'))).rejects.toThrow('unauthorized');
      if (scenario < 13) await Promise.all(pages.map(page => page.evaluate(() => window.historySigningHarness.authorizeTableApproval('roster'))));
      await expect(pages[0].evaluate(() => window.historySigningHarness.signShuffleDeck())).rejects.toThrow(scenario >= 13 ? 'unauthorized' : 'shuffle_incomplete');
      if (scenario === 6) {
        const before = await Promise.all(pages.map(page => page.evaluate(() => window.historySigningHarness.signCount())));
        await pages[0].evaluate(() => window.historySigningHarness.shuffleOverTable(0, true));
        await Promise.all(pages.map(page => page.waitForFunction(() => Boolean(window.historySigningHarness.historyTableStatus().closed))));
        for (const page of pages) {
          expect(await page.evaluate(() => window.historySigningHarness.proofExchangeStatus().workerClosed)).toBe(true);
          expect(await page.evaluate(() => window.historySigningHarness.localHistoryClosed())).toBe(true);
        }
        expect(await pages[1].evaluate(() => window.historySigningHarness.tableShuffleSteps())).toEqual([]);
        expect(await pages[1].evaluate(() => window.historySigningHarness.proofExchangeStatus().reason)).toContain('proof_or_phase');
        for (const [seat, page] of pages.entries()) {
          await expect(page.evaluate(() => window.historySigningHarness.signShuffleDeck())).rejects.toThrow('unauthorized');
          expect(await page.evaluate(() => window.historySigningHarness.signCount())).toBe(before[seat]);
        }
        await Promise.all(pages.map(page => page.evaluate(() => window.historySigningHarness.closeShuffleAdmission())));
        return;
      }
      if (scenario >= 13) {
        const before = await Promise.all(pages.map(page => page.evaluate(() => window.historySigningHarness.signCount())));
        const heads = await Promise.all(pages.map(page => page.evaluate(() => window.historySigningHarness.shuffleProtectedDeck())));
        expect(new Set(heads).size).toBe(1);
        for (const [seat, page] of pages.entries()) {
          expect(await page.evaluate(() => window.historySigningHarness.signCount())).toBe(before[seat]);
          expect(await page.evaluate(() => window.historySigningHarness.shuffleProtectedDeck())).toBe(heads[seat]);
        }
      } else for (let actor = 0; actor < seats; actor++) {
        await pages[actor].evaluate(actor => window.historySigningHarness.shuffleOverTable(actor), actor);
        await Promise.all(pages.map(page => page.waitForFunction(actor => window.historySigningHarness.tableShuffleSteps().includes(actor), actor)));
      }
      const heads = await Promise.all(pages.map(page => page.evaluate(() => window.historySigningHarness.reviewShuffleDeck())));
      expect(new Set(heads).size).toBe(1);
      for (const page of pages) {
        await expect(page.evaluate(() => window.historySigningHarness.shuffleCommand('token'))).rejects.toThrow('deck_unauthorized');
        await expect(page.evaluate(() => window.historySigningHarness.shuffleCommand('open'))).rejects.toThrow('deck_unauthorized');
      }
      stage = 'deck-approvals';
      await collectApprovals('deck');
      const deckWire = await pages[0].evaluate(() => window.historySigningHarness.tableApprovalEnvelope('deck'));
      const deckSignatures = JSON.parse(deckWire).signatures;
      const rawDeck = JSON.parse(deckWire);
      for (const patch of [{ signatures: deckSignatures.slice(1) }, { signatures: [deckSignatures[0], ...deckSignatures.slice(0, seats - 1)] },
        { signatures: approvals }, { deckHead: `0x${'ab'.repeat(32)}` }]) {
        await expect(pages[0].evaluate(wire => window.historySigningHarness.authorizeShuffleDeck(wire), JSON.stringify({ ...rawDeck, ...patch }))).rejects.toThrow();
        await expect(pages[0].evaluate(() => window.historySigningHarness.shuffleCommand('token'))).rejects.toThrow('deck_unauthorized');
      }
      await Promise.all(pages.map(page => page.evaluate(() => window.historySigningHarness.authorizeTableApproval('deck'))));
      const plans = await Promise.all(pages.map(page => page.evaluate(() => window.historySigningHarness.shuffleDealPlan())));
      for (const plan of plans) expect(plan).toEqual(plans[0]);
      await expect(pages[0].evaluate(() => window.historySigningHarness.signShuffleDeal())).rejects.toThrow('private_deal_incomplete');
      await expect(pages[0].evaluate(() => window.historySigningHarness.proposePoker('{"move":"call"}'))).rejects.toThrow();
      if (scenario === 8) {
        // Seat 2 targets seat 1's card through relay 0, which must review before forwarding.
        const position = plans[0].holeRecipients.indexOf(1);
        const before = await Promise.all(pages.map(page => page.evaluate(() => window.historySigningHarness.signCount())));
        await pages[2].evaluate(position => window.historySigningHarness.sendPrivateTableContribution(position, 2, true), position);
        await Promise.all(pages.map(page => page.waitForFunction(() => Boolean(window.historySigningHarness.historyTableStatus().closed))));
        for (const page of pages) {
          expect(await page.evaluate(() => window.historySigningHarness.proofExchangeStatus().workerClosed)).toBe(true);
          expect(await page.evaluate(() => window.historySigningHarness.localHistoryClosed())).toBe(true);
        }
        for (const seat of [0, 1]) expect(await pages[seat].evaluate(position => window.historySigningHarness.hasPrivateTableContribution(position, 2), position)).toBe(false);
        expect(await pages[0].evaluate(() => window.historySigningHarness.historyChannelEvents().some(event => event.kind === 'rejected' && event.message?.includes('proof_or_phase')))).toBe(true);
        for (const [seat, page] of pages.entries()) {
          await expect(page.evaluate(() => window.historySigningHarness.signShuffleDeal())).rejects.toThrow('unauthorized');
          expect(await page.evaluate(() => window.historySigningHarness.signCount())).toBe(before[seat]);
        }
        await Promise.all(pages.map(page => page.evaluate(() => window.historySigningHarness.closeShuffleAdmission())));
        return;
      }
      const opened: number[] = [];
      if (scenario >= 13) {
        stage = 'autonomous-private-deal';
        const before = await Promise.all(pages.map(page => page.evaluate(() => window.historySigningHarness.signCount())));
        const hands = await Promise.all(pages.map(page => page.evaluate(() => window.historySigningHarness.dealProtectedPrivateCards())));
        for (const [seat, hand] of hands.entries()) {
          expect(hand.map(card => card.position)).toEqual(plans[0].holePositions[seat]);
          expect(hand).toHaveLength(2);
          for (const { position, card } of hand) {
            expect(card).toBeGreaterThanOrEqual(0); expect(card).toBeLessThan(52);
            opened[position] = card;
          }
          expect(await pages[seat].evaluate(() => window.historySigningHarness.signCount())).toBe(before[seat]);
          expect(await pages[seat].evaluate(() => window.historySigningHarness.dealProtectedPrivateCards())).toEqual(hand);
        }
        expect(new Set(opened).size).toBe(2 * seats);
        // Only the test runner combines hands; application peers receive their own two cards.
        for (const [position, owner] of plans[0].holeRecipients.entries()) {
          await expect(pages[owner].evaluate(position => window.historySigningHarness.shuffleCommand('token', 0, [], position), position)).rejects.toThrow('proof_or_phase');
          await expect(pages[(owner + 1) % seats].evaluate(position => window.historySigningHarness.shuffleCommand('open', 0, [], position), position)).rejects.toThrow('proof_or_phase');
        }
      } else for (const [position, owner] of plans[0].holeRecipients.entries()) {
        // Independent formula catches drift between native and TypeScript policy.
        expect(owner).toBe((inputs[0].dealer + 1 + position % seats) % seats);
        await expect(pages[owner].evaluate(position => window.historySigningHarness.shuffleCommand('token', 0, [], position), position)).rejects.toThrow('proof_or_phase');
        await expect(pages[owner].evaluate(position => window.historySigningHarness.shuffleCommand('open', 0, [], position), position)).rejects.toThrow('proof_or_phase');
        const contributors = pages.map((_, seat) => seat).filter(seat => seat !== owner);
        await Promise.all(contributors.map(seat => pages[seat].evaluate(({ position, seat }) => window.historySigningHarness.sendPrivateTableContribution(position, seat), { position, seat })));
        await Promise.all(pages.flatMap(page => contributors.map(seat => page.waitForFunction(({ position, seat }) => window.historySigningHarness.hasPrivateTableContribution(position, seat), { position, seat }))));
        for (const seat of contributors) await expect(pages[seat].evaluate(position => window.historySigningHarness.shuffleCommand('open', 0, [], position), position)).rejects.toThrow('proof_or_phase');
        const card = await pages[owner].evaluate(position => window.historySigningHarness.shuffleCommand('open', 0, [], position), position);
        expect(card).toHaveLength(1); expect(card[0]).toBeGreaterThanOrEqual(0); expect(card[0]).toBeLessThan(52);
        expect(opened).not.toContain(card[0]); opened.push(card[0]); // Test oracle only.
        if (seats === 2 && position === 0) {
          const repeated = await pages[owner].evaluate(position => window.historySigningHarness.shuffleCommand('open', 0, [], position), position);
          expect(repeated).toEqual(card);
          await expect(pages[owner].evaluate(() => window.historySigningHarness.signShuffleDeal())).rejects.toThrow('private_deal_incomplete');
        }
      }
      for (const page of pages) for (const position of [2 * seats, 2 * seats + 1, -1, 0.5, 52]) {
        await expect(page.evaluate(position => window.historySigningHarness.shuffleCommand('token', 0, [], position), position)).rejects.toThrow('position');
        await expect(page.evaluate(position => window.historySigningHarness.shuffleCommand('open', 0, [], position), position)).rejects.toThrow('position');
      }
      stage = 'deal-approvals';
      await collectApprovals('deal');
      const certificate = await pages[0].evaluate(() => window.historySigningHarness.tableApprovalEnvelope('deal'));
      const dealer = inputs[0].dealer;
      const wrong = JSON.stringify({ ...JSON.parse(certificate), signatures: deckSignatures });
      await expect(pages[dealer].evaluate(certificate => window.historySigningHarness.proposePoker(JSON.stringify({ move: 'beginBetting', certificate })), wrong)).rejects.toThrow('wrong_signer');
      const commit = async (actor: number, payload: string) => {
        stage = `gameplay:${JSON.parse(payload).move}`;
        const sequence = (await pages[0].evaluate(() => window.historySigningHarness.checkpoint())).sequence + 1;
        await pages[actor].waitForFunction(() => window.historySigningHarness.tableGameplayStatus().canPropose);
        await pages[actor].evaluate(payload => window.historySigningHarness.proposeTableGameplay(payload), payload);
        await Promise.all(pages.map(page => page.waitForFunction(() => window.historySigningHarness.tableGameplayStatus().ready)));
        for (const page of pages) await page.evaluate(() => window.historySigningHarness.acknowledgeTableGameplay());
        await pages[0].waitForFunction(() => window.historySigningHarness.tableGameplayStatus().missing.length === 0);
        await pages[0].evaluate(() => window.historySigningHarness.commitTableGameplay());
        await Promise.all(pages.map(page => page.waitForFunction(sequence => window.historySigningHarness.checkpoint().sequence === sequence, sequence)));
        const checkpoints = await Promise.all(pages.map(page => page.evaluate(() => window.historySigningHarness.checkpoint())));
        expect(new Set(checkpoints.map(checkpoint => checkpoint.head)).size).toBe(1);
        return JSON.parse(checkpoints[0].stateJSON);
      };
      let publicState = await commit(dealer, JSON.stringify({ move: 'beginBetting', certificate }));
      expect(publicState.phase).toBe('betting'); expect(publicState.deckHead).toBe(heads[0]);
      await expect(pages[0].evaluate(() => window.historySigningHarness.authorizeShuffleShowdown())).rejects.toThrow('showdown_phase');
      if (scenario === 4) {
        const folder = publicState.betting.round.activeSeat;
        publicState = await commit(folder, '{"move":"fold"}');
        const beforeForged = await pages[dealer].evaluate(() => window.historySigningHarness.signCount());
        await expect(pages[dealer].evaluate(() => window.historySigningHarness.proposePoker('{"move":"finishUncontested","payouts":[1000,0]}'))).rejects.toThrow('fields');
        expect(await pages[dealer].evaluate(() => window.historySigningHarness.signCount())).toBe(beforeForged);
        publicState = await commit(dealer, '{"move":"finishUncontested"}');
        expect(publicState.phase).toBe('complete'); expect(publicState.result.reason).toBe('uncontested');
        expect(publicState.betting.pot).toBe(0); expect(publicState.community).toEqual([]);
        expect(publicState.betting.players[folder].chips).toBe(99);
        expect(publicState.betting.players[1 - folder].chips).toBe(101);
        await expect(pages[dealer].evaluate(() => window.historySigningHarness.proposePoker('{"move":"finishUncontested"}'))).rejects.toThrow('hand_complete');
        await expect(pages[0].evaluate(() => window.historySigningHarness.authorizeShuffleFlop())).rejects.toThrow('flop_phase');
        await Promise.all(pages.map(page => page.evaluate(() => window.historySigningHarness.closeShuffleAdmission())));
        return;
      }
      await expect(pages[0].evaluate(() => window.historySigningHarness.authorizeShuffleFlop())).rejects.toThrow('betting_incomplete');
      for (let action = 0; action < seats; action++) {
        const actor = publicState.betting.round.activeSeat;
        const move = publicState.betting.players[actor].bet < publicState.betting.round.currentBet ? 'call' : 'check';
        publicState = await commit(actor, JSON.stringify({ move }));
      }
      expect(publicState.betting.round.isComplete).toBe(true);
      expect(publicState.betting.pot).toBe(seats * 2);
      const flopPositions = plans[0].communityPositions.slice(0, 3);
      await expect(pages[0].evaluate(position => window.historySigningHarness.publicShuffleCommand('token', position), flopPositions[0])).rejects.toThrow('public_unauthorized');
      if (scenario < 13) {
      await Promise.all(pages.map(page => page.evaluate(() => window.historySigningHarness.authorizeShuffleFlop())));
      for (const position of [...plans[0].burnPositions, ...plans[0].communityPositions.slice(3), 0]) {
        await expect(pages[0].evaluate(position => window.historySigningHarness.publicShuffleCommand('token', position), position)).rejects.toThrow('public_position');
      }
      await expect(pages[0].evaluate(() => window.historySigningHarness.bindShuffleFlop())).rejects.toThrow('flop_incomplete');
      }
      if (scenario === 7) {
        const position = flopPositions[0];
        const before = await Promise.all(pages.map(page => page.evaluate(() => window.historySigningHarness.signCount())));
        await pages[0].evaluate(position => window.historySigningHarness.preparePublicTableContribution(position, 0), position);
        await pages[0].evaluate(position => window.historySigningHarness.sendPublicTableContribution(position, 0, true), position);
        await Promise.all(pages.map(page => page.waitForFunction(() => Boolean(window.historySigningHarness.historyTableStatus().closed))));
        for (const page of pages) {
          expect(await page.evaluate(() => window.historySigningHarness.proofExchangeStatus().workerClosed)).toBe(true);
          expect(await page.evaluate(() => window.historySigningHarness.localHistoryClosed())).toBe(true);
        }
        expect(await pages[1].evaluate(position => window.historySigningHarness.hasPublicTableContribution(position, 0), position)).toBe(false);
        expect(await pages[1].evaluate(() => window.historySigningHarness.proofExchangeStatus().reason)).toContain('proof_or_phase');
        for (const [seat, page] of pages.entries()) {
          await expect(page.evaluate(() => window.historySigningHarness.bindShuffleFlop())).rejects.toThrow('unauthorized');
          expect(await page.evaluate(() => window.historySigningHarness.signCount())).toBe(before[seat]);
        }
        await Promise.all(pages.map(page => page.evaluate(() => window.historySigningHarness.closeShuffleAdmission())));
        return;
      }
      if (scenario >= 13) {
        const before = await Promise.all(pages.map(page => page.evaluate(() => window.historySigningHarness.signCount())));
        const results = await Promise.all(pages.map(page => page.evaluate(() => window.historySigningHarness.revealProtectedStreet('flop'))));
        for (const [seat, result] of results.entries()) {
          expect(result).toEqual(results[0]);
          expect(await pages[seat].evaluate(() => window.historySigningHarness.signCount())).toBe(before[seat]);
        }
        expect(results[0]).toHaveLength(3);
        for (const card of results[0]) { expect(opened).not.toContain(card); opened.push(card); }
      } else for (const position of flopPositions) {
        await deliverPublicContributions(position);
        const cards = await Promise.all(pages.map(page => page.evaluate(position => window.historySigningHarness.publicShuffleCommand('open', position), position)));
        for (const card of cards) { expect(card).toEqual(cards[0]); expect(card).toHaveLength(1); }
        expect(cards[0][0]).toBeGreaterThanOrEqual(0); expect(cards[0][0]).toBeLessThan(52);
        expect(opened).not.toContain(cards[0][0]); opened.push(cards[0][0]);
      }

      const boards = await Promise.all(pages.map(page => page.evaluate(auto => auto ? window.historySigningHarness.revealProtectedStreet('flop') : window.historySigningHarness.bindShuffleFlop(), scenario >= 13)));
      for (const board of boards) expect(board).toEqual(boards[0]);
      const changed = [...boards[0]]; changed[0] = (changed[0] + 1) % 52;
      const beforeForged = await pages[dealer].evaluate(() => window.historySigningHarness.signCount());
      await expect(pages[dealer].evaluate(cards => window.historySigningHarness.proposePoker(JSON.stringify({ move: 'revealFlop', cards })), changed)).rejects.toThrow('flop_mismatch');
      expect(await pages[dealer].evaluate(() => window.historySigningHarness.signCount())).toBe(beforeForged);
      publicState = await commit(dealer, JSON.stringify({ move: 'revealFlop', cards: boards[0] }));
      expect(publicState).toMatchObject({ street: 'flop', community: boards[0], contributions: Array(seats).fill(2) });
      expect(publicState.betting.round).toMatchObject({ activeSeat: (dealer + 1) % seats, currentBet: 0, minRaise: 2, isComplete: false });
      await expect(pages[0].evaluate(() => window.historySigningHarness.authorizeShuffleFlop())).rejects.toThrow('flop_phase');
      await expect(pages[0].evaluate(position => window.historySigningHarness.publicShuffleCommand('token', position), flopPositions[0])).rejects.toThrow('public_unauthorized');
      let foldedSeat: number | null = null;
      publicState = await commit(publicState.betting.round.activeSeat, '{"move":"bet","amount":4}');
      for (let action = 1; !publicState.betting.round.isComplete && action < seats; action++) {
        const actor = publicState.betting.round.activeSeat;
        if ((scenario === 5 || scenario === 15) && action === 1) { foldedSeat = actor; publicState = await commit(actor, '{"move":"fold"}'); }
        else publicState = await commit(actor, '{"move":"call"}');
      }
      const investments = (amount: number) => Array.from({ length: seats }, (_, seat) => seat === foldedSeat ? 2 : amount);
      expect(publicState.betting.round.isComplete).toBe(true);
      expect(publicState.betting.pot).toBe(investments(6).reduce((sum, amount) => sum + amount, 0));
      expect(publicState.contributions).toEqual(investments(6));
      for (const [stage, street] of (['turn', 'river'] as const).entries()) {
        const position = plans[0].communityPositions[stage + 3];
        if (street === 'turn') await expect(pages[0].evaluate(() => window.historySigningHarness.authorizeShuffleStreet('river'))).rejects.toThrow('river_phase');
        await expect(pages[0].evaluate(position => window.historySigningHarness.publicShuffleCommand('token', position), position)).rejects.toThrow('public_unauthorized');
        let cards: readonly (readonly number[])[];
        if (scenario >= 13) {
          cards = await Promise.all(pages.map(page => page.evaluate(street => window.historySigningHarness.revealProtectedStreet(street), street)));
        } else {
        await Promise.all(pages.map(page => page.evaluate(street => window.historySigningHarness.authorizeShuffleStreet(street), street)));
        for (const forbidden of [...plans[0].burnPositions, ...plans[0].communityPositions.filter(card => card !== position), 0]) {
          await expect(pages[0].evaluate(position => window.historySigningHarness.publicShuffleCommand('token', position), forbidden)).rejects.toThrow('public_position');
        }
        await deliverPublicContributions(position);
        cards = await Promise.all(pages.map(page => page.evaluate(position => window.historySigningHarness.publicShuffleCommand('open', position), position)));
        }
        for (const card of cards) expect(card).toEqual(cards[0]);
        expect(opened).not.toContain(cards[0][0]); opened.push(cards[0][0]);
        const evidence = await Promise.all(pages.map(page => page.evaluate(({ street, auto }) => auto ? window.historySigningHarness.revealProtectedStreet(street) : window.historySigningHarness.bindShuffleStreet(street), { street, auto: scenario >= 13 })));
        const move = street === 'turn' ? 'revealTurn' : 'revealRiver';
        const forged = [(evidence[0][0] + 1) % 52];
        await expect(pages[dealer].evaluate(({ move, cards }) => window.historySigningHarness.proposePoker(JSON.stringify({ move, cards })), { move, cards: forged })).rejects.toThrow(`${street}_mismatch`);
        publicState = await commit(dealer, JSON.stringify({ move, cards: evidence[0] }));
        expect(publicState.street).toBe(street); expect(publicState.community).toHaveLength(stage + 4);
        await expect(pages[0].evaluate(position => window.historySigningHarness.publicShuffleCommand('token', position), position)).rejects.toThrow('public_unauthorized');
        if (street === 'turn') await expect(pages[0].evaluate(() => window.historySigningHarness.authorizeShuffleStreet('river'))).rejects.toThrow('betting_incomplete');
        publicState = await commit(publicState.betting.round.activeSeat, '{"move":"bet","amount":2}');
        for (let action = 1; !publicState.betting.round.isComplete && action < seats; action++) publicState = await commit(publicState.betting.round.activeSeat, '{"move":"call"}');
        expect(publicState.betting.round.isComplete).toBe(true);
        expect(publicState.betting.pot).toBe(investments(8 + 2 * stage).reduce((sum, amount) => sum + amount, 0));
        expect(publicState.contributions).toEqual(investments(8 + 2 * stage));
      }
      const finalPot = publicState.betting.pot;
      if (scenario >= 13) {
        const before = await Promise.all(pages.map(page => page.evaluate(() => window.historySigningHarness.signCount())));
        const results = await Promise.all(pages.map(page => page.evaluate(() => window.historySigningHarness.revealProtectedShowdown())));
        for (const [seat, result] of results.entries()) {
          expect(result).toEqual(plans[0].holePositions.map((positions, owner) => owner === foldedSeat ? null : positions.map(position => opened[position])));
          expect(await pages[seat].evaluate(() => window.historySigningHarness.signCount())).toBe(before[seat]);
        }
        if (foldedSeat !== null) for (const page of pages) for (const position of plans[0].holePositions[foldedSeat]) await expect(page.evaluate(position => window.historySigningHarness.publicShuffleCommand('token', position), position)).rejects.toThrow('public_position');
      } else {
      await Promise.all(pages.map(page => page.evaluate(() => window.historySigningHarness.authorizeShuffleShowdown())));
      await expect(pages[0].evaluate(() => window.historySigningHarness.bindShuffleShowdown())).rejects.toThrow('showdown_incomplete');
      for (const [position, owner] of plans[0].holeRecipients.entries()) {
        if (owner === foldedSeat) {
          for (const page of pages) await expect(page.evaluate(position => window.historySigningHarness.publicShuffleCommand('token', position), position)).rejects.toThrow('public_position');
          continue;
        }
        await deliverPublicContributions(position);
        const cards = await Promise.all(pages.map(page => page.evaluate(position => window.historySigningHarness.publicShuffleCommand('open', position), position)));
        for (const card of cards) expect(card).toEqual([opened[position]]);
      }
      }
      const hands = await Promise.all(pages.map(page => page.evaluate(auto => auto ? window.historySigningHarness.revealProtectedShowdown() : window.historySigningHarness.bindShuffleShowdown(), scenario >= 13)));
      for (const hand of hands) expect(hand).toEqual(hands[0]);
      if (foldedSeat !== null) expect(hands[0][foldedSeat]).toBeNull();
      const forgedHands = hands[0].map(hand => hand === null ? null : [...hand]);
      const target = forgedHands.find(hand => hand !== null)!; target[0] = (target[0] + 1) % 52;
      const beforeShowdownForgery = await pages[dealer].evaluate(() => window.historySigningHarness.signCount());
      await expect(pages[dealer].evaluate(hands => window.historySigningHarness.proposePoker(JSON.stringify({ move: 'finishShowdown', hands })), forgedHands)).rejects.toThrow('showdown_mismatch');
      expect(await pages[dealer].evaluate(() => window.historySigningHarness.signCount())).toBe(beforeShowdownForgery);
      publicState = await commit(dealer, JSON.stringify({ move: 'finishShowdown', hands: hands[0] }));
      stage = 'showdown-outcome-assertions';
      expect(publicState.phase).toBe('complete'); expect(publicState.result.reason).toBe('showdown');
      expect(publicState.betting.pot).toBe(0);
      expect(publicState.result.payouts.reduce((sum: number, amount: number) => sum + amount, 0)).toBe(finalPot);
      expect(publicState.betting.players.reduce((sum: number, player: { chips: number }) => sum + player.chips, 0)).toBe(seats * 100);
      if (foldedSeat !== null) { expect(publicState.result.hands[foldedSeat]).toBeNull(); expect(publicState.result.awards[foldedSeat]).toBe(0); }
      await expect(pages[dealer].evaluate(() => window.historySigningHarness.proposePoker('{"move":"finishUncontested"}'))).rejects.toThrow('hand_complete');
      await Promise.all(pages.map(page => page.evaluate(() => window.historySigningHarness.closeShuffleAdmission())));

    } catch (error) { bodyFailed = true; throw error; }
    finally {
      // Public phase names only: no test keys, cards or signed-message bytes.
      console.info('Poker scenario timing', { seats, scenario, stage, bodyFailed, elapsedMs: Date.now() - started });
      const closed = await Promise.allSettled(contexts.map(context => context.close()));
      // Teardown must not replace the original protocol assertion/timeout.
      if (!bodyFailed) {
        const failure = closed.find(result => result.status === 'rejected');
        if (failure?.status === 'rejected') throw failure.reason;
      }
    }
  });
}
