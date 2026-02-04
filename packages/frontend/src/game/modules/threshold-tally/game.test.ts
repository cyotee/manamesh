import { describe, it, expect } from "vitest";

import {
  dkgCombineCommitments,
  dkgEvaluateShare,
  dkgMakeDealerSecrets,
  dkgPrivateShareFromReceivedShares,
  dkgPublicKeyFromCombinedCommitment,
  dkgPublicShareFromPrivateShare,
  dkgVerifyShare,
  dleqProve,
  dleqVerify,
  elgamalAdd,
  elgamalCombinePartials,
  elgamalDecodeSmallSumMessage,
  elgamalEncryptExp,
  elgamalPartialDecrypt,
  elgamalRecoverMessagePoint,
  secpRandomScalar,
} from "../../../crypto";

describe("threshold-tally DKG (milestone 3)", () => {
  it("verifies shares and derives consistent public key", () => {
    const pids = ["0", "1", "2"];
    const dealers = pids.map(() => dkgMakeDealerSecrets());
    const commitments = dealers.map((d) => d.commitment);

    // Each receiver verifies the share sent to them by each dealer.
    for (const toPid of pids) {
      const x = BigInt(Number(toPid) + 1);
      for (let i = 0; i < pids.length; i++) {
        const share = dkgEvaluateShare(dealers[i]!, x);
        expect(dkgVerifyShare(commitments[i]!, x, share)).toBe(true);
      }
    }

    // Each player can locally sum their received shares (including own) to get their private share.
    // Then compute the corresponding public share.
    const combined = dkgCombineCommitments(commitments);
    const pkHex = dkgPublicKeyFromCombinedCommitment(combined);
    expect(typeof pkHex).toBe("string");
    expect(pkHex.length).toBeGreaterThan(0);

    for (const toPid of pids) {
      const x = BigInt(Number(toPid) + 1);
      const received = dealers.map((d) => dkgEvaluateShare(d, x));
      const priv = dkgPrivateShareFromReceivedShares(received);
      const pub = dkgPublicShareFromPrivateShare(priv);
      expect(typeof pub).toBe("string");
      expect(pub.length).toBeGreaterThan(0);
    }
  });

  it("decrypts aggregate with 2 partial decrypt shares (milestone 4)", () => {
    const pids = ["0", "1", "2"];
    const dealers = pids.map(() => dkgMakeDealerSecrets());
    const commitments = dealers.map((d) => d.commitment);
    const combined = dkgCombineCommitments(commitments);
    const pkHex = dkgPublicKeyFromCombinedCommitment(combined);

    // Derive private shares for each player by summing received shares.
    const privByPid: Record<string, bigint> = {};
    for (const toPid of pids) {
      const x = BigInt(Number(toPid) + 1);
      const received = dealers.map((d) => dkgEvaluateShare(d, x));
      privByPid[toPid] = dkgPrivateShareFromReceivedShares(received);
    }

    // Encrypt contributions and homomorphically sum.
    const contributions: Record<string, number> = { "0": 2, "1": 5, "2": 1 };
    const cts = pids.map((pid) =>
      elgamalEncryptExp(pkHex, BigInt(contributions[pid]!), secpRandomScalar()),
    );
    let agg = cts[0]!;
    for (let i = 1; i < cts.length; i++) agg = elgamalAdd(agg, cts[i]!);

    // Collect any 2 partial decrypt shares and recover the sum.
    const partials = ["0", "2"].map((pid) => {
      const partialHex = elgamalPartialDecrypt(agg.c1Hex, privByPid[pid]!);
      const publicShareHex = dkgPublicShareFromPrivateShare(privByPid[pid]!);
      const proof = dleqProve({
        base2Hex: agg.c1Hex,
        publicShareHex,
        partialHex,
        secretShare: privByPid[pid]!,
        context: "threshold-tally|round:1",
      });
      expect(
        dleqVerify({
          base2Hex: agg.c1Hex,
          publicShareHex,
          partialHex,
          proof,
          context: "threshold-tally|round:1",
        }),
      ).toBe(true);
      return { x: BigInt(Number(pid) + 1), partialHex };
    });
    const combinedPartial = elgamalCombinePartials(partials);
    const msgPoint = elgamalRecoverMessagePoint(agg.c2Hex, combinedPartial);
    const decoded = elgamalDecodeSmallSumMessage(
      msgPoint,
      9 * pids.length,
      pids.length,
    );
    expect(decoded).toBe(
      contributions["0"] + contributions["1"] + contributions["2"],
    );
  });
});
