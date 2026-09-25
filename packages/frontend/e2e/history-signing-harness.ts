import { createPokerParticipant, createPokerInvitation, reviewPokerInvitation } from '../src/p2p/experimental/poker-session-invitation';
import { startPokerHandController } from '../src/p2p/experimental/poker-hand-controller';
import { startPokerProtectedSession } from '../src/p2p/experimental/poker-protected-session';
import { openPokerLocalHistory } from '../src/p2p/poker-local-history';
import { connectPokerProtocolSession } from '../src/p2p/experimental/poker-protocol-session';
import { connectPokerEnrollmentSession } from '../src/p2p/poker-enrollment-session';
import { PokerGameplayExchange } from '../src/p2p/poker-gameplay-exchange';
import { PokerProofExchange } from '../src/p2p/experimental/poker-proof-exchange';
import { connectPokerHistoryTable } from '../src/p2p/poker-history-table';
import { connectPokerHistory } from '../src/p2p/poker-join-session';
import { JoinCodeConnection } from '../src/p2p/discovery/join-code';
import { ExperimentalPokerShuffleAdmission } from '../src/p2p/experimental/poker-shuffle-admission';
// Browser-only test fixture. Not an application entry or a production key store.
import { PokerHistoryChannel, POKER_HISTORY_CHANNEL } from '../src/p2p/poker-history-channel';
import { privateKeyToAccount } from 'viem/accounts';
import { keccak256, toHex, type Address, type Hex, type LocalAccount } from 'viem';
import { IndexedDBPokerSigningJournal, POKER_SIGNING_DATABASE, PokerHistorySigner, PokerHistoryProposal, PokerEncryptionRoster, PokerDealtBettingReplay, VerifiedPokerHistory, PokerHistoryEnrollment,
  createPublicPokerBettingGenesis, replayPublicPokerBetting,
  IndexedDBPokerHistoryArchive, POKER_HISTORY_DATABASE, type PokerHistoryArchiveRef, type PokerHistoryCommitter,
  type PokerSigningJournalRef, type PokerApprovalKind } from '@manamesh/poker/verified-history';

const digest = (text: string) => keccak256(toHex(text));
let journal: IndexedDBPokerSigningJournal;
let signer: PokerHistorySigner;
let history: VerifiedPokerHistory;
let proposalRound: PokerHistoryProposal;
let calls = 0;
let failNext = false;
let signingGate: Promise<void> | undefined;
let releaseSigningGate: (() => void) | undefined;
export function holdSigningForTest() { signingGate = new Promise(resolve => { releaseSigningGate = resolve; }); }
export function releaseSigningForTest() { releaseSigningGate?.(); signingGate = undefined; releaseSigningGate = undefined; }
let rawAccount: LocalAccount;
let signingAccount: Pick<LocalAccount, 'address' | 'signTypedData'>;
let archive: IndexedDBPokerHistoryArchive;
let rtc: RTCPeerConnection;
let rtcData: RTCDataChannel;
let historyChannel: PokerHistoryChannel;
let channelEvents: { kind: string; sequence?: number; message?: string }[] = [];

function attachHistoryChannel(channel: RTCDataChannel) {
  rtcData = channel;
  historyChannel = new PokerHistoryChannel(channel, history);
  recordHistoryAdapter();
}
function recordHistoryAdapter() {
  const record = (event: { kind: string; sequence?: number; message?: string }) => {
    channelEvents.push(event);
    if (channelEvents.length > 32) channelEvents.shift();
  };
  historyChannel.addEventListener('proposal', () => record({ kind: 'proposal' }));
  historyChannel.addEventListener('acknowledgment', () => record({ kind: 'acknowledgment' }));
  historyChannel.addEventListener('checkpoint', event => record({ kind: 'checkpoint', sequence: (event as CustomEvent).detail.sequence }));
  historyChannel.addEventListener('rejected', event => record({ kind: 'rejected', message: (event as CustomEvent).detail.message }));
}
async function gatheredDescription() {
  if (rtc.iceGatheringState !== 'complete') await new Promise<void>((resolve, reject) => {
    const done = () => {
      if (rtc.iceGatheringState === 'complete') { cleanup(); resolve(); }
    };
    const timer = setTimeout(() => { cleanup(); reject(new Error('test_ice_timeout')); }, 10_000);
    const cleanup = () => { clearTimeout(timer); rtc.removeEventListener('icegatheringstatechange', done); };
    rtc.addEventListener('icegatheringstatechange', done);
    done();
  });
  return rtc.localDescription!.toJSON();
}
export async function createHistoryOffer() {
  rtc = new RTCPeerConnection({ iceServers: [] });
  channelEvents = [];
  attachHistoryChannel(rtc.createDataChannel(POKER_HISTORY_CHANNEL));
  await rtc.setLocalDescription(await rtc.createOffer());
  return gatheredDescription();
}
export async function acceptHistoryOffer(offer: RTCSessionDescriptionInit) {
  rtc = new RTCPeerConnection({ iceServers: [] });
  channelEvents = [];
  rtc.ondatachannel = event => attachHistoryChannel(event.channel);
  await rtc.setRemoteDescription(offer);
  await rtc.setLocalDescription(await rtc.createAnswer());
  return gatheredDescription();
}
export const finishHistoryAnswer = (answer: RTCSessionDescriptionInit) => rtc.setRemoteDescription(answer);
export const historyChannelOpen = () => rtcData?.readyState === 'open';
export const historyChannelEvents = () => channelEvents;
export const sendHistoryBatch = (wire: string) => historyChannel.sendBatch(wire);
/** Raw hostile-peer input; intentionally bypasses the production frame encoder. */
export const sendHistoryFrameForTest = (frame: string) => rtcData.send(frame);
export const closeHistoryConnection = () => { historyChannel?.dispose(); rtc?.close(); };

interface SessionInput { key: Hex; roster: Address[]; seat: number; reference?: PokerSigningJournalRef; mode?: 'betting' | 'dealtBetting'; dealer?: number }
const genesis = '{"count":0}';
const config = (roster: Address[]) => ({ nonce: digest('browser-nonce'), handId: digest('browser-hand'), rulesHash: digest('counter-rules-v1'),
  chainId: 31337, settler: roster[0], roster });
const replay = (state: string, actor: number, payload: string) => {
  const { amount } = JSON.parse(payload);
  if (actor !== 0 || !Number.isSafeInteger(amount) || amount <= 0) throw new Error('invalid_test_action');
  return JSON.stringify({ count: JSON.parse(state).count + amount });
};
let dealtBetting: PokerDealtBettingReplay | undefined;
function enrollment(input: { roster: Address[]; wallets: Address[]; mode?: 'betting' | 'dealtBetting'; dealer?: number }, persist?: PokerHistoryCommitter) {
  if (input.mode === 'dealtBetting') {
    dealtBetting = new PokerDealtBettingReplay({ stacks: Array(input.roster.length).fill(100), dealer: input.dealer ?? 0, smallBlind: 1, bigBlind: 2 });
    return new PokerHistoryEnrollment({ ...config(input.roster), rulesHash: digest('dealt-betting-browser-v5') },
      dealtBetting.genesisJSON, dealtBetting.replay, input.wallets, persist);
  }
  if (input.mode === 'betting') {
    const seats = input.roster.length;
    const bettingGenesis = createPublicPokerBettingGenesis({ stacks: Array(seats).fill(100),
      dealer: input.dealer ?? (seats === 2 ? 0 : (seats - 3) % seats), smallBlind: 1, bigBlind: 2 });
    return new PokerHistoryEnrollment({ ...config(input.roster), rulesHash: digest('public-betting-browser-v1') },
      bettingGenesis, replayPublicPokerBetting, input.wallets, persist);
  }
  return new PokerHistoryEnrollment(config(input.roster), genesis, replay, input.wallets, persist);
}
export function enrollmentData(input: { roster: Address[]; wallets: Address[]; seat: number; mode?: 'betting' | 'dealtBetting'; dealer?: number }) {
  const admission = enrollment(input);
  return { sessionId: admission.sessionId, typedData: admission.typedData(input.seat) };
}
export async function initializeEnrolled(input: SessionInput & { wallets: Address[]; enrollmentWire: string }) {
  const admission = enrollment(input);
  return attachSigner(input, await admission.admit(input.enrollmentWire));
}
export async function initialize(input: SessionInput) {
  return attachSigner(input, new VerifiedPokerHistory(config(input.roster), genesis, replay));
}
export async function initializeArchived(input: SessionInput & { wallets: Address[]; enrollmentWire: string; archiveReference?: PokerHistoryArchiveRef }) {
  if (Boolean(input.reference) !== Boolean(input.archiveReference)) throw new Error('test_recovery_references');
  prepareSigningAccount(input);
  localHistory = await openPokerLocalHistory({ admit: () => enrollment(input).admit(input.enrollmentWire),
    seat: input.seat, account: signingAccount,
    recovery: input.reference && input.archiveReference ? { journal: input.reference, archive: input.archiveReference } : undefined });
  ({ history, signer, archive, journal, signingAccount } = localHistory);
  return { journalReference: localHistory.journalReference, archiveReference: localHistory.archiveReference };
}
let localHistory: Awaited<ReturnType<typeof openPokerLocalHistory>> | undefined;
export const closeLocalHistory = () => localHistory?.dispose();
export const localHistoryClosed = () => localHistory?.closed;
/** Storage-only fixture: these public bytes are not native ownership proofs. */
export function prepareLocalEncryptionForTest(input: { protocol: Hex; announcements: Hex[] }) {
  if (!localHistory) throw new Error('test_local_history_required');
  return localHistory.prepareEncryptionSigning(new PokerEncryptionRoster(history, input.protocol, input.announcements));
}
export const closeArchive = () => archive.close();
/** Simulate damaged local storage; never used by the application. */
export async function damageArchiveForTest(reference: PokerHistoryArchiveRef, remove: boolean) {
  archive.close();
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(POKER_HISTORY_DATABASE, 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(['archives', 'batches'], 'readwrite');
      if (remove) tx.objectStore('archives').delete(reference.archiveId);
      else {
        const batch = tx.objectStore('batches').get([reference.archiveId, 1]);
        batch.onsuccess = () => {
          const entries = JSON.parse(batch.result);
          entries[0].stateHash = digest('corrupted-storage');
          tx.objectStore('batches').put(JSON.stringify(entries), [reference.archiveId, 1]);
        };
      }
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  });
}
let localDealer = 0;
function prepareSigningAccount(input: SessionInput) {
  localDealer = input.dealer ?? (input.roster.length === 2 ? 0 : (input.roster.length - 3) % input.roster.length);
  const base = privateKeyToAccount(input.key);
  rawAccount = base;
  calls = 0; failNext = false;
  const account: Pick<LocalAccount, 'address' | 'signTypedData'> = {
    address: base.address,
    signTypedData: async data => {
      calls++;
      if (failNext) { failNext = false; throw new Error('test_signing_failed'); }
      if (signingGate) await signingGate;
      return base.signTypedData(data);
    },
  };
  signingAccount = account;
}
async function attachSigner(input: SessionInput, admittedHistory: VerifiedPokerHistory) {
  prepareSigningAccount(input);
  history = admittedHistory;
  journal = await IndexedDBPokerSigningJournal.open();
  const reference = input.reference ?? await journal.create(history.sessionId, signingAccount.address);
  signer = new PokerHistorySigner(history, input.seat, signingAccount, journal, reference);
  return reference;
}
export const propose = (amount: number) => signer.propose(JSON.stringify({ amount }));
export const proposePoker = (payload: string) => signer.propose(payload);
export const checkpoint = () => history.checkpoint;
export const acknowledge = (wire: string) => signer.acknowledge(wire);
export const append = (wire: string) => history.append(wire);
export const signCount = () => calls;
export const rejectNextSignature = () => { failNext = true; };
export const closeStorage = () => journal.close();
/** Deliberately modified host for adversarial tests; never used by the application. */
export async function unsafeProposalForTest(amount: number) {
  const action = await history.prepareAction(0, JSON.stringify({ amount }));
  return { ...action, signature: await rawAccount.signTypedData(history.actionTypedData(action)) };
}
/** Bypasses the host's journal to model an attacker controlling that process. */
export async function unsafePokerProposalForTest(amount: number, falseState = false) {
  const action = await history.prepareAction(0, JSON.stringify({ move: 'raise', amount }));
  if (falseState) action.stateHash = digest('invented-chip-balances');
  return { ...action, signature: await rawAccount.signTypedData(history.actionTypedData(action)) };
}
export const eraseStorageForTest = () => new Promise<void>((resolve, reject) => {
  journal.close();
  const request = indexedDB.deleteDatabase(POKER_SIGNING_DATABASE);
  request.onsuccess = () => resolve(); request.onerror = () => reject(request.error);
});


export async function openProposal(wire: string) {
  proposalRound = await PokerHistoryProposal.review(history, wire);
  return proposalRound.missingSeats;
}
export async function collectAcknowledgment(wire: string) {
  await proposalRound.addAcknowledgment(wire);
  return proposalRound.missingSeats;
}
export const proposalBatch = () => proposalRound.batchJSON();
export const commitProposal = () => proposalRound.commit();


export async function proposeOverChannel(payload: string) {
  await historyChannel.sendProposal(JSON.stringify(await signer.propose(payload)));
}
export async function acknowledgeOverChannel(forgeSeat = false) {
  const proposal = historyChannel.pendingProposal;
  if (!proposal) throw new Error('test_no_proposal');
  const ack = await signer.acknowledge(proposal.proposalJSON);
  if (forgeSeat) {
    historyChannel.sendAcknowledgment(JSON.stringify({ ...ack, seat: 1 - ack.seat }));
  } else {
    await proposal.addAcknowledgment(JSON.stringify(ack));
    historyChannel.sendAcknowledgment(JSON.stringify(ack));
  }
}
export const channelMissingSeats = () => historyChannel.pendingProposal?.missingSeats;
export async function commitOverChannel() {
  const proposal = historyChannel.pendingProposal;
  if (!proposal) throw new Error('test_no_proposal');
  const wire = proposal.batchJSON();
  await proposal.commit();
  historyChannel.sendBatch(wire);
}

// Multi-peer star fixture: every guest keeps an independent admitted history.
const historyPeers = new Map<number, { connection: JoinCodeConnection; channel?: PokerHistoryChannel }>();
let historyTable: ReturnType<typeof connectPokerHistoryTable> | undefined;
let historyTableReady = false;
let historyTableClosed: string | undefined;
function newHistoryPeer() {
  return new JoinCodeConnection({ onStateChange: () => {}, onConnectionStateChange: () => {}, onMessage: () => {} });
}
export async function createHistoryPeerOffer(seat: number) {
  const connection = newHistoryPeer();
  historyPeers.set(seat, { connection });
  return connection.createGame();
}
export async function acceptHistoryPeerOffer(offer: string) {
  const connection = newHistoryPeer();
  historyPeers.set(0, { connection });
  return connection.joinGame(offer);
}
export const finishHistoryPeerAnswer = (seat: number, answer: string) => historyPeers.get(seat)!.connection.acceptAnswer(answer);
export const allHistoryPeerConnectionsOpen = () => historyPeers.size > 0 && [...historyPeers.values()].every(peer => peer.connection.isConnected());
export function startHistoryTable(seat: number) {
  historyTableReady = false; historyTableClosed = undefined;
  historyTable = connectPokerHistoryTable(new Map([...historyPeers].map(([peer, value]) => [peer, value.connection])), history, seat);
  void historyTable.ready.then(channels => {
    for (const entry of channels) {
      historyPeers.get(entry.seat)!.channel = entry.channel;
      historyChannel = entry.channel; recordHistoryAdapter();
    }
    historyTableReady = true;
  }, error => { historyTableClosed = String(error); });
  void historyTable.closed.then(reason => { historyTableReady = false; historyTableClosed = reason.message; });
}
export const historyTableStatus = () => ({ ready: historyTableReady, closed: historyTableClosed });
export function closeOneHistoryPeer(seat: number) { historyPeers.get(seat)!.connection.close(); }
export async function proposeToHistoryPeers(payload: string) {
  const wire = JSON.stringify(await signer.propose(payload));
  await Promise.all([...historyPeers.values()].map(peer => peer.channel!.sendProposal(wire)));
  const proposal = historyChannel.pendingProposal!;
  await proposal.addAcknowledgment(JSON.stringify(await signer.acknowledge(wire)));
}
export async function commitToHistoryPeers() {
  const proposal = historyChannel.pendingProposal!;
  const wire = proposal.batchJSON();
  await proposal.commit();
  for (const peer of historyPeers.values()) peer.channel!.sendBatch(wire);
}
export function closeHistoryPeers() {
  historyTable?.dispose();
  for (const peer of historyPeers.values()) { peer.channel?.dispose(); peer.connection.close(); }
  historyPeers.clear();
}


let encryptionRoster: PokerEncryptionRoster;
let encryptionReference: PokerSigningJournalRef;
export async function initializeEncryptionRoster(input: { protocol: Hex; announcements: Hex[]; reference?: PokerSigningJournalRef }) {
  encryptionRoster = new PokerEncryptionRoster(history, input.protocol, input.announcements);
  encryptionReference = input.reference ?? await journal.create(encryptionRoster.journalSessionId, rawAccount.address);
  return encryptionReference;
}
export const signEncryptionRoster = (seat: number, localAnnouncement: Hex) =>
  encryptionRoster.sign(seat, localAnnouncement, signingAccount, journal, encryptionReference);
export const verifyEncryptionRoster = (signatures: Hex[]) => encryptionRoster.verifyAuthorization(encryptionRoster.envelope(signatures));


let shuffleAdmission: ExperimentalPokerShuffleAdmission;
export async function initializeShuffleAdmission(wasm: number[], seat: number) {
  shuffleAdmission = await ExperimentalPokerShuffleAdmission.create(history, seat, new Uint8Array(wasm), localDealer);
  return shuffleAdmission.ownAnnouncement;
}
export async function reviewShuffleRoster(announcements: Hex[]) {
  await shuffleAdmission.reviewRoster(announcements);
  encryptionRoster = shuffleAdmission.roster;
  encryptionReference = await journal.create(encryptionRoster.journalSessionId, rawAccount.address);
}
export const signShuffleRoster = () => shuffleAdmission.signRoster(signingAccount, journal, encryptionReference);
export const authorizeShuffleRoster = (signatures: Hex[]) => shuffleAdmission.authorize(shuffleAdmission.roster.envelope(signatures));
export async function shuffleCommand(op: 'shuffle' | 'receive' | 'token' | 'receiveToken' | 'open', index = 0, bytes: number[] = [], position = 0) {
  if (op === 'shuffle') return [...await shuffleAdmission.makeShuffle()];
  if (op === 'receive') return [...await shuffleAdmission.receiveShuffle(index, new Uint8Array(bytes))];
  if (op === 'token') return [...await shuffleAdmission.makePrivateContribution(position)];
  if (op === 'receiveToken') return [...await shuffleAdmission.receivePrivateContribution(position, index, new Uint8Array(bytes))];
  return [...await shuffleAdmission.openPrivateCard(position)];
}
export const closeShuffleAdmission = () => shuffleAdmission?.dispose();

export const shuffleDealPlan = () => shuffleAdmission.dealPlan;

export const signShuffleDeck = () => shuffleAdmission.signDeck(signingAccount, journal, encryptionReference);
export const reviewShuffleDeck = () => shuffleAdmission.reviewDeck();
export async function authorizeShuffleDeck(wire: string) {
  await shuffleAdmission.authorizeDeck(wire);
  dealtBetting?.bindDeck(history, shuffleAdmission.roster, await shuffleAdmission.reviewDeck());
}
export async function shuffleDeckEnvelope(signatures: Hex[]) {
  return shuffleAdmission.roster.deckEnvelope(await shuffleAdmission.reviewDeck(), signatures);
}

export const signShuffleDeal = () => shuffleAdmission.signDeal(signingAccount, journal, encryptionReference);
export async function shuffleDealEnvelope(signatures: Hex[]) {
  return shuffleAdmission.roster.dealEnvelope(await shuffleAdmission.reviewDeck(), signatures);
}

export const authorizeShuffleFlop = () => shuffleAdmission.authorizeFlop(dealtBetting!);
export async function publicShuffleCommand(op: 'token' | 'receive' | 'open', position: number, seat = 0, bytes: number[] = []) {
  if (op === 'token') return [...await shuffleAdmission.makePublicContribution(position)];
  if (op === 'receive') return [...await shuffleAdmission.receivePublicContribution(position, seat, new Uint8Array(bytes))];
  return [...await shuffleAdmission.openPublicCard(position)];
}

export const bindShuffleFlop = () => shuffleAdmission.bindFlop(dealtBetting!);

export const authorizeShuffleStreet = (street: 'flop' | 'turn' | 'river') => shuffleAdmission.authorizePublicStreet(dealtBetting!, street);
export const bindShuffleStreet = (street: 'flop' | 'turn' | 'river') => shuffleAdmission.bindPublicStreet(dealtBetting!, street);

export const authorizeShuffleShowdown = () => shuffleAdmission.authorizeShowdown(dealtBetting!);
export const bindShuffleShowdown = () => shuffleAdmission.bindShowdown(dealtBetting!);


let joinHistory: JoinCodeConnection;
let joinGameMessages: string[] = [];
function newJoinHistory() {
  joinGameMessages = []; channelEvents = [];
  joinHistory = new JoinCodeConnection({ onStateChange: () => {}, onConnectionStateChange: () => {},
    onMessage: data => joinGameMessages.push(data) });
}
export async function createJoinHistoryOffer(automatic = false) {
  newJoinHistory();
  const code = await joinHistory.createGame();
  if (!automatic) joinHistory.registerReliableChannel(POKER_HISTORY_CHANNEL, attachHistoryChannel);
  return code;
}
export async function acceptJoinHistoryOffer(code: string, automatic = false) {
  newJoinHistory();
  const answer = await joinHistory.joinGame(code);
  if (!automatic) joinHistory.registerReliableChannel(POKER_HISTORY_CHANNEL, attachHistoryChannel);
  return answer;
}
export const finishJoinHistoryAnswer = (code: string) => joinHistory.acceptAnswer(code);
export const joinHistoryConnected = () => joinHistory.isConnected();
export const openJoinHistoryChannel = () => { joinHistory.openReliableChannel(POKER_HISTORY_CHANNEL); };
export const sendJoinGameMessage = (data: string) => joinHistory.send(data);
export const receivedJoinGameMessages = () => joinGameMessages;
let joinSession: ReturnType<typeof connectPokerHistory> | undefined;
let joinReady = false;
let joinReadyError: string | undefined;
let joinClosedReason: string | undefined;
export function startJoinHistoryReady(seat: number) {
  joinReady = false; joinReadyError = undefined; joinClosedReason = undefined;
  joinSession = connectPokerHistory(joinHistory, history, seat, 1 - seat);
  void joinSession.ready.then(adapter => { historyChannel = adapter; recordHistoryAdapter(); joinReady = true; },
    error => { joinReadyError = String(error); });
  void joinSession.closed.then(reason => { joinReady = false; joinClosedReason = reason.message; });
}
export const joinHistoryReady = () => ({ ready: joinReady, error: joinReadyError, closed: joinClosedReason });
export const closeJoinHistory = () => { joinSession?.dispose(); historyChannel?.dispose(); joinHistory?.close(); };


let proofExchange: PokerProofExchange;
export function attachTableShuffleProofs(localSeat: number) {
  proofExchange = new PokerProofExchange(new Map([...historyPeers].map(([seat, peer]) => [seat, peer.channel!])), history, shuffleAdmission, localSeat);
}
export const proofExchangeStatus = () => ({ closed: proofExchange.closed, reason: proofExchange.closeReason, workerClosed: shuffleAdmission.closed });
function hostileArtifact(fields: object) {
  const wire = JSON.stringify({ ...fields, sessionId: history.sessionId, checkpoint: history.checkpoint.head });
  for (const peer of historyPeers.values()) peer.channel!.sendArtifact(wire);
}
export async function shuffleOverTable(actor: number, tamper = false) {
  if (!tamper) return proofExchange.shuffle();
  const proof = await shuffleAdmission.makeShuffle(); proof[proof.length - 1] ^= 1;
  hostileArtifact({ type: 'shuffle-proof-v1', step: actor, proof: toHex(proof) });
}
export const tableShuffleSteps = () => proofExchange.shuffleSteps;
const preparedPublicContributions = new Map<string, Uint8Array>();
const publicContributionKey = (position: number, seat: number) => `${history.checkpoint.head}:${position}:${seat}`;
export async function preparePublicTableContribution(position: number, seat: number) {
  preparedPublicContributions.set(publicContributionKey(position, seat), await proofExchange.preparePublic(position));
}
export function sendPublicTableContribution(position: number, seat: number, tamper = false) {
  if (!tamper) return proofExchange.sendPreparedPublic(position);
  const stored = preparedPublicContributions.get(publicContributionKey(position, seat));
  if (!stored) throw new Error('test_public_contribution_unprepared');
  const proof = Uint8Array.from(stored); proof[proof.length - 1] ^= 1;
  hostileArtifact({ type: 'public-contribution-v1', position, seat, proof: toHex(proof) });
}
export const hasPublicTableContribution = (position: number, seat: number) => proofExchange.hasPublic(position, seat);
export async function sendPrivateTableContribution(position: number, seat: number, tamper = false) {
  if (!tamper) return proofExchange.sendPrivate(position);
  const proof = await shuffleAdmission.makePrivateContribution(position); proof[proof.length - 1] ^= 1;
  hostileArtifact({ type: 'private-contribution-v1', position, seat, proof: toHex(proof) });
}
export const hasPrivateTableContribution = (position: number, seat: number) => proofExchange.hasPrivate(position, seat);
export async function sendTableApproval(kind: PokerApprovalKind, seat: number, forgeSeat?: number) {
  const signature = kind === 'roster' ? await signShuffleRoster() : kind === 'deck' ? await signShuffleDeck() : await signShuffleDeal();
  if (forgeSeat === undefined) return proofExchange.approve(kind, signature);
  await shuffleAdmission.receiveApproval(kind, seat, signature);
  hostileArtifact({ type: 'approval-v1', kind, seat: forgeSeat, signature });
}
export const missingTableApprovals = (kind: PokerApprovalKind) => shuffleAdmission.approvalProgress[kind];
export const tableApprovalEnvelope = (kind: PokerApprovalKind) => shuffleAdmission.approvalEnvelope(kind);
export async function authorizeTableApproval(kind: 'roster' | 'deck') {
  const wire = shuffleAdmission.approvalEnvelope(kind);
  if (kind === 'roster') await shuffleAdmission.authorize(wire);
  else await authorizeShuffleDeck(wire);
  if (protectedSession) await (await protectedSession.ready).synchronize(`${kind}-approved`);
}

let gameplayExchange: PokerGameplayExchange;
export function attachTableGameplay(seat: number) {
  gameplayExchange = new PokerGameplayExchange(new Map([...historyPeers].map(([peer, value]) => [peer, value.channel!])), history, signer, seat);
}
export const proposeTableGameplay = (payload: string) => gameplayExchange.propose(payload);
export const acknowledgeTableGameplay = () => gameplayExchange.acknowledge();
export const commitTableGameplay = () => gameplayExchange.commit();
export const tableGameplayStatus = () => ({ canPropose: gameplayExchange.canPropose, ready: gameplayExchange.proposalReady, missing: gameplayExchange.missingSeats, closed: gameplayExchange.closed, closeReason: gameplayExchange.closeReason });

let bootstrapExchange: ReturnType<typeof connectPokerEnrollmentSession>;
let bootstrapCloseReason: string | undefined;
let bootstrapEnrollment: PokerHistoryEnrollment;
let bootstrapWallet: LocalAccount | undefined;
let bootstrapSeat = 0;
export function startEnrollmentBootstrap(input: SessionInput & { wallets: Address[]; walletKey?: Hex }) {
  bootstrapEnrollment = enrollment(input);
  bootstrapWallet = input.walletKey ? privateKeyToAccount(input.walletKey) : undefined;
  bootstrapSeat = input.seat;
  prepareSigningAccount(input); bootstrapCloseReason = undefined;
  bootstrapExchange = connectPokerEnrollmentSession(new Map([...historyPeers].map(([peer, value]) => [peer, value.connection])), bootstrapEnrollment, input.seat, signingAccount);
  void bootstrapExchange.closed.then(reason => { bootstrapCloseReason = reason.message; disposeEnrollmentReview?.(); });
}
let disposeEnrollmentReview: (() => void) | undefined;
export async function mountEnrollmentApproval() {
  disposeEnrollmentReview?.();
  const [{ createElement }, { createRoot }, { PokerEnrollmentApproval }] = await Promise.all([
    import('react'), import('react-dom/client'), import('../src/pages/poker/PokerEnrollmentApproval'),
  ]);
  const element = document.createElement('div'); document.body.append(element);
  const root = createRoot(element);
  root.render(createElement(PokerEnrollmentApproval, { enrollment: bootstrapEnrollment, localSeat: bootstrapSeat,
    provider: (window as unknown as { ethereum: import('../src/blockchain/liveFromInjected').InjectedEthereum }).ethereum,
    onApproval: signature => bootstrapExchange.submitApproval(signature) }));
  disposeEnrollmentReview = () => { root.unmount(); element.remove(); disposeEnrollmentReview = undefined; };
}
export const enrollmentBootstrapStatus = () => ({ ready: bootstrapExchange.registered || bootstrapExchange.stage === 'ready', missing: bootstrapExchange.missingSeats, closed: bootstrapExchange.stage === 'closed', reason: bootstrapCloseReason, stage: bootstrapExchange.stage });
export async function approveEnrollmentBootstrap() {
  const signature = await bootstrapWallet!.signTypedData(bootstrapEnrollment.typedData(bootstrapSeat));
  await bootstrapExchange.submitApproval(signature);
}
export async function initializeArchivedFromBootstrap(_input?: SessionInput & { wallets: Address[] }) {
  if (bootstrapExchange.missingSeats.length) throw new Error('poker_enrollment:incomplete');
  localHistory = await bootstrapExchange.ready;
  disposeEnrollmentReview?.(); bootstrapWallet = undefined;
  ({ history, signer, archive, journal, signingAccount } = localHistory);
  return { journalReference: localHistory.journalReference, archiveReference: localHistory.archiveReference };
}
export const closeEnrollmentBootstrap = () => { bootstrapExchange.dispose(); bootstrapWallet = undefined; };

export async function sendTableAnnouncement(seat: number, tamper = false) {
  if (!tamper) return proofExchange.announce();
  const own = shuffleAdmission.ownAnnouncement;
  await shuffleAdmission.receiveAnnouncement(seat, own);
  const wire = `${own.slice(0, -2)}${(parseInt(own.slice(-2), 16) ^ 1).toString(16).padStart(2, '0')}` as Hex;
  hostileArtifact({ type: 'announcement-v1', seat, announcement: wire });
}
export const missingTableAnnouncements = () => shuffleAdmission.missingAnnouncements;

export async function prepareTableRosterSigning() {
  const roster = shuffleAdmission.roster;
  if (!localHistory) throw new Error('test_local_history_required');
  encryptionReference = await localHistory.prepareEncryptionSigning(roster);
  encryptionRoster = roster;
  return encryptionReference;
}

let protocolSession: ReturnType<typeof connectPokerProtocolSession> | undefined;
export function startPokerProtocolSession(seat: number) {
  historyTableReady = false; historyTableClosed = undefined;
  if (!localHistory) throw new Error('test_local_history_required');
  protocolSession = connectPokerProtocolSession(new Map([...historyPeers].map(([peer, value]) => [peer, value.connection])), localHistory, shuffleAdmission, seat);
  void protocolSession.ready.then(value => {
    for (const entry of value.channels) {
      historyPeers.get(entry.seat)!.channel = entry.channel;
      historyChannel = entry.channel; recordHistoryAdapter();
    }
    proofExchange = value.proofs; gameplayExchange = value.gameplay;
    historyTableReady = true;
  }, error => { historyTableClosed = String(error); });
  void protocolSession.closed.then(reason => { historyTableReady = false; historyTableClosed = reason.message; });
}

let protectedSession: ReturnType<typeof startPokerProtectedSession> | undefined;
export function startProtectedPoker(wasm: number[]) {
  if (!localHistory) throw new Error('test_local_history_required');
  historyTableReady = false; historyTableClosed = undefined;
  protectedSession = startPokerProtectedSession(new Map([...historyPeers].map(([peer, value]) => [peer, value.connection])), localHistory, new Uint8Array(wasm), localDealer);
  void protectedSession.ready.then(value => {
    shuffleAdmission = value.admission; protocolSession = value.protocol;
    for (const entry of value.channels) {
      historyPeers.get(entry.seat)!.channel = entry.channel;
      historyChannel = entry.channel; recordHistoryAdapter();
    }
    proofExchange = value.proofs; gameplayExchange = value.gameplay; historyTableReady = true;
  }, error => { historyTableClosed = String(error); });
  void protectedSession.closed.then(reason => { historyTableReady = false; historyTableClosed = reason.message; });
}
export const localShuffleAnnouncement = () => shuffleAdmission.ownAnnouncement;
export const pokerProtocolSessionStage = () => protectedSession?.stage ?? protocolSession?.stage;


/** Hold worker initialization delivery to exercise cancellation deterministically. */
export async function cancelProtectedStartupForTest(wasm: number[]) {
  if (!localHistory) throw new Error('test_local_history_required');
  const originalPost = Worker.prototype.postMessage; const originalTerminate = Worker.prototype.terminate;
  let initialized!: () => void; const started = new Promise<void>(resolve => { initialized = resolve; });
  let terminations = 0;
  Worker.prototype.postMessage = function(this: Worker, message: unknown) {
    if ((message as { op?: string }).op === 'initialize') { initialized(); return; }
    originalPost.call(this, message);
  };
  Worker.prototype.terminate = function(this: Worker) { terminations++; originalTerminate.call(this); };
  const session = startPokerProtectedSession(new Map([...historyPeers].map(([peer, value]) => [peer, value.connection])), localHistory, new Uint8Array(wasm), localDealer);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([started, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('test_worker_start_timeout')), 10_000); })]);
    session.dispose();
    const reason = await session.ready.then(() => 'unexpected_ready', error => String(error));
    return { reason, terminations, stage: session.stage, localClosed: localHistory.closed };
  } finally {
    clearTimeout(timer); session.dispose();
    Worker.prototype.postMessage = originalPost; Worker.prototype.terminate = originalTerminate;
  }
}

export async function dealProtectedPrivateCards() {
  if (!protectedSession) throw new Error('protected_session_missing');
  const runtime = await protectedSession.ready;
  const first = runtime.dealPrivateCards();
  if (runtime.dealPrivateCards() !== first) throw new Error('private_deal_retry_not_shared');
  return first;
}

export async function revealProtectedStreet(street: 'flop' | 'turn' | 'river') {
  if (!protectedSession || !dealtBetting) throw new Error('protected_session_missing');
  const runtime = await protectedSession.ready;
  const first = runtime.revealPublicStreet(dealtBetting, street);
  if (runtime.revealPublicStreet(dealtBetting, street) !== first) throw new Error('public_retry_not_shared');
  return first;
}
export async function revealProtectedShowdown() {
  if (!protectedSession || !dealtBetting) throw new Error('protected_session_missing');
  const runtime = await protectedSession.ready;
  const first = runtime.revealShowdown(dealtBetting);
  if (runtime.revealShowdown(dealtBetting) !== first) throw new Error('showdown_retry_not_shared');
  return first;
}

export async function exchangeProtectedAnnouncements() {
  if (!protectedSession) throw new Error('protected_session_missing');
  const runtime = await protectedSession.ready;
  const first = runtime.exchangeAnnouncements();
  if (runtime.exchangeAnnouncements() !== first) throw new Error('announcement_retry_not_shared');
  return (await first).announcements;
}
export async function shuffleProtectedDeck() {
  if (!protectedSession) throw new Error('protected_session_missing');
  const runtime = await protectedSession.ready;
  const first = runtime.shuffleDeck();
  if (runtime.shuffleDeck() !== first) throw new Error('shuffle_retry_not_shared');
  return first;
}

let handController: ReturnType<typeof startPokerHandController> | undefined;
export function startProtectedHandController() {
  if (!protectedSession || !localHistory || !dealtBetting || handController) throw new Error('controller_state');
  handController = startPokerHandController(protectedSession, localHistory, dealtBetting);
}
export const protectedHandStatus = () => handController?.snapshot;
export const stopProtectedHandController = () => handController?.dispose();

export async function mountProtectedTable() {
  if (!localHistory || !protectedSession || !handController) throw new Error('protected_table_state');
  const [{ createElement }, { createRoot }, { PokerProtectedTable }] = await Promise.all([
    import('react'), import('react-dom/client'), import('../src/pages/poker/PokerProtectedTable'),
  ]);
  const runtime = await protectedSession.ready;
  const element = document.createElement('div'); document.body.append(element);
  createRoot(element).render(createElement(PokerProtectedTable, { local: localHistory, runtime, controller: handController }));
}

let invitationParticipant: ReturnType<typeof createPokerParticipant> | undefined;
export function createLocalPokerParticipant(wallet: Address) {
  if (invitationParticipant) throw new Error('participant_already_created');
  invitationParticipant = createPokerParticipant(wallet);
  return invitationParticipant.publicIdentity;
}
export const makePokerInvitation = (input: Parameters<typeof createPokerInvitation>[0]) => createPokerInvitation(input);
export function startInvitationBootstrap(input: { wire: string; wallets: Address[]; chainId: number; settler: Address; walletKey: Hex }) {
  if (!invitationParticipant) throw new Error('participant_missing');
  const reviewed = reviewPokerInvitation(input.wire, { wallets: input.wallets, chainId: input.chainId,
    settler: input.settler, participant: invitationParticipant.publicIdentity });
  bootstrapEnrollment = reviewed.enrollment; dealtBetting = reviewed.replay;
  bootstrapSeat = reviewed.seat; localDealer = reviewed.invitation.dealer;
  bootstrapWallet = privateKeyToAccount(input.walletKey);
  const base = invitationParticipant.signingAccount;
  calls = 0; failNext = false;
  signingAccount = { address: base.address, signTypedData: async data => { calls++; return base.signTypedData(data); } };
  bootstrapCloseReason = undefined;
  bootstrapExchange = connectPokerEnrollmentSession(new Map([...historyPeers].map(([peer, value]) => [peer, value.connection])), bootstrapEnrollment, bootstrapSeat, signingAccount);
  void bootstrapExchange.closed.then(() => invitationParticipant?.dispose());
}
export const openInvitationHistory = () => initializeArchivedFromBootstrap();
