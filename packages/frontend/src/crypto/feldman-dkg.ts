import {
  secpBaseMulHex,
  secpIsValidPointHex,
  secpModN,
  secpPointAddHex,
  secpPointMulHex,
  secpRandomScalar,
  type SecpPointHex,
} from "./secp256k1";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

// Feldman VSS / DKG primitives for threshold t=2 (degree 1).
// Public transcript: commitments to polynomial coefficients.
// Private to each player: shares s_ij sent to player j.

export type DkgCommitment = {
  c0Hex: SecpPointHex; // g^{a0}
  c1Hex: SecpPointHex; // g^{a1}
};

export type DkgDealerSecrets = {
  a0: bigint;
  a1: bigint;
  commitment: DkgCommitment;
};

export function dkgMakeDealerSecrets(): DkgDealerSecrets {
  const a0 = secpRandomScalar();
  const a1 = secpRandomScalar();
  const c0Hex = secpBaseMulHex(a0);
  const c1Hex = secpBaseMulHex(a1);
  return { a0, a1, commitment: { c0Hex, c1Hex } };
}

export function dkgEvaluateShare(dealer: DkgDealerSecrets, x: bigint): bigint {
  const xx = secpModN(x);
  return secpModN(dealer.a0 + secpModN(dealer.a1 * xx));
}

export function dkgVerifyShare(
  commitment: DkgCommitment,
  x: bigint,
  share: bigint,
): boolean {
  try {
    if (!secpIsValidPointHex(commitment.c0Hex)) return false;
    if (!secpIsValidPointHex(commitment.c1Hex)) return false;
    const xx = secpModN(x);
    const left = secpPointMulHex(secpBaseMulHex(1n), secpModN(share));
    const rhs = secpPointAddHex(
      commitment.c0Hex,
      secpPointMulHex(commitment.c1Hex, xx),
    );
    return left === rhs;
  } catch {
    return false;
  }
}

export function dkgCombineCommitments(commits: DkgCommitment[]): DkgCommitment {
  assert(commits.length >= 1, "need commitments");
  let c0 = commits[0]!.c0Hex;
  let c1 = commits[0]!.c1Hex;
  for (let i = 1; i < commits.length; i++) {
    c0 = secpPointAddHex(c0, commits[i]!.c0Hex);
    c1 = secpPointAddHex(c1, commits[i]!.c1Hex);
  }
  return { c0Hex: c0, c1Hex: c1 };
}

export function dkgPublicKeyFromCombinedCommitment(
  combined: DkgCommitment,
): SecpPointHex {
  // g^{sum a0}
  return combined.c0Hex;
}

export function dkgPrivateShareFromReceivedShares(shares: bigint[]): bigint {
  let acc = 0n;
  for (const s of shares) acc = secpModN(acc + secpModN(s));
  return acc;
}

export function dkgPublicShareFromPrivateShare(
  privateShare: bigint,
): SecpPointHex {
  return secpPointMulHex(secpBaseMulHex(1n), secpModN(privateShare));
}
