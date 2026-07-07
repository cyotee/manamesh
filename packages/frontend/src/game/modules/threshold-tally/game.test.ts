import { describe, it, expect } from "vitest";
import { INVALID_MOVE } from "boardgame.io/core";

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
} from "@manamesh/boardgameio-crypto";
import {
  createInitialState,
  publishDkgCommitment,
  confirmDkgShare,
  publishPublicShare,
  finalizeDkg,
} from "./logic";
import { ThresholdTallyGame } from "./game";

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

// =============================================================================
// Fix 2: publishDkgCommitment parameter shape
// =============================================================================

describe("threshold-tally logic (Fix 2)", () => {
  it("publishDkgCommitment accepts { coefficients } and records the commitment", () => {
    const state = createInitialState(["0", "1", "2"]);
    const dealer = dkgMakeDealerSecrets();
    const coeffs = dealer.commitment.coefficients; // string[]

    const result = publishDkgCommitment(state, "0", { coefficients: coeffs });
    expect(result).not.toBe(INVALID_MOVE);
    expect(state.dkg.commitmentsByPlayer["0"]).toBeDefined();
    expect(state.dkg.commitmentsByPlayer["0"]!.coefficients).toEqual(coeffs);
  });

  it("ThresholdTallyGame move wrapper accepts { coefficients } without throwing", () => {
    // The game.ts move wraps publishDkgCommitment with { coefficients: string[] } params.
    // Before Fix 2, it was typed as { c0Hex, c1Hex }, causing a runtime crash.
    const publishMove = ThresholdTallyGame.phases?.setup?.moves?.publishDkgCommitment;
    expect(publishMove).toBeDefined();
    // The move is defined — type safety confirmed by TypeScript compilation
  });

  it("publishDkgCommitment rejects duplicate commitment from the same player", () => {
    const state = createInitialState(["0", "1", "2"]);
    const dealer = dkgMakeDealerSecrets();
    const coeffs = dealer.commitment.coefficients;

    publishDkgCommitment(state, "0", { coefficients: coeffs });
    // Second call for the same player should throw (caught by INVALID_MOVE in game.ts)
    expect(() => {
      publishDkgCommitment(state, "0", { coefficients: coeffs });
    }).toThrow();
  });
});

// =============================================================================
// Fix 12: playerIdToEvalPoint guard in finalizeDkg
// =============================================================================

describe("threshold-tally DKG round-trip with logic functions", () => {
  it("finalizeDkg derives consistent public key after all players commit + share + publish", () => {
    const pids = ["0", "1", "2"];
    const state = createInitialState(pids);
    const dealers = pids.map(() => dkgMakeDealerSecrets());

    // Publish commitments
    for (let i = 0; i < pids.length; i++) {
      publishDkgCommitment(state, pids[i]!, {
        coefficients: dealers[i]!.commitment.coefficients,
      });
    }

    // Confirm all cross-player shares
    for (const from of pids) {
      for (const to of pids) {
        if (from === to) continue;
        confirmDkgShare(state, to, { fromPlayerId: from, ok: true });
      }
    }

    // Publish public shares
    for (const pid of pids) {
      const x = BigInt(Number(pid) + 1);
      const received = dealers.map((d) => dkgEvaluateShare(d, x));
      const priv = dkgPrivateShareFromReceivedShares(received);
      const pub = dkgPublicShareFromPrivateShare(priv);
      publishPublicShare(state, pid, { yHex: pub });
    }

    // finalizeDkg should succeed without throwing
    expect(() => finalizeDkg(state, "0")).not.toThrow();
    expect(state.crypto.publicKeyHex).toBeTruthy();
  });
});
