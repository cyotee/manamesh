import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { BoardProps } from "boardgame.io/react";

import type { JoinCodeConnection } from "../p2p";

import type { ThresholdTallyState } from "../game/modules/threshold-tally";
import {
  dkgEvaluateShare,
  dkgMakeDealerSecrets,
  dkgPrivateShareFromReceivedShares,
  dkgPublicShareFromPrivateShare,
  dkgVerifyShare,
  dleqProve,
  elgamalEncryptExp,
  elgamalPartialDecrypt,
  secpRandomScalar,
} from "../crypto";

function clampInt(n: number, min: number, max: number): number {
  const x = Math.floor(n);
  if (x < min) return min;
  if (x > max) return max;
  return x;
}

export const ThresholdTallyBoard: React.FC<BoardProps<any>> = ({
  G,
  ctx,
  moves,
  playerID,
  matchID,
  ...rest
}) => {
  const state = G as ThresholdTallyState;
  const myId = playerID || "0";

  const p2pConnection = (rest as any).p2pConnection as
    | JoinCodeConnection
    | undefined;

  const dealerRef = useRef<ReturnType<typeof dkgMakeDealerSecrets> | null>(
    null,
  );
  const receivedSharesRef = useRef<Record<string, bigint>>({});
  const privateShareRef = useRef<bigint | null>(null);

  // Local message bus for hotseat mode.
  const bcRef = useRef<BroadcastChannel | null>(null);

  type TallySignalBase = {
    game: "threshold-tally";
    matchID: string;
  };

  type TallyDkgShareSignal = TallySignalBase & {
    type: "tt_dkg_share";
    fromPlayerId: string;
    toPlayerId: string;
    shareHex: string;
  };

  type TallySignal = TallyDkgShareSignal;

  const sendSignal = useCallback(
    (signal: TallySignal) => {
      if (p2pConnection) {
        p2pConnection.sendSignal(signal);
        return;
      }
      if (typeof BroadcastChannel !== "undefined") {
        if (!bcRef.current) {
          bcRef.current = new BroadcastChannel(`manamesh:${matchID}:signals`);
        }
        bcRef.current.postMessage(signal);
        return;
      }
      throw new Error("No signal transport available");
    },
    [matchID, p2pConnection],
  );

  const handleSignal = useCallback(
    (raw: unknown) => {
      if (!raw || typeof raw !== "object") return;
      const anyRaw = raw as any;
      if (anyRaw.game !== "threshold-tally") return;
      if (anyRaw.matchID !== matchID) return;

      if (anyRaw.type === "tt_dkg_share") {
        const s = anyRaw as Partial<TallyDkgShareSignal>;
        if (typeof s.fromPlayerId !== "string") return;
        if (typeof s.toPlayerId !== "string") return;
        if (typeof s.shareHex !== "string") return;
        if (s.toPlayerId !== myId) return;
        if (s.fromPlayerId === myId) return;

        const clean = s.shareHex.startsWith("0x")
          ? s.shareHex.slice(2)
          : s.shareHex;
        if (!/^[0-9a-fA-F]+$/.test(clean) || clean.length === 0) return;
        if (receivedSharesRef.current[s.fromPlayerId]) return;

        receivedSharesRef.current[s.fromPlayerId] = BigInt("0x" + clean);
        return;
      }
    },
    [matchID, myId],
  );

  useEffect(() => {
    if (p2pConnection) {
      const handler = (s: unknown) => handleSignal(s);
      p2pConnection.onSignal(handler);
      return () => p2pConnection.offSignal(handler);
    }

    if (typeof BroadcastChannel !== "undefined") {
      const bc = new BroadcastChannel(`manamesh:${matchID}:signals`);
      bcRef.current = bc;
      bc.onmessage = (ev) => handleSignal(ev.data);
      return () => {
        bc.close();
        if (bcRef.current === bc) bcRef.current = null;
      };
    }

    return;
  }, [handleSignal, matchID, p2pConnection]);

  const [localContribution, setLocalContribution] = useState<number>(0);
  const [status, setStatus] = useState<string | null>(null);

  const phase = ctx.phase || state.phase;
  const minC = state.config.minContribution;
  const maxC = state.config.maxContribution;

  const pkHex = state.crypto.publicKeyHex;

  const myCiphertext = state.roundState.ciphertextByPlayer[myId] ?? null;
  const allSubmitted = Object.values(state.roundState.ciphertextByPlayer).every(
    (c) => !!c,
  );

  const publishMyCommitment = () => {
    if (phase !== "setup") return;
    if (state.dkg.commitmentsByPlayer[myId]) {
      setStatus("Already published your DKG commitment.");
      return;
    }
    dealerRef.current = dkgMakeDealerSecrets();
    const { c0Hex, c1Hex } = dealerRef.current.commitment;
    (moves as any).publishDkgCommitment({ c0Hex, c1Hex });
    setStatus("Published DKG commitment. Send shares to peers.");
  };

  const sendSharesToPeers = () => {
    if (phase !== "setup") return;
    if (!dealerRef.current) {
      setStatus("Create your DKG commitment first.");
      return;
    }
    for (const to of state.playerOrder) {
      if (to === myId) continue;
      const share = dkgEvaluateShare(dealerRef.current, BigInt(Number(to) + 1));
      try {
        sendSignal({
          game: "threshold-tally",
          matchID,
          type: "tt_dkg_share",
          fromPlayerId: myId,
          toPlayerId: to,
          shareHex: share.toString(16),
        });
      } catch (e) {
        setStatus(e instanceof Error ? e.message : "Failed to send share");
        return;
      }
    }
    setStatus("Sent shares to peers (private signal transport). ");
  };

  // Receiver-side: verify received shares once the sender commitment is available.
  useEffect(() => {
    if (phase !== "setup") return;
    for (const from of state.playerOrder) {
      if (from === myId) continue;
      const share = receivedSharesRef.current[from];
      if (!share) continue;

      const k = `${from}->${myId}`;
      if ((state.dkg.shareOk as any)[k] !== undefined) continue;

      const commit = state.dkg.commitmentsByPlayer[from];
      if (!commit) continue;

      const ok = dkgVerifyShare(commit, BigInt(Number(myId) + 1), share);
      try {
        (moves as any).confirmDkgShare({ fromPlayerId: from, ok });
      } catch {
        // ignore
      }
    }
  }, [
    phase,
    myId,
    moves,
    state.dkg.commitmentsByPlayer,
    state.dkg.shareOk,
    state.playerOrder,
  ]);

  const finalizeLocalShare = () => {
    if (phase !== "setup") return;
    if (privateShareRef.current) {
      setStatus("Already finalized your private share.");
      return;
    }
    if (!dealerRef.current) {
      setStatus(
        "You must publish your commitment (and keep dealer secrets locally).",
      );
      return;
    }
    const shares: bigint[] = [];
    // include my own share
    shares.push(dkgEvaluateShare(dealerRef.current, BigInt(Number(myId) + 1)));
    for (const from of state.playerOrder) {
      if (from === myId) continue;
      const s = receivedSharesRef.current[from];
      if (!s) {
        setStatus(`Missing share from Player ${from}.`);
        return;
      }
      shares.push(s);
    }
    privateShareRef.current = dkgPrivateShareFromReceivedShares(shares);
    const yHex = dkgPublicShareFromPrivateShare(privateShareRef.current);
    (moves as any).publishPublicShare({ yHex });
    setStatus("Finalized local private share and published public share.");
  };

  const finalizeDkgAndDerivePk = () => {
    if (phase !== "setup") return;
    try {
      (moves as any).finalizeDkg();
      setStatus("Finalized DKG and derived aggregate public key.");
    } catch {
      setStatus("Finalize DKG failed (missing confirmations/public shares?).");
    }
  };

  const submitMyCiphertext = () => {
    if (!pkHex) {
      setStatus("Waiting for public key...");
      return;
    }
    if (myCiphertext) {
      setStatus("You already submitted this round.");
      return;
    }
    const m = clampInt(localContribution, minC, maxC);
    const r = secpRandomScalar();
    const ct = elgamalEncryptExp(pkHex, BigInt(m), r);
    (moves as any).submitCiphertext({ c1Hex: ct.c1Hex, c2Hex: ct.c2Hex });
    setStatus(`Submitted Enc(${m}) under threshold key (t=2).`);
  };

  const decryptAggregateAndPublish = () => {
    if (phase !== "decrypt") return;
    if (!state.roundState.aggregateCiphertext) {
      setStatus("Aggregate ciphertext not ready.");
      return;
    }
    if (!privateShareRef.current) {
      setStatus("Finalize your private share first (setup phase).");
      return;
    }
    if (state.roundState.partialDecryptByPlayer?.[myId]) {
      setStatus("You already submitted a partial decrypt for this round.");
      return;
    }
    const partialHex = elgamalPartialDecrypt(
      state.roundState.aggregateCiphertext.c1Hex,
      privateShareRef.current,
    );
    const yHex = state.crypto.publicShareByPlayer[myId];
    if (!yHex) {
      setStatus("Missing your published public share.");
      return;
    }
    const proof = dleqProve({
      base2Hex: state.roundState.aggregateCiphertext.c1Hex,
      publicShareHex: yHex,
      partialHex,
      secretShare: privateShareRef.current,
      context: `threshold-tally|round:${state.roundState.round}`,
    });
    try {
      (moves as any).submitDecryptShare({ partialHex, proof });
      setStatus("Submitted partial decrypt share.");
    } catch {
      setStatus("Failed to submit partial decrypt share.");
    }
  };

  const ack = () => {
    (moves as any).ackRoundResult();
    setStatus("Acknowledged.");
  };

  const outcome = useMemo(() => {
    const total = state.roundState.decryptedTotal;
    if (total === null) return null;
    return {
      total,
      ok: total >= state.roundState.target,
    };
  }, [state.roundState.decryptedTotal, state.roundState.target]);

  return (
    <div
      style={{
        padding: 20,
        maxWidth: 1000,
        margin: "0 auto",
        fontFamily:
          "ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif",
        color: "#e4e4e4",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 16,
          marginBottom: 16,
          padding: "14px 16px",
          background:
            "linear-gradient(135deg, rgba(15,52,96,0.85), rgba(22,33,62,0.85))",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 12,
        }}
      >
        <div>
          <div style={{ fontSize: 18, fontWeight: 900 }}>
            Threshold Tally Arena
          </div>
          <div style={{ fontSize: 12, color: "#a0a0a0" }}>
            Milestone 4: Feldman DKG (t=2) + EC ElGamal tally (threshold
            decrypt)
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 12, color: "#a0a0a0" }}>You: {myId}</div>
          <div style={{ fontSize: 12, color: "#a0a0a0" }}>
            Phase: {String(phase)}
          </div>
          <div style={{ fontSize: 12, color: "#a0a0a0" }}>
            Round: {state.roundState.round}
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        <div
          style={{
            flex: "1 1 360px",
            minWidth: 320,
            backgroundColor: "#16213e",
            border: "1px solid #3a3a5c",
            borderRadius: 12,
            padding: 16,
          }}
        >
          <div style={{ fontWeight: 900, marginBottom: 10 }}>
            Round Objective
          </div>
          <div style={{ fontSize: 13, color: "#cbd5e1" }}>
            Target: <strong>{state.roundState.target}</strong>
          </div>
          <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 8 }}>
            Each player privately submits a number in [{minC}..{maxC}].
            Ciphertexts are multiplied to form an encryption of the sum.
          </div>

          <div
            style={{
              marginTop: 14,
              padding: 12,
              borderRadius: 10,
              background: "rgba(15, 52, 96, 0.55)",
              border: "1px solid rgba(255,255,255,0.12)",
            }}
          >
            <div style={{ fontWeight: 900, marginBottom: 8 }}>Crypto Setup</div>
            <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 10 }}>
              Players: {state.playerOrder.length} (threshold{" "}
              {state.crypto.threshold}-of-
              {state.playerOrder.length})
            </div>
            {state.crypto.publicKeyHex ? (
              <div style={{ fontSize: 12, color: "#cbd5e1" }}>
                Aggregate public key published
              </div>
            ) : (
              <div style={{ fontSize: 12, color: "#cbd5e1" }}>
                Waiting for commitments, shares, and aggregate public key.
              </div>
            )}
            {!state.dkg.commitmentsByPlayer[myId] && (
              <button
                onClick={publishMyCommitment}
                style={{
                  width: "100%",
                  marginTop: 10,
                  padding: "10px 14px",
                  borderRadius: 10,
                  backgroundColor: "#1d4ed8",
                  color: "#fff",
                  border: "none",
                  cursor: "pointer",
                  fontWeight: 800,
                }}
              >
                Publish DKG Commitment
              </button>
            )}

            <button
              onClick={sendSharesToPeers}
              disabled={phase !== "setup" || !dealerRef.current}
              style={{
                width: "100%",
                marginTop: 10,
                padding: "10px 14px",
                borderRadius: 10,
                backgroundColor: "#0f172a",
                color: "#e5e7eb",
                border: "1px solid rgba(255,255,255,0.12)",
                cursor: "pointer",
                fontWeight: 800,
              }}
            >
              Send Shares (Private)
            </button>

            <button
              onClick={finalizeLocalShare}
              disabled={phase !== "setup"}
              style={{
                width: "100%",
                marginTop: 10,
                padding: "10px 14px",
                borderRadius: 10,
                backgroundColor: "#059669",
                color: "#fff",
                border: "none",
                cursor: "pointer",
                fontWeight: 800,
              }}
            >
              Finalize My Share
            </button>

            <button
              onClick={finalizeDkgAndDerivePk}
              disabled={phase !== "setup" || !!state.crypto.publicKeyHex}
              style={{
                width: "100%",
                marginTop: 10,
                padding: "10px 14px",
                borderRadius: 10,
                backgroundColor: "#374151",
                color: "#fff",
                border: "none",
                cursor: "pointer",
                fontWeight: 800,
              }}
            >
              Finalize DKG (Derive PK)
            </button>
          </div>

          <div
            style={{
              marginTop: 14,
              padding: 12,
              borderRadius: 10,
              background: "rgba(15, 23, 42, 0.55)",
              border: "1px solid rgba(255,255,255,0.12)",
            }}
          >
            <div style={{ fontWeight: 900, marginBottom: 8 }}>
              Commit (Private Input)
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <input
                type="number"
                value={localContribution}
                min={minC}
                max={maxC}
                onChange={(e) => setLocalContribution(Number(e.target.value))}
                disabled={phase !== "commit" || !!myCiphertext || !pkHex}
                style={{
                  width: 100,
                  padding: 8,
                  borderRadius: 8,
                  background: "#0f172a",
                  color: "#e5e7eb",
                  border: "1px solid rgba(255,255,255,0.12)",
                }}
              />
              <button
                onClick={submitMyCiphertext}
                disabled={phase !== "commit" || !!myCiphertext || !pkHex}
                style={{
                  padding: "10px 14px",
                  borderRadius: 10,
                  backgroundColor: "#059669",
                  color: "#fff",
                  border: "none",
                  cursor: "pointer",
                  fontWeight: 800,
                  flex: 1,
                }}
              >
                Submit Ciphertext
              </button>
            </div>
            <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 8 }}>
              Your plaintext stays local; only the ElGamal ciphertext is
              published.
            </div>
          </div>

          <div
            style={{
              marginTop: 14,
              padding: 12,
              borderRadius: 10,
              background: "rgba(15, 52, 96, 0.35)",
              border: "1px solid rgba(255,255,255,0.12)",
            }}
          >
            <div style={{ fontWeight: 900, marginBottom: 8 }}>
              Decrypt (Threshold)
            </div>
            <div style={{ fontSize: 12, color: "#cbd5e1" }}>
              Aggregate ciphertext:{" "}
              {state.roundState.aggregateCiphertext ? "ready" : "pending"}
            </div>
            <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 8 }}>
              Partial decrypt shares:{" "}
              {
                Object.values(
                  state.roundState.partialDecryptByPlayer || {},
                ).filter(Boolean).length
              }
              /{state.playerOrder.length}
            </div>
            <button
              onClick={decryptAggregateAndPublish}
              disabled={phase !== "decrypt"}
              style={{
                width: "100%",
                marginTop: 10,
                padding: "10px 14px",
                borderRadius: 10,
                backgroundColor: "#0f172a",
                color: "#e5e7eb",
                border: "1px solid rgba(255,255,255,0.12)",
                cursor: "pointer",
                fontWeight: 800,
              }}
            >
              Submit Partial Decrypt
            </button>
          </div>

          <div
            style={{
              marginTop: 14,
              padding: 12,
              borderRadius: 10,
              background: "rgba(0,0,0,0.25)",
              border: "1px solid rgba(255,255,255,0.12)",
            }}
          >
            <div style={{ fontWeight: 900, marginBottom: 8 }}>Resolve</div>
            {outcome ? (
              <div style={{ fontSize: 13 }}>
                Decrypted total: <strong>{outcome.total}</strong> —{" "}
                <span style={{ color: outcome.ok ? "#6fcf6f" : "#ff9800" }}>
                  {outcome.ok ? "SUCCESS" : "FAIL"}
                </span>
              </div>
            ) : (
              <div style={{ fontSize: 12, color: "#94a3b8" }}>
                Waiting for decrypted total…
              </div>
            )}
            <button
              onClick={ack}
              disabled={
                phase !== "resolve" || state.roundState.ackByPlayer[myId]
              }
              style={{
                width: "100%",
                marginTop: 10,
                padding: "10px 14px",
                borderRadius: 10,
                backgroundColor: "#374151",
                color: "#fff",
                border: "none",
                cursor: "pointer",
                fontWeight: 800,
              }}
            >
              {state.roundState.ackByPlayer[myId]
                ? "Acknowledged"
                : "Acknowledge & Next Round"}
            </button>
            <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 8 }}>
              {Object.entries(state.roundState.ackByPlayer)
                .map(([pid, v]) => `${pid}:${v ? "ok" : "…"}`)
                .join("  ")}
            </div>
          </div>
        </div>

        <div
          style={{
            flex: "1 1 360px",
            minWidth: 320,
            backgroundColor: "#0b2447",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 12,
            padding: 16,
          }}
        >
          <div style={{ fontWeight: 900, marginBottom: 10 }}>
            Round Transcript
          </div>
          <div style={{ fontSize: 12, color: "#94a3b8", marginBottom: 10 }}>
            Ciphertexts submitted:{" "}
            {
              Object.values(state.roundState.ciphertextByPlayer).filter(Boolean)
                .length
            }
            /{state.playerOrder.length} {allSubmitted ? "(all in)" : ""}
          </div>

          <div style={{ fontSize: 12, color: "#cbd5e1" }}>
            {state.playerOrder.map((pid) => {
              const cHex = state.roundState.ciphertextByPlayer[pid];
              return (
                <div
                  key={pid}
                  style={{
                    padding: "8px 10px",
                    borderRadius: 10,
                    background: "rgba(0,0,0,0.25)",
                    border: "1px solid rgba(255,255,255,0.10)",
                    marginBottom: 8,
                  }}
                >
                  <div
                    style={{ display: "flex", justifyContent: "space-between" }}
                  >
                    <span style={{ fontWeight: 800 }}>Player {pid}</span>
                    <span style={{ color: cHex ? "#6fcf6f" : "#94a3b8" }}>
                      {cHex ? "submitted" : "pending"}
                    </span>
                  </div>
                  {cHex && (
                    <div
                      style={{
                        marginTop: 6,
                        fontFamily:
                          "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
                      }}
                    >
                      0x{cHex.slice(0, 20)}…
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {status && (
            <pre
              style={{
                marginTop: 12,
                whiteSpace: "pre-wrap",
                background: "rgba(0,0,0,0.35)",
                border: "1px solid rgba(255,255,255,0.12)",
                borderRadius: 10,
                padding: 12,
                overflow: "auto",
                color: "#e5e7eb",
              }}
            >
              {status}
            </pre>
          )}

          <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 12 }}>
            Note: DKG shares are exchanged out-of-band (P2P signal / local
            BroadcastChannel). Next milestones add threshold decryption shares +
            verifiable proofs.
          </div>
        </div>
      </div>
    </div>
  );
};
