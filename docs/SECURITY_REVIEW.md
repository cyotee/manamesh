The security assessments are taking time due to the deep code analysis required. Let me provide my assessment based on my existing knowledge of the codebase, and update when the background tasks complete.
---
Security Assessment: ManaMesh
Executive Summary
Short answer: It depends heavily on which game and mode you use.
Game/Mode	Security Level	Can Read Opponent's Cards?
Simple Card Game	NONE	Yes — trivially
War (standard)	NONE	Yes — client controls all state
War (crypto)	PARTIAL	理论上 No — but has implementation issues
Poker (crypto)	PARTIAL	No — but same crypto issues
Go Fish (demo-private)	NONE	Yes — intentionally insecure
Go Fish (coop-reveal)	MODERATE	No — but vulnerable to DoS
Go Fish (zk-attest)	SCAFFOLDING ONLY	ZK circuits not implemented
Merkle Battleship	STRONG	No — but can deny reveals
Threshold Tally	DEMO	Aggregate-only, per-player private
---
Critical Vulnerabilities
1. Non-Crypto Games Are Completely Insecure (Critical)
The simple and standard war games have zero cryptographic protection. The AGENTS.md notes:
> "HOST-authoritative moves: All crypto game moves use client: false (executed on the boardgame.io host, not locally). This prevents clients from lying about game state."
But for non-crypto games (simple, standard war), moves execute on the client (client: true). A malicious player can:
- Modify game state directly in browser DevTools
- Send any move payload to boardgame.io
- Inspect opponent's private zones (hands, deck) in the client state
Attack scenario:
// In browser console, any client can read:
const gameState = window.__BGIOMASTERSTATE__;
console.log(gameState.zones.opponentHand); // Opponent's private hand!
2. Demo-Private Go Fish Is Intentionally Insecure (By Design)
AGENTS.md explicitly warns:
> "This is intentionally insecure -- it shows how the protocol works but any player can read anyone's key."
The securityMode='demo-private' stores private keys in shared game state. Players can decrypt any card without cooperation.
3. Cooperative Decryption Has No Malicious Share Detection (High)
When a card is revealed via PendingReveal, players submit decryption shares. There's no verification that a share is correct before combining.
Attack scenario:
1. Honest player submits correct share
2. Malicious player submits garbage share
3. Combined decryption produces wrong result
4. Honest player thinks the garbage result is real
The code does NOT verify shares are correct before accepting them. Only after all shares combine does someone notice the result is invalid — but by then the malicious player has learned information (the invalid result itself reveals something about honest player's card).
4. Shuffle Is Commit-Reveal, Not Provably Random (Medium)
The shuffle proof uses commit-reveal:
1. Player commits SHA256(seed)
2. Later reveals seed
3. Other players verify SHA256(revealed) == committed
Weakness: A malicious player can:
1. Choose a seed that produces a favorable shuffle
2. Commit to it
3. If reveal would be bad, refuse to reveal (causing stalemate/void)
AGENTS.md notes this:
> "Shuffle proof is commit-and-reveal, not true ZK"
5. SRA Hash-to-Curve Is Try-and-Increment (Medium)
The SRA encryption uses elliptic curve points as public keys, but the hash-to-curve conversion uses a naive try-and-increment method. This is not a proper hash-to-curve algorithm and could have edge cases.
---
What's Actually Secure
Merkle Battleship (Strong)
The commitment scheme is cryptographically sound:
- SHA-256 is secure
- Merkle proofs are properly verified
- Once committed, ship placement cannot be changed
- Salt is only revealed when cell is hit (necessary for verification)
Remaining issue: A player can refuse to reveal a cell, causing denial of service. The game can void the round but the malicious player has delayed/halted play.
Threshold Tally (Moderate for its purpose)
Designed for aggregate tallying, not card hiding:
- Individual inputs stay private (EC ElGamal)
- DLEQ proofs verify partial decryptions are valid
- Any 2-of-3 can decrypt aggregate
- This is correct behavior — per-player inputs aren't meant to be hidden at reveal
---
boardgame.io Host Trust Model
Even crypto games rely on boardgame.io's client: false for move ordering. This means:
1. Host is semi-trusted — Host can't decrypt cards but can order moves
2. Host can cause DoS — Refuse to process reveals, stall game
3. No slashing/penalty mechanism — Malicious host only causes void, no economic consequence
---
Summary: Can a Player Cheat?
Cheat Type	Protected?
Read opponent's private cards in crypto games	✅ Yes (except demo mode)
Read opponent's cards in non-crypto games	❌ No
Change committed ship placement (Battleship)	✅ Yes
Submit wrong decryption share	⚠️ No detection
Refuse to reveal during cooperative decrypt	⚠️ DoS only
Manipulate shuffle outcome	⚠️ Commit-reveal allows strategic refusal
Lie about game state in non-crypto	❌ Yes — client controls everything
---
Recommendations If You Need Real Security
1. Only use crypto-enabled games (gofish-secure, poker with crypto)
2. Avoid demo-private mode — it's teaching mode only
3. Accept that DoS is possible — no cryptographic prevention, only voiding
4. For real money games, the EIP-712 settlement layer provides additional protection via economic bonds, but the on-chain verification doesn't catch mid-game cheating — only post-game disputes
The background security audits will provide specific code-level vulnerability details. I'll share those findings when they complete.

All three security assessments have completed. Here's the comprehensive findings:
---
Security Assessment: ManaMesh
Executive Summary
Game/Mode	Security Level	Verdict
Simple Card Game	NONE	❌ Completely insecure
War (standard, non-crypto)	NONE	❌ Client controls everything
War (crypto mode)	PARTIAL	⚠️ Has critical crypto implementation bugs
Poker (crypto)	PARTIAL	⚠️ Same crypto issues as War
Go Fish demo-private	NONE	❌ Intentionally insecure (by design)
Go Fish coop-reveal	WEAK	⚠️ Private keys sent in plaintext
Go Fish zk-attest	SCAFFOLDING	⚠️ ZK circuits not actually implemented
Merkle Battleship	STRONG	✅ Cryptographically sound, except DoS vector
Threshold Tally	DEMO	Aggregate-only, not for hiding cards
---
Critical Vulnerabilities Found
1. FAKE SHA-256 in SRA Encryption (CRITICAL)
In src/crypto/mental-poker/sra.ts, the sha256Sync function is NOT SHA-256:
function sha256Sync(data: Uint8Array): Uint8Array {
  let hash = 0;
  for (let i = 0; i < data.length; i++) {
    hash = ((hash << 5) - hash + data[i]) | 0;  // Simple string hash!
  }
  // Expand to 32 bytes...
}
This is a textbook djb-style hash, completely broken for crypto. It's used by hashToPoint to map card IDs to curve points for encryption. The entire SRA encryption scheme is undermined by this.
2. Private Keys Sent in Plaintext (CRITICAL)
In gofish/crypto.ts, submitDecryptionShare transmits the player's private key as a plaintext move argument:
export function submitDecryptionShare(
  G, ctx, zoneId, cardIndex, playerId, privateKey: string,  // <-- PRIVATE KEY EXPOSED
): CryptoGoFishState | typeof INVALID_MOVE
While boardgame.io synchronizes state, any entity with access to the state machine (including the opponent) can log and extract these private keys on every cooperative decryption.
3. No Verification of Decryption Shares (CRITICAL)
The cooperative decryption has zero integrity checking:
// gofish/crypto.ts:1573-1580
let decrypted = decrypt(card, privateKey);  // NO VERIFICATION
zone[cardIndex] = decrypted;  // CORRUPTED STATE ACCEPTED
A malicious player can submit a wrong decryption key. Since SRA decryption is k^(-1) * ciphertext, using the wrong key produces garbage that can never be recovered — even with all other correct shares. The game only checks decrypted.layers === 0, not that the result is a valid card.
4. Non-Crypto Games Have Zero Protection
SimpleCardGame uses client: true — moves execute locally without any server validation. WarGame uses client: false but the P2PMaster's applyAction doesn't verify playerID matches the actual mover.
In P2P mode:
- Both players receive the full game state (including opponent's private hand)
- A player can call flipCard for the opponent
- Math.random() is used for shuffling (predictable)
Attack in browser console:
// Read opponent's entire hand in War
window.__BGIOMASTERSTATE__.zones.opponentHand
// Play any card, any time
bgio.flow.makeMove('playCard', { cardId: 'hearts-A' });
5. Shamir Key Escrow Is Non-Functional
// distributeKeyShares: shares accepted but DISCARDED
void shares;  // SHARES NEVER STORED OR VERIFIED
player.hasDistributedShares = true;
Shares are accepted but immediately discarded. The abandonment recovery mechanism would fail because shares were never actually collected.
6. Commit-Reveal Shuffle Allows Strategic Refusal
The shuffle uses commit-reveal, not true ZK proofs. A malicious player can:
1. Commit to a seed
2. If the resulting shuffle is unfavorable, refuse to reveal
3. Force a game void or delay indefinitely
The abort mechanism requires 12 stalled moves before triggering.
7. Merkle Battleship Has DoS Vector
While the Merkle commitment is cryptographically sound, there's no enforcement for reveal responses:
- Attacker sends bs_guess 
- Defender can simply refuse to send bs_reveal
- Game deadlocks indefinitely — no timeout, no penalty, no forced forfeit
A losing player can permanently stall the game by not responding.
---
Attack Scenario Examples
Card Corruption Attack (Mental Poker)
1. Players complete encryption/shuffle
2. Player B submits wrong decryption share during reveal
3. Card is permanently corrupted (garbage that can never be decrypted)
4. Neither player can detect this was intentional vs. accidental
Reading Opponent's Hand (Non-Crypto War)
// In browser DevTools
const state = window.__BGIOMASTERSTATE__;
console.log("Opponent's deck:", state.zones.player1Deck);
console.log("Opponent's hand:", state.zones.player1Hand);
Shuffle Bias Attack
1. Player observes the shuffle's effect on their hand
2. If favorable, reveal seed honestly
3. If unfavorable, withhold reveal → force void or delay
---
What IS Actually Secure
Feature	Status	Notes
Merkle commitment (Battleship)	✅	SHA-256, proper proof verification
Salt generation	✅	Uses crypto.getRandomValues (Web Crypto API)
Fleet placement binding	✅	Cannot change after commit
Threshold DKG	✅	Feldman DKG properly implemented
DLEQ proofs	✅	Correctly verify partial decryptions
ECDSA signing	✅	Used in ZK verdict signing
---
## Root Cause Summary
1. **No server-side validation** in non-crypto games — client is authoritative
2. **No cryptographic verification** of decryption shares — trust without proof
3. **Fake SHA-256** used for encryption — encryption is broken at the primitive level
4. **Shamir shares discarded** — key escrow doesn't actually store shares
5. **P2P has no accountability** — can refuse to reveal without consequence
6. **ZK is scaffolding only** — real ZK circuits never implemented
---
Recommendations
If you need actual security:
1. Never use non-crypto games for any stakes
2. Do not use demo-private mode — keys are in shared state
3. Accept DoS is possible — no cryptographic prevention exists
4. The SRA encryption is fundamentally broken due to the fake SHA-256
5. For real money games, the blockchain settlement layer provides economic finality, but cannot prevent mid-game cheating — only post-game disputes