# Product Requirements Document (PRD): Decentralized Verifiable Privacy-Preserving Battleship Demo

## 1. Overview

### Project Name
Verifiable Privacy Battleship – A Fully Decentralized, Homomorphic Encryption-Powered Battleship Game with Cryptographic Hit/Miss Verification

### Description
A turn-based Battleship game implemented as a static web application where players' ship placements remain fully private using homomorphic encryption (HE). Players exchange encrypted board states and use blinded homomorphic computations to reveal hit/miss results per guess in a verifiable way—the guessing player determines the outcome directly without trusting the opponent. The game runs peer-to-peer (P2P) with no central server, using WebRTC for communication and boardgame.io for turn-based logic. The entire application is deployable on IPFS for complete decentralization.

This demo highlights advanced fully homomorphic encryption (FHE) with verifiable reveals: only the guessed cell's bit is learned cryptographically, with optional commitments for mutual proof against dishonesty.

### Target Audience
- Cryptography developers and researchers interested in FHE and verifiable computation.
- Privacy tech and Web3 communities.
- Educators demonstrating zero-trust protocols in interactive formats.

### Key Value Proposition
- Practical FHE demo with verifiable, trustless hit/miss revelation.
- Fully decentralized: No server, static IPFS hosting, P2P everything.
- Educational showcase of blinding techniques for privacy-preserving verification.

## 2. Objectives

### Primary Goals
- Implement playable 2-player Battleship with strong privacy and verifiability via HE blinding.
- Ensure full decentralization (IPFS + P2P).
- Use boardgame.io for robust game flow while layering HE for private/verifiable reveals.

### Success Metrics
- End-to-end playable game with verifiable turns (tested across browsers).
- P2P connection success ≥80% (manual signaling fallback).
- Demo repo/video showing blinded verification in action.
- Persistent IPFS deployment with CID.

## 3. Features & User Stories

### Core Gameplay (Standard Battleship Rules)
- 10x10 grid.
- Standard fleet: Carrier (5), Battleship (4), Cruiser (3), Submarine (3), Destroyer (2).
- Phases: Private ship placement → Alternating guesses → Win by sinking all ships.

### User Stories

1. **As a player, I can create or join a P2P game**
   - Create: Generate WebRTC offer (SDP text for sharing).
   - Join: Paste offer, generate/send answer.
   - Clear UX with copy-paste instructions.

2. **As a player, I can privately place ships**
   - Interactive UI (drag-drop or click-place).
   - Local validation only.

3. **As players, we exchange encrypted boards after placement**
   - Each encrypts board (0/1 bit grid) using node-seal BFV with packing.
   - Send encrypted ciphertext(s) + public key via P2P.

4. **As the guessing player, I can make a guess and cryptographically determine hit/miss myself**
   - Announce public position.
   - Homomorphically select encrypted cell from opponent's board.
   - Blind with random `r`: Compute `enc_blinded = enc(cell) + r`.
   - Send `enc_blinded` (and optional `hash(r)` commitment) to opponent.
   - Receive blinded plaintext from opponent.
   - Unblind: Subtract `r` → Get exact cell bit (0=miss, 1=hit).
   - Announce result and update public state.

5. **As the board owner, I assist in verification without learning extra info**
   - Decrypt received `enc_blinded` → Send blinded value back.
   - Optionally verify opponent's announcement via revealed `r`.

6. **As a player, I can use optional commitments for mutual proof**
   - Commit to `r` before sending blinded ciphertext.
   - Reveal `r` after announcement for opponent verification.

7. **As a player, I see accurate public game state**
   - Own full board.
   - Opponent board with verified hits/misses.
   - Announcements, turn tracking, win detection.

8. **As a user, I access the game via IPFS**
   - Load from ipfs://CID or gateway.
   - Fully static assets.

### Stretch Features
- Mandatory commitments for enforced verifiability.
- Educational overlay showing HE steps (e.g., "Blinding applied...").
- Batch guesses for efficiency.

## 4. Technical Requirements

### Tech Stack
- **Framework**: React + boardgame.io (client + @boardgame.io/p2p transport).
- **HE Library**: node-seal (Microsoft SEAL via WASM) – BFV scheme for packed integer/bit ops.
- **P2P**: boardgame.io/p2p (WebRTC); fallback simple-peer if needed.
- **Crypto Primitives**: Web Crypto API for random `r` and SHA-256 commitments.
- **Build/Deploy**: Vite → Static bundle → IPFS (web3.storage/pinata pinning).

### Key Integration Flows

#### Board Encryption & Exchange
- Pack 10x10 grid into vector ciphertext(s).
- Send via P2P custom messages.

#### Verifiable Guess Flow (Core HE Logic)
1. Public guess announcement (boardgame.io move).
2. Guesser: Homomorphic selection → `enc(cell)` (rotations + masking).
3. Guesser: Generate large random `r`, compute `enc_blinded = enc(cell) + plaintext(r)`.
4. Optional: Send `commit = SHA-256(r)`.
5. Send `enc_blinded` (+ commit) via P2P.
6. Owner: Decrypt → Send blinded plaintext.
7. Guesser: Unblind → Determine/announce hit/miss.
8. Optional: Reveal `r` → Owner verifies consistency.

- All ops client-side; board state unchanged.

#### boardgame.io Customization
- Phases: placement (private), battle.
- Moves: placeShip (local), guess(position) → Trigger HE blinding flow.
- Public G state: Guesses, verified hits/misses, sunk ships, winner.

## 5. Non-Functional Requirements

### Performance
- HE per turn: <5s on modern browsers.
- Blinding overhead minimal (single addition + decrypt).

### Security/Privacy
- Verifiable reveals: Guesser learns exact bit trustlessly.
- Blinding prevents owner learning query details beyond public position.
- Optional commitments detect lying announcements.
- Threat Model: Honest-but-curious + optional protection against dishonest announcements.
- Keys client-side only.

### Compatibility/Accessibility
- Modern desktop browsers with WebRTC.
- Keyboard navigation, color-blind markers.

## 6. Scope

### In-Scope
- 2-player P2P.
- Manual signaling.
- Blinded verifiable reveals (optional commitments).
- IPFS deploy.

### Out-of-Scope
- Automated peer discovery/lobbies.
- Full malicious security (e.g., ZK proofs).
- Mobile optimization.
- Game persistence.

## 7. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| WebRTC connectivity issues | Medium | High | Manual signaling + clear instructions |
| HE ops too slow | Low | Medium | Packed ciphertexts; profile early |
| P2P transport instability | Medium | Medium | Fallback custom WebRTC implementation |
| User confusion on blinding | Low | Medium | In-game tooltips + demo mode |

## 8. Milestones (Suggested)

1. **Week 1**: boardgame.io base Battleship + P2P connection.
2. **Week 2**: Integrate node-seal + board encryption/exchange.
3. **Week 3**: Basic homomorphic selection + simple reveal.
4. **Week 4**: Implement blinded verification flow + optional commitments.
5. **Week 5**: UI polish, verifiability testing, IPFS deploy, demo materials.

This PRD captures the enhanced verifiable design—ready for implementation! If you'd like wireframes, code structure outlines, or tweaks, just say the word. 🚀