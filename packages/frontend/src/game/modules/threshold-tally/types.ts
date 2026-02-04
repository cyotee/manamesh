export type ThresholdTallyPhase = "setup" | "commit" | "decrypt" | "resolve";

export type SecpPointHex = string;
export type SecpScalarHex = string;

export type DkgCommitment = { c0Hex: SecpPointHex; c1Hex: SecpPointHex };

export type ElGamalCiphertext = { c1Hex: SecpPointHex; c2Hex: SecpPointHex };

export type DleqProof = {
  a1Hex: SecpPointHex;
  a2Hex: SecpPointHex;
  zHex: SecpScalarHex;
};

export interface ThresholdTallyConfig {
  /** Inclusive min plaintext per player (UI-enforced in milestone 2). */
  minContribution: number;
  /** Inclusive max plaintext per player (UI-enforced in milestone 2). */
  maxContribution: number;
  /** Initial target for the team sum. */
  baseTarget: number;
}

export interface ThresholdTallyRoundState {
  round: number;
  target: number;

  ciphertextByPlayer: Record<string, ElGamalCiphertext | null>;
  aggregateCiphertext: ElGamalCiphertext | null;

  /** Partial decrypt shares D_i = c1^{x_i} with a DLEQ proof vs published public share. */
  partialDecryptByPlayer: Record<
    string,
    { partialHex: SecpPointHex; proof: DleqProof } | null
  >;

  /** Decrypted total once enough partial shares have been collected. */
  decryptedTotal: number | null;

  /** Player acknowledgements to advance to next round. */
  ackByPlayer: Record<string, boolean>;
}

export interface ThresholdTallyState {
  phase: ThresholdTallyPhase;
  playerOrder: string[];

  config: ThresholdTallyConfig;

  crypto: {
    scheme: "ec-elgamal-exp";
    /** 2-player: 2-of-2; 3-player: 2-of-3 */
    threshold: 2;
    publicKeyHex: SecpPointHex | null;
    /** Per-player public share Y_i = g^{x_i} (published after local aggregation). */
    publicShareByPlayer: Record<string, SecpPointHex | null>;
  };

  dkg: {
    /** Feldman commitments per dealer/player. */
    commitmentsByPlayer: Record<string, DkgCommitment | null>;
    /** Receiver-side verification status for received shares; key is `${from}->${to}`. */
    shareOk: Record<string, boolean>;
  };

  roundState: ThresholdTallyRoundState;

  /** Append-only transcript for UX/debugging. */
  transcript: Array<
    | {
        type: "dkg_commit";
        by: string;
        c0Hex: string;
        c1Hex: string;
        at: number;
      }
    | {
        type: "dkg_share_confirm";
        by: string;
        from: string;
        ok: boolean;
        at: number;
      }
    | { type: "pk"; publicKeyHex: string; at: number }
    | { type: "pubshare"; by: string; yHex: string; at: number }
    | {
        type: "ciphertext";
        by: string;
        c1Hex: string;
        c2Hex: string;
        at: number;
      }
    | {
        type: "partial_decrypt";
        by: string;
        partialHex: string;
        a1Hex: string;
        a2Hex: string;
        zHex: string;
        at: number;
      }
    | { type: "decrypt"; by: string; total: number; at: number }
    | { type: "ack"; by: string; round: number; at: number }
  >;
}
