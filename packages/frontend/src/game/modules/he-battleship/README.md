# Homomorphic Battleship (Demo)

This module is a **technology demonstration** of _additively homomorphic encryption_ applied to Battleship-style information hiding.

It uses the Paillier cryptosystem to show how one party can sum encrypted values (e.g. total number of ship segments) without learning the underlying plaintext bits.

Important:

- This is **not** intended to be a secure production protocol.
- Key sizes are intentionally small for browser performance.
- The existing `merkle-battleship` module remains the "real" verifiable implementation.

## Demo Protocol: Encrypted Ship-Count Commitment

Goal: after placement, the defender can prove they committed to a board with exactly `17` occupied cells (standard fleet size) **without revealing** which cells are occupied.

1. Defender generates Paillier keypair `(pk, sk)`.

2. For each cell bit `b[i] in {0,1}`, defender computes ciphertext:

```
c[i] = Enc_pk(b[i])
```

3. Defender also computes an encrypted sum:

```
C_sum = Prod_i c[i]   (mod n^2)
```

By Paillier homomorphism:

```
Dec_sk(C_sum) = Sum_i b[i]
```

4. Defender publishes to shared state:

- `pk.n` (public modulus)
- `C_sum` (encrypted ship-count)

5. Anyone can verify (demo):

- Defender decrypts `C_sum` locally to show it equals `17`.

This demonstrates the _technology_ (addition under encryption). It does not by itself prevent other forms of cheating; for gameplay correctness we still rely on the Merkle per-cell proof protocol.
