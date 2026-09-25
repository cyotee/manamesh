// Local browser fixture only; no funded transactions or deployed contract.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { keccak256, toHex, type Address } from 'viem';
import { PokerDealtBettingReplay, PokerHistoryEnrollment } from '@manamesh/poker/verified-history';
import { PokerEnrollmentApproval } from '../src/pages/poker/PokerEnrollmentApproval';
import type { InjectedEthereum } from '../src/blockchain/liveFromInjected';
const root = createRoot(document.getElementById('root')!);
let approvals = 0;
const digest = (value: string) => keccak256(toHex(value));
function initialize(wallets: Address[]) {
  const replay = new PokerDealtBettingReplay({ stacks: [100, 100], dealer: 0, smallBlind: 1, bigBlind: 2 });
  const enrollment = new PokerHistoryEnrollment({ nonce: digest('approval-fixture'), handId: digest('approval-hand'),
    rulesHash: digest('approval-rules'), chainId: 31337, settler: wallets[0],
    roster: ['0x0000000000000000000000000000000000000001', '0x0000000000000000000000000000000000000002'] },
    replay.genesisJSON, replay.replay, wallets);
  root.render(<PokerEnrollmentApproval enrollment={enrollment} localSeat={0}
    provider={(window as unknown as { ethereum: InjectedEthereum }).ethereum}
    onApproval={async signature => { await enrollment.collectApproval(0, signature); approvals++; }} />);
}
(window as any).enrollmentApprovalHarness = { initialize, count: () => approvals, unmount: () => root.unmount() };
