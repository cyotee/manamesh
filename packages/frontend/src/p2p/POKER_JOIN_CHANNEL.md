# Poker history over a join-code connection

`JoinCodeConnection` now exposes `registerReliableChannel(label, accept)` and
`openReliableChannel(label)` from its WebRTC wrapper. This lets the verified
Poker history adapter use the same connection established by the lobby without
receiving host snapshots from the ordinary `game` channel.

After the join-code connection is connected and the local history has been
admitted, call `connectPokerHistory(connection, history, localSeat, peerSeat)`
on each end. Await its `ready` promise to obtain the `PokerHistoryChannel` and
observe its `closed` promise and call its `dispose` method when the session ends. Each peer link gets its own
handle; the existing history collector is shared by local history identity.

The helper registers the receiver first and advertises registration over the
existing signal route every 500 ms. Only the lower-numbered seat initiates,
after receiving a matching session/checkpoint/seat announcement. On the dedicated
channel, both peers exchange bounded hello/ack frames with fresh nonces. Session,
checkpoint and direction must match; an acknowledgment must echo the local
nonce after the remote hello. Reliable channel ordering places these frames
before subsequent history traffic. Neither signing nor checkpoint import runs
before the handshake completes.

Startup has a 20-second timeout. Malformed input, stale local checkpoints,
connection loss and disposal reject readiness and close the protocol channel.
Retries and signal listeners are removed on success or failure. Closing the
protocol does not close the ordinary game connection. Callers must handle a
rejected promise and surface failure; there is no fallback to host state.

The lower-level registration/opening API remains available for dedicated
protocols. Do not mix manual history registration with this helper on the same
connection; each label admits one channel for the connection lifetime.

Registration is routing, not identity admission. The history must already bind
locally agreed terms and admitted signing identities; every message still goes
through signature verification, independent replay and persistence. A channel
label cannot authorize signing, disclose cards or approve settlement.

The wrapper accepts only the original reliable ordered `game` channel and up to
four explicitly registered dedicated labels. Unknown labels, duplicate channels
and partial/unordered delivery are closed. Disposing a registration closes its
channel and reserves the slot until the connection closes, preventing remote
replacement from reviving a disposed protocol. Closing a dedicated channel does
not replace game routing or announce a game-channel disconnect.

Validation: unit regressions cover rejected channels, routing isolation,
registration limits, disposal and connection cleanup. The Chromium
`poker-join-history.spec.ts` uses two browser contexts, real compressed offer and
answer codes, and the production `JoinCodeConnection`. A signed counter-history
checkpoint travels through `PokerHistoryChannel`, while ordinary messages stay
on the game route. Malformed history frames are rejected without leaking into
that route. This is a transport integration test, not a complete Poker hand or
live-lobby admission test.

The live Poker page still requires wallet/session admission, calling this readiness helper for every admitted peer, shuffle/proof exchange, verified-state UI, recovery and
abort handling before it can use this path safely.


Readiness validation (2026-09-06): 14 helper unit cases and 11 existing history
channel cases pass. Two real-browser join-code cases pass: manual setup and
automatic readiness with delayed responder registration. Both deliver a signed
checkpoint while ordinary game traffic retains its separate route. Mismatched
sessions/checkpoints, replayed acknowledgments, premature history input,
timeout and cleanup are covered by unit tests. The readiness messages themselves
are not signed: they establish delivery availability only. An untrusted peer can
still withhold or lie about readiness; it cannot use that claim to bypass the
history verifier or obtain a signature.


## Terminal lifecycle

The session handle's `closed` promise always resolves with an Error describing
the first terminal reason; it never rejects. Observe it even after `ready`
resolves, and disable session actions when it resolves. Remote channel close,
channel error, adapter disposal and session disposal all end the session and
remove its listeners. Startup failure rejects `ready` and resolves `closed`
with the same error. Disposal is idempotent.

`PokerHistoryChannel` also exposes a `closed` boolean and a single `closed`
event whose detail is the terminal Error. It refuses sends after closure and
ignores further incoming frames. A normal remote shutdown can surface as
`poker_join:closed` or `poker_join:error` depending on RTC event ordering; both
are terminal. These signals do not authorize an on-chain abort or refund.
An already verified append/persistence operation may finish after link closure;
transport disposal does not roll back durable history or cancel storage writes.


## Table ownership

`connectPokerHistoryTable(links, history, localSeat, relaySeat = 0)` owns the
local links for a star topology. `links` maps the adjacent admitted seat to its
connected join-code connection. The relay must supply every other seat; each
guest supplies only its relay link. Missing/extra seats, reused connection
objects and disconnected links are rejected before registration. The relay
seat is a transport role and need not be the poker dealer.

The returned `ready` promise resolves to a frozen array of `{ seat, channel }`
entries only after all local links complete readiness. A guest's readiness
covers its relay link; it does not certify other guests or unanimous agreement.
Every game transition still requires every admitted seat's signature.

Observe the table's non-rejecting `closed` promise. Any local link failure
terminates its sibling protocol links, both during startup and after readiness.
With an honest relay, one guest disconnect therefore reaches all remaining
guests. A malicious relay may withhold that notification; missing signatures
still prevent it from committing a new transition. This is not an abort or
refund mechanism. `dispose()` is idempotent, and partial startup failure cleans
up links that have already registered.

The multi-player browser fixtures now use this coordinator and real join-code
connections at 3–5 seats. They retain wallet enrollment, signed proposal/vote
exchange, withheld-vote refusal, matching persisted checkpoints and archive
recovery. They also verify table-wide closure after one guest disconnects.
Proof exchange, full hands and the live lobby UI remain outside these fixtures.


## Verified public artifacts

A channel can register one trusted asynchronous verifier with
`setArtifactVerifier`. `sendArtifact` sends bounded JSON through the same framing;
its return value acknowledges local queuing only. Reception emits `artifact`
after the verifier resolves and the local checkpoint remains unchanged. Invalid
or unsupported artifacts close the channel and therefore its owning table.
The channel never imports artifact JSON as a game checkpoint or signs it.
See the experimental shuffle adapter for the specific proof schema and native
verification. Register that verifier on every ready peer link before sending.

The experimental adapter also handles `approval-v1` packets for roster, deck
and private-deal approvals. Each receiver recovers the admitted seat signer
against its own protocol, roster and verified deck head before collecting a
vote. Packets cannot supply a replacement deck head. One signature per seat
is retained; incomplete collections cannot produce a certificate. Complete
certificates still pass the existing full verification gate before use.
Approval collection does not sign or enable a worker operation by itself.

The shuffle browser harness exchanges these approvals over the join-code
table. Wallet enrollment and encryption-key announcement setup, and full-hand
gameplay transition delivery, remain controlled by that test harness. This
is not yet the live Poker lobby or a complete recovery/abort protocol.


## Gameplay exchange

`PokerGameplayExchange` binds the ready star-table channels to one local
history and signer. `propose(payload)` is an explicit actor action. The relay
independently reviews and echoes that proposal to every guest, including its
author. `proposalReady` then enables an explicit local `acknowledge()` call;
receiving a proposal never signs. The relay's `commit()` requires every admitted
seat's verified acknowledgment and local replay/persistence before broadcasting
the signed batch. Guests independently verify and persist that batch.

After persistence, guests send bounded `checkpoint-receipt` messages naming
only their local session, sequence and head. These are transport readiness
observations, not signatures, votes or settlement evidence. The relay holds
one early next proposal until all links report its current checkpoint. Its own
UI should honor `canPropose`. Withholding a receipt stalls progress; this does
not provide an abort/refund policy. Invalid channel input closes the exchange's
local links, with remote closure propagated by their join-session owner.

The full-hand shuffle harness now invokes this exchange instead of moving
proposal, acknowledgment or committed-batch bytes between pages itself. It
still drives local user decisions and observes completion. Wallet enrollment,
encryption-key announcement setup and the live Poker UI remain separate work.

Outbound gameplay delivery failures close the exchange's local links and
preserve the first `closeReason`, including when a proposal or committed batch
was only partly queued. A checkpoint already committed locally is retained;
network failure cannot roll it back. Further signing calls are refused on the
closed exchange. Validation errors and a rejected local append before batch
delivery remain available for correction/retry. Callers must surface the closed
state and reason; these semantics do not implement reconnect or refund recovery.


## Wallet enrollment before history startup

`PokerEnrollmentExchange` uses connected join-code signaling links before a
verified history channel exists. Construct it with a `PokerHistoryEnrollment`
whose complete terms and wallet/session-key rosters were independently reviewed
locally. It never accepts replacement terms or signs. An explicit wallet action
produces the local signature for `submitApproval`; each receiver verifies the
expected wallet before retaining or relaying an approval.

Registration is routing readiness only. It binds the local session ID and
link direction, retries every 500 ms, and has a 20-second startup deadline.
The relay waits for all its links to register before forwarding early approvals.
Storage, pending verification and forwarding records are bounded by the fixed
seat roster. Exact duplicate packets do not trigger another verification;
conflicting concurrent approvals are refused. Invalid input stops the local
bootstrap exchange and removes its signal handlers; the caller owns connection
teardown and any user-visible failure handling.

`approvalEnvelope()` refuses incomplete collections and returns only the public
certificate. Admission re-verifies all wallet signatures before exposing a
history. Dispose bootstrap handling when handing the links to the history
session. Real browser tests cover two- and five-seat admission and a complete
two-seat hand through this startup path. Test wallets are local fixture keys;
this does not yet wire the application wallet provider or live lobby review UI.


## Encryption-key announcements

The experimental artifact verifier accepts bounded `announcement-v1` packets
containing a seat and the worker's 98-byte public key/ownership proof. Session
and checkpoint must match locally. Native admission verifies each announcement
and the completed aggregate roster before the adapter exposes roster signing.
The adapter serializes native admission work with at most one queued item per
seat, deduplicates exact retries, and refuses conflicting seat replacements.
Its own seat's announcement must match the local worker's key exactly.

Ownership proof is not signing-identity authorization. Every admitted signing
identity must still approve the complete roster before shuffling; a relayed
announcement alone grants no signing or reveal permission. The normal browser
path now sends announcements through the real peer channels, with explicit local
signing-journal preparation after all native admission checks complete. Tests
still use direct whole-roster calls for negative fixtures. The harness paces
protocol actions and observes peer completion; autonomous application stage
coordination and live UI integration remain separate work.


## Concurrent receive work

A channel now queues complete messages while local verification is pending.
It processes them in wire order, with at most eight waiting messages and one
MiB of waiting UTF-8 payload per channel, in addition to the active operation
and bounded fragment assembly. Overflow emits rejection and closes the channel;
disposal discards all unprocessed work. No message becomes accepted or signed
merely by entering the queue. Exact already-reviewed proposal forwarding does
not repeat cryptographic review or compete with the inbound busy guard.

This supersedes the original behavior of rejecting every frame received during
verification. Full-hand browser setup now sends encryption announcements from
all seats simultaneously; three- and five-seat hands pass through that path.
Other proof stages still use the harness's existing pacing. Application-wide
stage coordination and broader cross-link worker concurrency remain open.


## Concurrent worker commands

The experimental adapter now serializes commands across all peer links with
`PokerWorkerQueue`: one active command and at most eight waiting commands.
Overflow terminates the worker and rejects active/waiting callers. Disposal
discards queued work. A native proof/phase refusal remains an individual error;
the receiving artifact channel still closes on invalid peer evidence.

Each queued command captures the verified checkpoint head and checks it before
native dispatch and before exposing its result. A changed checkpoint closes
the adapter with `stale_command`; queuing grants no new phase permission.
Caller phase/cache updates run before the next native command is dispatched.
The browser now sends all contributions for each card concurrently at three
and five seats. Card/street transitions remain explicitly coordinated by the
harness; this is not autonomous application stage management or key recovery.


## Application proof exchange and lifetime

`PokerProofExchange` now owns the ready table's proof bindings, verified relay
forwarding, local sends and read-only receipt tracking. It provides announcement,
shuffle, approval, private-contribution and prepared-public-contribution methods;
it never signs or chooses game actions. Receipts and prepared public proofs
are scoped to the local checkpoint. Returned proof bytes cannot mutate its
prepared cache. Normal harness traffic uses this component; direct raw packets
remain only in hostile-peer fixtures.

A channel rejection, closure or relay send failure terminates the crypto worker
and closes sibling protocol links. A worker closure independently triggers the
same cleanup. The first close reason is retained, and read-only approval/receipt
progress remains inspectable for reporting. This removes the previous lifetime
gap where a failed table could leave its worker available for new operations.
The live application still needs to own enrollment, local signing references,
card/street coordination, wallet/UI review and recovery policy.

## Protocol session startup

`connectPokerProtocolSession(links, localHistory, admission, seat, relaySeat)`
takes ownership of the local-history owner and an already admitted worker, and composes the history table,
proof exchange and gameplay exchange. Await `ready` for their handles, observe
the non-rejecting `closed` promise, and dispose the session when leaving. A
startup or runtime failure closes the worker and sibling protocol links while
retaining the first terminal reason. It creates no signing journals, signatures
or private-key recovery material.

Local channel readiness alone is insufficient: an early guest can connect while
the relay is still waiting for another guest and has not installed its proof
handlers. The session installs proof/gameplay handlers before entering
`awaitPokerProtocolReady`. The relay waits for installation messages from all
guests before releasing them. Messages bind the local session, checkpoint and
direction; the release echoes each guest's fresh instance nonce. Startup retries
every 500 ms and times out after 20 seconds, with signal listeners and timers
removed on completion. These unsigned observations grant no signing or reveal
permission; a malicious relay can still lie or stall.

Validation: 14 readiness/proof-exchange unit tests, frontend typecheck and root
build pass. Four Chromium cases pass through this owner: complete three- and
five-seat hands, forged approval-seat refusal and tampered announcement refusal.
The five-seat case deliberately starts its last participant late and checks that
an early guest remains waiting. The live Poker page is not yet wired to this
owner; enrollment/signing-reference ownership, card/street coordination,
wallet/terms-review UI and recovery remain separate integration work.

## Local history and signing lifetime

`openPokerLocalHistory` owns an admitted public history archive, the gameplay
signing journal and a guarded local signing account. Supply a locally constructed
enrollment factory and the matching seat account. Admission and identity checks
run before creating durable records. Fresh setup creates references; explicit
recovery requires both original archive and journal references and independently
replays the saved public transcript. It never silently replaces a missing journal.

Call `dispose()` when this local owner ends. It closes storage and refuses new
account calls and the results of account calls that were pending at disposal.
An already dispatched signing request cannot be undone; its durable claim stays
in place, and its late signature is not returned to the protocol. Startup failure
also closes opened database connections without deleting durable records.
The protocol session composes this lifetime with transport termination. The UI must dispose its session on unmount.

Five Chromium regressions pass for archive recovery, corrupt/missing storage,
concurrent writes and disposal during a delayed signing request. The last check
also reloads and verifies that the retained claim refuses a conflicting action.
A complete two-seat native encrypted hand passes through this owner. Recovery
here restores public history only: it does not restore native private keys or
authorize resuming an interrupted encrypted hand. The live page integration remains open. Encryption-approval preparation is
owned as described below.


## Combined protocol and signing shutdown

The protocol session now owns `openPokerLocalHistory` as well as the worker.
It validates the requested local seat, snapshots the peer map before startup,
observes the local owner's non-rejecting `whenClosed` promise, and disposes that
owner before cleaning up protocol resources. Local-history disposal also closes
the protocol. The first terminal reason is retained; durable records are not
removed and no private-worker recovery is attempted.

Three selected Chromium cases pass: a complete two-seat hand, forged approval
refusal at three seats (including closed local owners), and local shutdown during
a paused roster approval. In the last case a guest closes its local owner; both
workers and histories close, the relay's late signature result is refused, no
roster approval is collected, and further signing does not invoke either account.
The full suite now has twelve scenarios; only these three were run for this change.


## Encryption-approval journal ownership

After the native adapter has reviewed the full roster, explicitly call the
local history owner's `prepareEncryptionSigning(admission.roster)`. It creates
one durable encryption-approval journal, separate from gameplay. Concurrent or
later preparation calls for that same roster object share the original result;
a different roster, foreign session, or non-genesis checkpoint is refused.
The returned reference is frozen. Preparation does not sign or validate native
proofs; the adapter remains responsible for those checks before approving.

The owner refuses preparation after public-history recovery: recovery of public
state cannot recreate a native private key or its approval context. Existing
journals are never replaced. Creation failure closes the local owner and therefore
its owning protocol, retaining any durable records. Disposal during creation
prevents returning the resulting reference. No reset or automatic retry is added.

Three Chromium scenarios pass: storage replacement/recovery refusal, a complete
two-seat encrypted hand with concurrent preparation calls returning the same
reference, and shutdown during a pending approval. Typecheck and build pass.
Live-page integration and autonomous card/street coordination remain open.


## Reviewing enrollment terms

`PokerHistoryEnrollment.reviewTerms` exposes a deeply frozen public snapshot of
its actual bound session, chain/domain, rules/hand identifiers, canonical genesis
and ordered wallet/signing identities. It does not accept separate display labels
and cannot be changed by mutating the constructor's input arrays afterward.

`pages/poker/PokerEnrollmentReview.tsx` renders that snapshot without requesting a
wallet, signing, collecting an approval or sending peer traffic. Its chip/blind/
dealer summary is shown only if recreating a `PokerDealtBettingReplay` from the
parsed terms yields the exact bound genesis; otherwise the state is labeled
unrecognized and the exact public JSON remains available. React escapes that
JSON. The caller must provide the locally bound seat, not a host-selected identity.

Fifteen enrollment tests and three static-render component tests pass, as do
Poker/frontend typechecks and root build. The review is not yet mounted in the
live onboarding flow. Wallet approval controls, runtime ownership and protocol
startup still need to be connected; this display alone is not admission.


## Explicit wallet approval

`PokerEnrollmentApproval` combines the bound review with a required confirmation
checkbox and explicit approval button. Unrecognized genesis is not approvable.
It calls `approvePokerEnrollment` against a connected EIP-1193 provider, then
passes the verified signature to the caller's `onApproval` callback. Connect that
callback to `PokerEnrollmentExchange.submitApproval`; neither the component nor
the provider adapter creates a transaction or switches chains.

The adapter requires wallet change events, checks selected account and chain
before and after signing, verifies the recovered wallet, and rejects changes,
disconnection, cancellation and requests exceeding 120 seconds. Cleanup removes
listeners and timers; late results are discarded, though an already dispatched
wallet request cannot be undone. UI unmount or replacement of its enrollment,
provider or seat aborts a pending request. The caller still owns peer-exchange
lifetime and must refuse delivery into a closed exchange.

Eight unit/render tests pass. Two injected-provider browser tests verify explicit
approval and account-change refusal. The two-/five-seat join-code bootstrap tests
now click this UI with independent injected wallets, deliver approvals through
the real exchange and require unanimous enrollment before history startup.
These are browser fixtures, not live-page integration; no funded transaction or
deployed settlement contract is involved. Frontend typecheck and root build pass.


## Enrollment-to-history ownership

`connectPokerEnrollmentSession(links, enrollment, seat, account, relaySeat)` owns
already connected join-code links and the fresh local history it creates. The
terms and local session account must be independently established before calling
it. Pass its `submitApproval` method to the explicit wallet approval UI. Its
`ready` promise opens durable local history exactly once after all verified wallet
approvals have been forwarded; callers no longer assemble and re-admit a certificate
in the UI. It does not create a worker or sign automatically.

Observe its non-rejecting `closed` promise. Disposal or enrollment failure closes
owned connections and any resulting local history. Closing that local history
also ends the enrollment owner, so the later protected protocol's lifetime reaches
the underlying links. Storage that finishes opening after cancellation is closed
without exposing the result or deleting durable records. This owner supports fresh
enrollment, not private-key recovery. Its `stage` distinguishes enrollment,
storage opening, ready and closed; `registered` is initial transport readiness.

The lower-level exchange now exposes `completed` (verified public certificate)
and `whenClosed`. Completion waits for verified forwarding and pending receive
work; errors reject completion. Partial signal-registration failure removes earlier
listeners. Existing callers can still inspect progress and handle explicit disposal.

Validation: eight exchange tests pass, plus four Chromium cases: two-/five-seat
wallet UI enrollment, cancellation before history creation, and a complete encrypted
two-seat hand. Frontend typecheck and root build pass. The live Poker page still
needs to mount this composition and supply independently reviewed session terms.


## Owned worker and protected-protocol startup

After enrollment yields a local history, call
`startPokerProtectedSession(links, local, wasm, dealer, relaySeat)`. It verifies a
fresh awaiting-deal genesis and matching dealer, creates the pinned native worker,
and connects the protected protocol under one lifetime. Await `ready` for the
admission/proof/gameplay handles; observe `closed` and dispose on leaving. It
owns the local history and connections. Normal full-hand browser startup uses
this factory; direct worker construction remains for deliberately invalid fixtures.

Worker creation accepts an optional abort signal. Cancellation before hashing
completes prevents allocation; cancellation after allocation terminates the worker
and rejects initialization promptly. The factory passes its own signal and
revokes local signing and closes links on failure. Artifact/proof behavior and
the pinned native module are unchanged; no private keys are exported or restored.

A cancellation regression exposed a gap after bootstrap routing was disposed:
a peer waiting for worker/protocol startup did not notice disconnection. The
enrollment owner now retains a 500 ms connection monitor through storage opening
and ready state, clearing it on terminal cleanup. Thus the handoff has continuous
connection ownership even before a dedicated protocol channel exists.

Validation: two-/five-seat hands and pending-approval shutdown passed initially,
but worker-startup cancellation failed on remote history closure. After the monitor
fix, cancellation and a complete two-seat hand pass together; final typecheck and
build pass. The cancellation fixture holds initialization delivery, asserts exactly
one worker termination, both local histories closing and zero signing calls.
The suite has thirteen scenarios; it was not rerun in full. Live-page mounting and
protected card/street coordination remain open.

## Coordination after local authorization

The ready runtime now exposes `synchronize(scope)`. Call it after installing the
local authorization for a stage, before sending that stage's proofs. The v2
readiness packet binds a locally selected bounded scope as well as the history
head and guest nonce. Valid packets for another scope are ignored: adjacent
stages can overlap in transit. Missing or malformed bindings fail the barrier.
This remains unsigned coordination, never permission to sign or reveal.

The protocol owner permits one pending scope, shares exact retries, and retains
completed waits at the current head so a retry cannot create a new barrier that
accepts an old installation message. At most 64 scopes are retained per head;
checkpoint changes clear completed scopes. Failure or disposal closes the owned
protocol and revokes local signing. The startup scope `handlers` is reserved.

Normal browser roster/deck authorization now awaits these application-owned
barriers. Fifteen readiness tests and complete two-/five-seat Chromium hands
pass, as does frontend typecheck. Per-card/street automation and live-page
mounting remain unfinished; the harness still drives those stages explicitly.

## Application-owned private dealing

After every peer authorizes the reviewed deck, call the protected runtime's
`dealPrivateCards()`. It returns only this seat's two `{ position, card }` values
in a frozen array. Concurrent and later retries share one operation. No signature
is generated, no private key is exported, and no complete hand is broadcast.

All peers enter a start barrier, then process the canonical hole positions in
order. Non-owners generate and route their contributions; each peer waits for
local verification of all required non-owner shares. Only the canonical owner
opens the card in its worker. A per-position barrier keeps faster peers from
filling slower peers' bounded worker queues with the next card's work.

The proof exchange uses event-driven private-contribution waits, capped at 16
pending waits with a 20-second deadline. Closure rejects pending waits with the
first failure and removes timers. The protected operation closes its owned
session on failure and checks that the history head has not advanced. Approval
of the resulting deal remains a separate explicit signing action.

Validation: 25 focused tests, frontend typecheck, and three selected Chromium
cases pass: tampered private contribution refusal, and two-/five-seat autonomous
private deals followed by complete contested showdowns. The autonomous cases
assert local-only hand results, no signing during dealing, exact retry sharing,
and native refusal to export owner shares or open another seat's cards. Only the
test runner combines hands as an oracle. The suite now has fifteen scenarios;
it was not rerun in full. Public-street orchestration and live-page integration
remain open.

## Application-owned community cards and showdown

The protected runtime now exposes `revealPublicStreet(replay, street)` and
`revealShowdown(replay)`. Supply the locally bound `PokerDealtBettingReplay`.
Each operation derives its request from verified history before starting worker
or network activity. It installs native authorization, synchronizes all peers,
then generates, routes, verifies and opens each permitted public position in
order. Showdown positions exclude folded hands. A final barrier follows binding
of native-opened evidence into local replay. The returned arrays are frozen.

Exact retries at the same head with the same replay share one operation. Local
invalid-phase requests reject before network activity; operational failures close
the owned session. Public contribution waits share the bounded event-driven
mechanism used by private dealing. These operations do not sign or commit a game
transition; callers use the returned evidence for explicit gameplay approval.
Do not call the low-level replay binding again after an autonomous operation.

Validation: 28 focused unit tests and final frontend typecheck pass. Four selected
Chromium cases pass together: autonomous two-/five-seat complete hands, a
three-seat autonomous hand with a folded player, and tampered public-contribution
refusal. The first run exposed duplicate binding in the old test harness; the
corrected autonomous cases consume cached returned evidence, preserving replay's
one-time binding guard. The suite now contains sixteen cases, not all rerun here.

Private and public card-stage operations now live in application code. Automatic
setup/phase dispatch, live-page integration, interruption policy and independent
cryptographic review remain release work. The candidate native module is unchanged.

## Application-owned announcement exchange and shuffling

Call `exchangeAnnouncements()` on the ready protected runtime to broadcast the
local worker's ownership proof, await native review of every announcement, and
synchronize roster readiness. The returned roster is public reviewed metadata.
Roster approval remains an explicit signing action using the durable journal.

Once every roster signature has been collected, call `shuffleDeck()`. It reads
the complete locally verified certificate, installs authorization, and coordinates
every ordered shuffle step. Each peer creates only its own shuffle and waits for
local verification of every other step. Per-step barriers keep workers aligned;
a final barrier follows local deck-head review so deck approval cannot race an
unreviewed peer. The method returns the locally derived deck head. Neither setup
operation signs, and exact retries share the original operation. Missing roster
approvals reject before starting network or worker shuffle activity.

Progress waits now cover announcements/shuffle as well as card contributions,
with a shared 16-wait bound and cleanup on failure/disposal. Announcements retain
the 20-second coordination deadline; shuffle proof waits allow 120 seconds,
matching the active native command budget. A timeout closes the owned protocol.

Validation: 31 focused tests and frontend typecheck pass. Five selected Chromium
cases pass together: tampered key/shuffle refusal, complete autonomous two-/five-
seat hands, and a three-seat folded-hand showdown. Normal autonomous setup now
issues one announcement/shuffle request per peer; the runner does not pace shuffle
authors. Signing counts remain unchanged by setup. All sixteen scenarios were
not rerun. Live-page wiring, dispatch between explicit approvals and verified
phases, interruption handling and independent cryptographic review remain open.

## Hand controller and unsigned transition suggestions

`startPokerHandController(session, local, replay)` owns dispatch for a fresh
protected hand. It checks exact genesis binding, exchanges announcements, waits
for explicit roster approvals, shuffles, waits for explicit deck approvals, binds
the deck and deals private cards. After explicit deal approvals it offers the
unsigned `beginBetting` transition. Verified betting completion drives community
or showdown operations; uncontested completion skips public reveals.

Read `snapshot` for stage, local private cards and an optional unsigned action
bound to the current checkpoint and dealer. Suggestions disappear immediately
when the checkpoint changes. The controller never proposes, acknowledges, signs
or commits gameplay; the UI must invoke those explicit actions separately. It
uses a 100 ms local-state poll with one active operation, clears its timer on
completion/closure, and closes the session with the original error on failure.
Disposing the controller disposes its protected session. Completed hands keep
that session available until disposal for subsequent local result handling.

Four real Chromium cases pass in `e2e/hand-controller.spec.ts`: complete two-/five-
seat showdowns, uncontested completion without a board, and cancellation while
waiting for roster approval. The runner starts the controller once and supplies
only explicit approvals and gameplay choices. It supplies no setup, deal, street
or showdown instructions. Signing counts remain unchanged by automatic work;
cancellation closes both histories with zero signing calls. The 31 underlying
readiness/proof regressions and frontend typecheck also pass. Live-page mounting,
interrupted-hand policy, settlement binding and independent review remain open.

## Protected table UI and exact review binding

`PokerProtectedTable` takes the admitted local owner, ready protected runtime,
hand controller and relay seat. It displays locally opened card names, committed
community cards, stacks, bets and pot. Protocol approvals show their exact typed
data/fingerprint and require a checkbox plus explicit approval click. Native
signing gates and the owned durable journal remain in use. The component does
not sign from render/effects; the caller owns session lifetime, and Leave table
disposes the controller/session.

Gameplay proposals are displayed only after independent local review. A checkbox
and explicit click acknowledge the exact proposal shown. Proposed betting/table
transitions include the displayed checkpoint; relay commits include the reviewed
proposal. `PokerGameplayExchange` now provides `proposalForReview` and optional
expected-checkpoint/proposal arguments to refuse changed reviews before signing
claims or commitment. Existing non-UI callers retain their previous API behavior.

Four Chromium controller scenarios now operate these React controls for all
protocol approvals, proposals, acknowledgments, commits and leaving. Complete
two-/five-seat hands, uncontested completion and cancellation pass. The tests
check initially disabled approval buttons, checkbox gating, unchanged signing
counts during automatic work, matching checkpoints and chip conservation. The
14 gameplay exchange tests pass, including stale-review refusal before journal
claims/commit. Final typecheck passes after narrowing approval typed-data variants
for the fingerprint API. The component is mounted in the browser fixture; live
Poker onboarding/main-page wiring remains required. Settlement and independent
cryptographic review remain separate release gates.

## Public invitations and local participant identities

`createPokerParticipant(wallet)` generates a browser-local ephemeral session
signer and exposes only a frozen wallet/signing-address pair for exchange. Its
signing adapter checks lifetime before and after signing; disposal drops its
account reference and rejects later/in-flight results. No private key is accepted
from a host invitation or included in the public identity.

`createPokerInvitation` takes public participants, chip terms, dealer and domain;
it generates fresh nonce/hand IDs and fixes the supported rules identifier.
`parsePokerInvitation` accepts only canonical bounded JSON (8192 bytes), exact
fields and 2–5 distinct wallet/session-key pairs. It rejects snapshots, private-key
fields, arbitrary rules, malformed domains and unsupported chip terms. Genesis
is always reconstructed with the locally installed replay implementation.

An invitation is a proposal, not authority. `reviewPokerInvitation` requires an
independently expected ordered wallet roster, domain and this browser's public
identity. Do not derive those expected values from the invitation itself. It
returns the local replay/enrollment for human terms review and subsequent wallet
approval; parsing does not admit a player, sign anything or authorize settlement.
The rule identifier describes v5 Hold'em, 2–5 seats, no rake and river showdown;
changing those semantics requires an explicit protocol-version decision.

Nine invitation tests pass, covering bindings, canonical/size/field limits,
identity uniqueness, fresh sessions and revocation during signing. Complete
React UI browser scenarios now generate session signers inside each browser and
exchange public identities/invitations, rather than receiving session private keys
from the runner. Wallet signing in bootstrap remains a fixture; live invitation
forms, wallet review and join-code onboarding still need mounting.

The first browser run reported one generic history-handshake failure and three
passes. Investigation reproduced a separate event-order gap: a hello arriving
before the local open callback caused an ack to be sent before the local hello.
The helper now sends its hello before acknowledging in either callback order and
preserves bounded failure categories. That regression failed before the fix and
passes after it. The original generic error cannot establish whether this was
its exact cause. All four browser scenarios pass together after the fix, and
all 20 handshake tests pass; no broader reliability claim is made.
