import { getAddress, type LocalAccount } from 'viem';
import {
  IndexedDBPokerHistoryArchive, IndexedDBPokerSigningJournal, PokerHistorySigner,
  type PokerHistoryFactory, type PokerHistoryArchiveRef, type PokerSigningJournalRef, type PokerEncryptionRoster,
} from '@manamesh/poker/verified-history';

/** Local, independently reviewed enrollment factory only; never a host snapshot.
 * Recovery requires both original references and re-verifies the public archive.
 * This does not recover private worker keys or authorize continuing a lost hand.
 */
export async function openPokerLocalHistory(input: {
  admit: PokerHistoryFactory;
  seat: number;
  account: Pick<LocalAccount, 'address' | 'signTypedData'>;
  recovery?: { archive: PokerHistoryArchiveRef; journal: PokerSigningJournalRef };
  storage?: IDBFactory;
}) {
  const seat = input.seat;
  const account = input.account;
  const recovery = input.recovery && { archive: { ...input.recovery.archive }, journal: { ...input.recovery.journal } };
  if (recovery && (!input.recovery?.archive || !input.recovery.journal)) throw new Error('poker_local:recovery_references');
  let archive: IndexedDBPokerHistoryArchive | undefined;
  let journal: IndexedDBPokerSigningJournal | undefined;
  let closed = false;
  let resolveClosed!: (reason: Error) => void;
  const whenClosed = new Promise<Error>(resolve => { resolveClosed = resolve; });
  let activeAccount: typeof account | undefined = account;
  const live = () => { if (closed) throw new Error('poker_local:closed'); };
  const dispose = (reason = new Error('poker_local:disposed')) => {
    if (closed) return;
    closed = true; activeAccount = undefined; journal?.close(); archive?.close();
    resolveClosed(reason);
  };
  try {
    const admitted = await input.admit();
    if (admitted.signerAt(seat) !== getAddress(account.address)) throw new Error('poker_local:identity_mismatch');
    if (recovery && (recovery.archive.sessionId !== admitted.sessionId || recovery.journal.sessionId !== admitted.sessionId
      || getAddress(recovery.journal.signer) !== getAddress(account.address))) throw new Error('poker_local:recovery_identity');
    archive = await IndexedDBPokerHistoryArchive.open(input.storage);
    const saved = recovery
      ? { history: await archive.resume(recovery.archive, () => admitted), reference: recovery.archive }
      : await archive.create(() => admitted);
    journal = await IndexedDBPokerSigningJournal.open(input.storage);
    const journalReference = recovery?.journal ?? await journal.create(saved.history.sessionId, account.address);
    const signingAccount: typeof account = Object.freeze({
      address: account.address,
      signTypedData: async data => {
        live();
        const signature = await activeAccount!.signTypedData(data);
        live();
        return signature;
      },
    });
    const signer = new PokerHistorySigner(saved.history, seat, signingAccount, journal, journalReference);
    let preparedRoster: PokerEncryptionRoster | undefined;
    let preparation: Promise<Readonly<PokerSigningJournalRef>> | undefined;
    /** Explicit preparation after native roster review; this never signs.
     * Exact concurrent retries share one creation. A different roster cannot
     * replace that choice, and public-history recovery cannot recreate keys.
     */
    function prepareEncryptionSigning(roster: PokerEncryptionRoster): Promise<Readonly<PokerSigningJournalRef>> {
      try {
        live();
        if (recovery) throw new Error('poker_local:encrypted_recovery_unavailable');
        if (roster.sessionId !== saved.history.sessionId || saved.history.checkpoint.sequence !== 0) throw new Error('poker_local:encryption_context');
        if (preparedRoster && preparedRoster !== roster) throw new Error('poker_local:encryption_roster_changed');
        if (preparation) return preparation;
        preparedRoster = roster;
        preparation = journal!.create(roster.journalSessionId, signingAccount.address).then(reference => {
          live();
          return Object.freeze({ ...reference });
        }).catch(error => {
          dispose(error instanceof Error ? error : new Error('poker_local:encryption_storage'));
          throw error;
        });
        return preparation;
      } catch (error) { return Promise.reject(error); }
    }
    return Object.freeze({ seat, history: saved.history, signer, signingAccount, journal, archive, prepareEncryptionSigning,
      journalReference: Object.freeze({ ...journalReference }), archiveReference: Object.freeze({ ...saved.reference }),
      get closed() { return closed; }, whenClosed, dispose });
  } catch (error) {
    dispose();
    // Keep any durable records already created. Deleting them could erase a
    // signing claim; retry/recovery must be explicit and retain their identity.
    throw error;
  }
}
