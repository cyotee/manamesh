# Experimental Poker shuffle admission

`ExperimentalPokerShuffleAdmission` connects the evaluated one-seat WASM worker
to Poker's wallet-admitted signing history and encryption-roster authorization.
It is not imported by the live Poker page or the public package API. The
candidate is still unaudited. It implements canonical private hole-card dealing
for 2–5 seats, checkpoint-authorized flop, turn and river decryption. Verified contested showdown and gross chip payouts are supported; settlement
remains unavailable.

The adapter owns the worker and checks an exact SHA-256 artifact pin before
instantiating it. It copies supplied module bytes, rejects oversized modules,
permits one outstanding worker request, and terminates on crashes, malformed
responses, timeouts or explicit disposal. Worker seeds are generated inside the
worker; neither seeds nor secret keys are returned. No raw worker handle or
unrestricted command method is exposed.

Use a locally wallet-admitted VerifiedPokerHistory, local seat and independently
agreed dealer index at creation. The history's session ID, table size and dealer
initialize the worker's version-seven proof contexts. The immutable canonical
deal plan is also bound into the signed roster's protocol digest. Collect the
public `ownAnnouncement` values, then call `reviewRoster` with the exact ordered
list. The worker validates canonical encodings, ownership proofs, distinct keys
and aggregate validity before the adapter exposes its PokerEncryptionRoster.
The local announcement must match the value generated inside that worker.
Invalid proof admission terminates the adapter; it cannot proceed to signing.

Retain a journal reference under `roster.journalSessionId` and call `signRoster`
with the admitted local session account and durable journal. Collect every
seat's signature, then call `authorize` with the roster's authorization envelope.
Shuffle methods refuse to run until roster authorization succeeds. Private
decryption also requires unanimous final-deck authorization, described below. This gate
is local trusted client code; an untrusted remote host cannot set an
`authorized` flag through the worker's public messages.

After every seat's shuffle has been independently verified, call `reviewDeck`.
It reads the transcript digest from the local worker; there is no host-supplied
head parameter. Call `signDeck` with the same journal reference used for roster
admission. This claims slot two of that purpose-specific journal before signing;
slot one remains the roster claim and gameplay has its own namespace. Changes
to deck, protocol or roster conflict with an existing deck claim. Exact retries
are permitted, including after a failed signing request.

Collect all deck signatures in `roster.deckEnvelope(localHead, signatures)` and
call `authorizeDeck`. It compares the envelope with the local worker's digest and
checks every admitted signing identity. Incomplete, forged, roster-only and
changed-deck approvals cannot enable private decryption. A valid shuffle proof
alone does not establish unanimous agreement on the final deck. This additional
gate prevents a remote host from obtaining contributions on divergent decks.
The raw standalone native harness has no wallet/journal authorization gate; this
adapter owns that application-level boundary.

Each private-card method requires its canonical deck position. Only the owner
can receive verified contributions and open that card; its own final contribution
never leaves the worker. Both hole cards of every seat are supported. Non-hole
positions, including burns and community cards, are refused. The dealer cannot
be changed after initialization; keys/proofs from another dealer are invalid.

Key recovery, aborts, live networking and external
security review remain required before production. The adapter does not expose
a recovery or key-replacement API. Losing a worker loses its ephemeral key.

## Validation

Build the pinned artifact using the root
`experiments/poker-shuffle/wasm/peers/README.md` instructions. From the monorepo
root, run:

```sh
POKER_SHUFFLE_WASM=/absolute/path/to/manamesh_shuffle_peer_check.wasm E2E_PORT=3107 yarn workspace @cyotee/manamesh test:e2e shuffle-admission.spec.ts
```

The test requires the exact evaluated artifact; it never downloads or bypasses
the pin. Local runs without the environment variable skip these experimental
cases; CI collection without it fails. The root quality workflow now has a
poker-shuffle job that builds the pinned artifact and runs the tests. That Linux
job still needs remote execution; local passes do not prove it succeeds there.

Four Chromium cases pass at 2–5 seats in separate browser contexts. They perform
wallet enrollment, local proof admission, durable roster authorization, all
shuffles and owner-only opening of every seat's two hole cards. Invalid
positions, including burn and community cards, are refused. They reject modified module bytes,
local-key substitution and forged authorization before shuffling. A subsequent
focused two-seat rerun also rejects a malformed ownership proof before further
signing. Frontend typecheck and root build pass. The test runner relays public
bytes; it does not exercise the live game's peer signaling or transport.

The final-deck authorization is still ephemeral in this adapter: no live-game
recovery or transcript-archive format for it is provided. The certified-deal wrapper below now binds initial preflop betting to the
accepted deck and private-deal completion. The standalone betting sub-state
helper does not enforce that boundary, and the current adapter now extends that boundary through showdown.

Final-deck validation: four Chromium cases pass at 2–5 seats, including withheld,
forged, roster-only and changed-head certificates before decryption. The Poker
roster/deck unit suite passes 18 cases; the three existing history-signer cases
also pass. Poker/frontend typechecks and root build pass. That validation used the earlier hole-only artifact. The flop extension below
requires the current version-four artifact pin.


`signDeal` requires both local canonical hole positions to have opened inside
this adapter. It signs a separate private-deal receipt in journal slot three;
opening the same position twice cannot satisfy the other position. The receipt
contains no card values. The browser harness now uses `PokerDealtBettingReplay`
to require every receipt before accepting the signed `beginBetting` transition,
then runs a complete preflop round. This supersedes the earlier separate,
ungated betting fixture for these shuffle-admission cases. It does not integrate the live Poker page.


After the certified-deal wrapper has committed a complete contested preflop
round, `authorizeFlop(replay)` derives permission from that exact bound local
history. It reads no host checkpoint argument. The worker binds public reveal
proofs to the final deck, committed betting checkpoint, position and contributing
seat. `makePublicContribution`, `receivePublicContribution` and `openPublicCard`
accept only the three canonical flop positions. Every seat's verified token is
required. While the flop is active, burns, hole cards, turn and river are refused by
these public APIs; later stages require their own authorization.
The private-card APIs retain their owner-only policy.

Authorization is idempotent at the same checkpoint; a changed checkpoint cannot
reuse the gate. If history advances while native authorization is pending, the
adapter terminates before releasing a public token. The native command does not
parse Poker rules: this local adapter is responsible for deriving permission
from the verified replay. The standalone native harness deliberately supplies
synthetic checkpoints to test cryptographic context binding.

Flop plaintexts can now be committed through the certified-deal replayer's
`revealFlop` transition. `bindFlop(replay)` requires every canonical flop position
to be in the adapter's local verified-opening cache; it has no host-card input.
Every peer independently matches proposed values against that evidence before
signing the transition. Postflop betting then runs with preserved pot and
hand-wide contributions. Proof archive recovery and live-game integration remain required.


`authorizePublicStreet(replay, street)` now advances sequentially through flop,
turn and river. Every authorization uses the matching current committed betting
checkpoint; neither an old checkpoint nor an old position remains usable after
advancement. The native worker additionally requires the preceding public cards
to have opened before authorizing the next stage. Burns never enter the public API; eligible private positions require the separate
showdown authorization. `bindPublicStreet` copies only verified local outputs
for the active stage into the replay boundary, which commits all three public
streets and supports betting through the river. Completed river betting permits the separate showdown authorization below.

This requires the current version-seven WASM pin. Earlier documented version-four
results concern the historical flop-only artifact; they are not accepted by the
current adapter.


The browser suite also covers uncontested completion after a certified private
deal: a fold leaves one live hand, the signed `finishUncontested` transition
computes payouts without supplied amounts, and every peer reaches the same
terminal balances and zero pot. It refuses forged payout fields, duplicate
completion and post-completion public reveals. The full-board scenarios continue through verified contested showdown.


`authorizeShowdown(replay)` derives the eligible-seat mask and checkpoint from
complete contested river betting. The worker releases owner-final contributions
only for these eligible positions; folded hands stay hidden. `bindShowdown`
requires all eligible positions in the public proof-verified cache and supplies
those values to the replayer. Private-opening readiness cannot bypass this gate.
Each peer verifies the proposed hands, evaluates strengths and computes gross
payouts before signing `finishShowdown`. The browser fixture compares every
revealed card with its earlier private opening and rejects substituted hands
before signing. All-in tabling before river, proof/key recovery, live transport
integration and settlement remain open.


Current validation (2026-09-06): six Chromium cases pass (2.9 minutes), covering
2–5-seat contested completion, a two-seat uncontested result and a three-seat
showdown with a folded hand. All reveals match prior private openings; forged
hands are refused before signing. Poker/frontend typechecks and the root build
pass. The current artifact reproduces byte-for-byte across two fresh local builds.


## Public shuffle-proof transport

`bindPokerShuffleProofs(channel, history, admission)` registers the native shuffle
verifier on an already-ready history channel. Its send method accepts an exact
8,979-byte public shuffle proof and an in-range step, then binds the local
session and committed checkpoint into the packet. Reception checks the exact
schema and size before calling the worker. The worker independently validates
the admitted roster, shuffle step, previous deck and proof.

`PokerHistoryChannel` supports one explicitly registered asynchronous artifact
verifier. Artifact payloads are limited to 32 KiB inside its existing bounded
fragment framing. It emits `artifact` only after verification succeeds and the
local checkpoint remains current. Missing verifiers, malformed/invalid proofs
and stale verification close the channel; table ownership propagates closure.
No history checkpoint is imported and no signature is produced by this path.
The send return value means queued, not remotely verified or unanimously approved.

The browser shuffle fixture now sends public proofs over production join-code
history channels. A guest sends to the relay, which verifies locally before
forwarding to the other guests; every receiver verifies independently. The
runner triggers each step and observes completion but does not relay proof bytes.
Roster/deck signatures still use fixture-controlled delivery and need separate
production integration. This
extension remains outside the live Poker page and uses the unaudited candidate.


Current proof-channel validation: 26 focused unit tests pass. All seven browser
scenarios have passing evidence across the main run and focused reruns, including
native rejection of a modified peer proof with no further deck signing. The
initial run included a four-seat timeout; the isolated case passed in 40.2
seconds under the unchanged 120-second deadline. See the root readiness report
for the interrupted retry and timing limitations.


## Public decryption contribution transport

The same registered verifier now accepts `public-contribution-v1` packets with
an exact 131-byte contribution/proof pair, a contributing seat and card position.
Session and checkpoint must match local history. The admission adapter then
requires that position to be authorized for the current street/showdown before
the worker validates the contribution. The packet cannot authorize a reveal.
Unknown types remain refused; private contributions use the separate operation
described below.

The fixture prepares each contribution locally and sends it over its peer link.
The relay verifies before forwarding, and every other seat independently verifies
before recording receipt. The runner observes receipt but never carries public
contribution bytes. This applies to flop, turn, river and eligible showdown hole
cards. Folded hands remain unopened; burns and future positions remain refused.
Private hole-card contributions use owner-aware routing as described below.


Public-contribution validation: 36 focused unit tests and all eight Chromium
scenarios pass in one run (9.6 minutes including startup). A modified flop
contribution is rejected by the real worker, closes the table, leaves the flop
unbound and produces no further signing. Frontend typecheck and build pass.
This supersedes the earlier seven-scenario partial-run evidence above.


## Private contribution review and delivery (version seven)

The native `review_token` operation checks a non-owner contribution against the
admitted public key, final deck, card position and owner-bound context. It returns
no bytes, retains no token and never uses the reviewer's secret key. It refuses
contributions attributed to the card owner. The original `receive_token` still
accepts shares only at the canonical owner; only `open_private_card` performs the
owner's final local decryption. `make_token` still refuses exporting that owner's
final contribution.

`acceptPrivateContribution` selects owner retention or review-only verification
from the immutable local deal plan. The private packet contains no plaintext or
owner-final contribution. Each peer verifies; the relay forwards only verified
packets, and only the owner retains the share for opening. The browser runner
triggers sends and observes receipts without carrying private contribution bytes.
Review-only receipts cannot satisfy the private-deal signing gate, which still
requires both actual owner-only card openings.

This requires the version-seven native artifact and proof-context suite. Earlier
artifacts are rejected by the module pin and must not be mixed within a hand.
The candidate remains unaudited; delivery tests do not constitute a cryptographic
security audit or live-game recovery implementation.


Private-delivery validation: 38 focused unit tests and all nine Chromium
scenarios pass (8.9 minutes including startup). The three-seat tampering case
verifies that a relay which does not own the card rejects the changed proof
before forwarding, without further deal signing. Two fresh native builds match
byte-for-byte, and raw 2–5-seat review/opening tests pass. Frontend typecheck and
build also pass. This supersedes the earlier private-routing limitation and
eight-scenario validation above; approval exchange and live integration remain.
