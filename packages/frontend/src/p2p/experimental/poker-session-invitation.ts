import { getAddress, keccak256, toHex, type Address, type Hex, type LocalAccount } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { PokerDealtBettingReplay, PokerHistoryEnrollment, pokerHistoryJSON } from '@manamesh/poker/verified-history';

const PROTOCOL = 'manamesh-poker-invitation-v1';
export const POKER_INVITATION_RULES = keccak256(toHex('ManaMeshPoker:holdem:dealt-betting-v5:2-5-seats:no-rake:river-showdown'));
type Participant = Readonly<{ wallet: Address; signingKey: Address }>;
type Invitation = Readonly<{ protocol: typeof PROTOCOL; rulesHash: Hex; nonce: Hex; handId: Hex;
  chainId: number; settler: Address; dealer: number; smallBlind: number; bigBlind: number;
  seats: readonly Readonly<Participant & { stack: number }>[] }>;
function requireThat(value: unknown, reason: string): asserts value {
  if (!value) throw new Error(`poker_invitation:${reason}`);
}
function exact(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  requireThat(value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key)), 'fields');
}
function address(value: unknown): Address {
  requireThat(typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value), 'address');
  const result = getAddress(value);
  requireThat(!/^0x0{40}$/.test(result), 'zero_address');
  return result;
}
function digest(value: unknown): Hex {
  requireThat(typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value) && !/^0x0{64}$/.test(value), 'digest');
  return value as Hex;
}
function validate(value: unknown): Invitation {
  exact(value, ['protocol', 'rulesHash', 'nonce', 'handId', 'chainId', 'settler', 'dealer', 'smallBlind', 'bigBlind', 'seats']);
  requireThat(value.protocol === PROTOCOL && value.rulesHash === POKER_INVITATION_RULES, 'protocol');
  requireThat(Number.isSafeInteger(value.chainId) && Number(value.chainId) > 0, 'chain');
  requireThat(Array.isArray(value.seats) && value.seats.length >= 2 && value.seats.length <= 5, 'seats');
  const seats = value.seats.map(seat => {
    exact(seat, ['wallet', 'signingKey', 'stack']);
    requireThat(Number.isSafeInteger(seat.stack), 'stack');
    return Object.freeze({ wallet: address(seat.wallet), signingKey: address(seat.signingKey), stack: Number(seat.stack) });
  });
  const identities = seats.flatMap(seat => [seat.wallet, seat.signingKey]);
  requireThat(new Set(identities).size === identities.length, 'identities');
  const options = { stacks: seats.map(seat => seat.stack), dealer: value.dealer as number,
    smallBlind: value.smallBlind as number, bigBlind: value.bigBlind as number };
  // Only the installed rules generate genesis. No state snapshot, replay code,
  // proof module URL, or arbitrary rules identifier is accepted from the host.
  new PokerDealtBettingReplay(options);
  return Object.freeze({ protocol: PROTOCOL, rulesHash: POKER_INVITATION_RULES,
    nonce: digest(value.nonce), handId: digest(value.handId), chainId: Number(value.chainId), settler: address(value.settler),
    dealer: options.dealer, smallBlind: options.smallBlind, bigBlind: options.bigBlind, seats: Object.freeze(seats) });
}
function encode(value: Invitation): string { return pokerHistoryJSON(JSON.stringify(value)); }
export function createPokerInvitation(input: Omit<Invitation, 'protocol' | 'rulesHash' | 'nonce' | 'handId'>): string {
  const random = () => toHex(crypto.getRandomValues(new Uint8Array(32)));
  return encode(validate({ ...input, protocol: PROTOCOL, rulesHash: POKER_INVITATION_RULES, nonce: random(), handId: random() }));
}
export function parsePokerInvitation(wire: string): Invitation {
  requireThat(typeof wire === 'string' && wire.length <= 8192 && new TextEncoder().encode(wire).length <= 8192, 'size');
  const invitation = validate(JSON.parse(wire));
  requireThat(encode(invitation) === wire, 'canonical');
  return invitation;
}

/** Public invitation is a proposal, never independent authority. Require the
 * expected wallet roster/domain and this browser's identity from local sources
 * before constructing the enrollment review. Wallet approvals still follow. */
export function reviewPokerInvitation(wire: string, expected: {
  wallets: readonly Address[]; chainId: number; settler: Address; participant: Participant;
}) {
  const invitation = parsePokerInvitation(wire);
  requireThat(invitation.chainId === expected.chainId && invitation.settler === address(expected.settler), 'domain');
  requireThat(expected.wallets.length === invitation.seats.length
    && expected.wallets.every((wallet, seat) => address(wallet) === invitation.seats[seat].wallet), 'wallet_roster');
  const wallet = address(expected.participant.wallet), signingKey = address(expected.participant.signingKey);
  const seat = invitation.seats.findIndex(entry => entry.wallet === wallet);
  requireThat(seat >= 0 && invitation.seats[seat].signingKey === signingKey, 'local_identity');
  const replay = new PokerDealtBettingReplay({ stacks: invitation.seats.map(entry => entry.stack), dealer: invitation.dealer,
    smallBlind: invitation.smallBlind, bigBlind: invitation.bigBlind });
  const enrollment = new PokerHistoryEnrollment({ nonce: invitation.nonce, handId: invitation.handId,
    rulesHash: invitation.rulesHash, chainId: invitation.chainId, settler: invitation.settler,
    roster: invitation.seats.map(entry => entry.signingKey) }, replay.genesisJSON, replay.replay, expected.wallets);
  return Object.freeze({ invitation, seat, replay, enrollment });
}

/** Generate the session key here, never accept it from an invitation or export
 * it to other peers. This identity is ephemeral; disposing prevents later use. */
export function createPokerParticipant(wallet: Address) {
  const selectedWallet = address(wallet);
  let account: LocalAccount | undefined = privateKeyToAccount(generatePrivateKey());
  const publicIdentity = Object.freeze({ wallet: selectedWallet, signingKey: account.address });
  const signingAccount: Pick<LocalAccount, 'address' | 'signTypedData'> = Object.freeze({
    address: account.address,
    signTypedData: async data => {
      requireThat(account, 'participant_closed');
      const signature = await account.signTypedData(data);
      requireThat(account, 'participant_closed');
      return signature;
    },
  });
  return Object.freeze({ publicIdentity, signingAccount, dispose: () => { account = undefined; } });
}
