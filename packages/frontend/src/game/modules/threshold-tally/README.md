# Threshold Tally Arena

This module is a **threshold homomorphic tally demo**.

It uses:

- Feldman-style DKG (t=2) over secp256k1 (degree-1 polynomials)
- EC ElGamal with the message encoded in the exponent (small integers only)

## Current Implementation Status

- Additive tally under encryption: implemented (EC ElGamal pointwise add).
- True DKG (no single party learns full private key): implemented.
- Threshold decryption: implemented (t=2; any 2 shares).
- Verifiable decryption shares: implemented (DLEQ / Chaum-Pedersen).
- Input range validity proofs: not implemented (UI enforces small range; threat model assumes honest inputs).

## Demo Flow

1. **Setup**: Each player publishes a Feldman commitment and privately sends shares to peers.
2. **Setup**: Receivers verify shares and publish confirmations; players publish public shares.
3. **Setup**: Aggregate public key is derived from combined commitments.
4. **Commit**: Each player picks a private integer `m_i` and submits EC ElGamal `Enc_pk(m_i)`.
5. **Decrypt**: Each player publishes a partial decrypt share with a DLEQ proof.
6. **Resolve**: Team succeeds if `total >= target`. Everyone acknowledges to advance.
