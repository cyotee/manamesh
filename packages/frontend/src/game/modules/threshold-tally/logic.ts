import type {
  ThresholdTallyRoundState,
  ThresholdTallyState,
  ThresholdTallyConfig,
} from "./types";
import {
  dkgCombineCommitments,
  dkgPublicKeyFromCombinedCommitment,
  dleqVerify,
  elgamalAdd,
  elgamalCombinePartials,
  elgamalDecodeSmallSumMessage,
  elgamalRecoverMessagePoint,
  secpIsValidPointHex,
  secpPointAddHex,
  secpPointMulHex,
} from "../../../crypto";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function isHex(s: string): boolean {
  return /^[0-9a-fA-F]+$/.test(s);
}

function makePlayerMap<T>(
  playerOrder: string[],
  init: () => T,
): Record<string, T> {
  const out: Record<string, T> = {};
  for (const pid of playerOrder) out[pid] = init();
  return out;
}

function makeDirectedKey(from: string, to: string): string {
  return `${from}->${to}`;
}

export function defaultThresholdTallyConfig(): ThresholdTallyConfig {
  return {
    minContribution: 0,
    maxContribution: 9,
    baseTarget: 12,
  };
}

export function computeTarget(
  config: ThresholdTallyConfig,
  round: number,
): number {
  // Deterministic variety without depending on RNG.
  const bump = (round - 1) % 5;
  return config.baseTarget + bump;
}

export function createRoundState(
  playerOrder: string[],
  config: ThresholdTallyConfig,
  round: number,
): ThresholdTallyRoundState {
  const ciphertextByPlayer = makePlayerMap(playerOrder, () => null as any);
  const partialDecryptByPlayer = makePlayerMap(playerOrder, () => null as any);
  const ackByPlayer = makePlayerMap(playerOrder, () => false);

  return {
    round,
    target: computeTarget(config, round),
    ciphertextByPlayer,
    aggregateCiphertext: null,
    partialDecryptByPlayer,
    decryptedTotal: null,
    ackByPlayer,
  };
}

export function createInitialState(playerIDs: string[]): ThresholdTallyState {
  const playerOrder = [...playerIDs];
  const config = defaultThresholdTallyConfig();

  const publicShareByPlayer = makePlayerMap(playerOrder, () => null);
  const commitmentsByPlayer = makePlayerMap(playerOrder, () => null);

  return {
    phase: "setup",
    playerOrder,
    config,
    crypto: {
      scheme: "ec-elgamal-exp",
      threshold: 2,
      publicKeyHex: null,
      publicShareByPlayer,
    },
    dkg: {
      commitmentsByPlayer,
      shareOk: {},
    },
    roundState: createRoundState(playerOrder, config, 1),
    transcript: [],
  };
}

export function publishDkgCommitment(
  state: ThresholdTallyState,
  playerId: string,
  params: { c0Hex: string; c1Hex: string },
): ThresholdTallyState {
  assert(state.phase === "setup", "wrong phase");
  const c0Hex = params.c0Hex.startsWith("0x")
    ? params.c0Hex.slice(2)
    : params.c0Hex;
  const c1Hex = params.c1Hex.startsWith("0x")
    ? params.c1Hex.slice(2)
    : params.c1Hex;
  assert(isHex(c0Hex) && c0Hex.length >= 2, "invalid c0");
  assert(isHex(c1Hex) && c1Hex.length >= 2, "invalid c1");
  assert(
    !state.dkg.commitmentsByPlayer[playerId],
    "commitment already published",
  );

  state.dkg.commitmentsByPlayer[playerId] = {
    c0Hex: c0Hex.toLowerCase(),
    c1Hex: c1Hex.toLowerCase(),
  };
  state.transcript.push({
    type: "dkg_commit",
    by: playerId,
    c0Hex: c0Hex.toLowerCase(),
    c1Hex: c1Hex.toLowerCase(),
    at: Date.now(),
  });

  return state;
}

export function confirmDkgShare(
  state: ThresholdTallyState,
  playerId: string,
  params: { fromPlayerId: string; ok: boolean },
): ThresholdTallyState {
  assert(state.phase === "setup", "wrong phase");
  assert(params.fromPlayerId !== playerId, "cannot confirm self share");
  assert(state.playerOrder.includes(params.fromPlayerId), "invalid from");
  assert(typeof params.ok === "boolean", "invalid ok");

  const k = makeDirectedKey(params.fromPlayerId, playerId);
  assert(state.dkg.shareOk[k] === undefined, "confirmation already recorded");
  state.dkg.shareOk[k] = params.ok;
  state.transcript.push({
    type: "dkg_share_confirm",
    by: playerId,
    from: params.fromPlayerId,
    ok: params.ok,
    at: Date.now(),
  });
  return state;
}

export function publishPublicShare(
  state: ThresholdTallyState,
  playerId: string,
  params: { yHex: string },
): ThresholdTallyState {
  assert(state.phase === "setup", "wrong phase");
  const yHex = params.yHex.startsWith("0x")
    ? params.yHex.slice(2)
    : params.yHex;
  assert(isHex(yHex) && yHex.length >= 2, "invalid public share");
  assert(
    state.crypto.publicShareByPlayer[playerId] === null,
    "public share already published",
  );
  state.crypto.publicShareByPlayer[playerId] = yHex.toLowerCase();
  state.transcript.push({
    type: "pubshare",
    by: playerId,
    yHex: yHex.toLowerCase(),
    at: Date.now(),
  });
  return state;
}

export function dkgReady(state: ThresholdTallyState): boolean {
  // Commitments must exist and all directed shares must be marked ok.
  for (const pid of state.playerOrder) {
    if (!state.dkg.commitmentsByPlayer[pid]) return false;
  }
  for (const from of state.playerOrder) {
    for (const to of state.playerOrder) {
      if (from === to) continue;
      const k = makeDirectedKey(from, to);
      if (state.dkg.shareOk[k] !== true) return false;
    }
  }
  // Public shares published by all players.
  for (const pid of state.playerOrder) {
    if (!state.crypto.publicShareByPlayer[pid]) return false;
  }
  return true;
}

export function finalizeDkg(
  state: ThresholdTallyState,
  _playerId: string,
): ThresholdTallyState {
  assert(state.phase === "setup", "wrong phase");
  assert(!state.crypto.publicKeyHex, "public key already set");

  // Ensure commitments + receiver confirmations + public shares exist.
  for (const pid of state.playerOrder) {
    assert(!!state.dkg.commitmentsByPlayer[pid], "missing commitment");
    assert(!!state.crypto.publicShareByPlayer[pid], "missing public share");
  }
  for (const from of state.playerOrder) {
    for (const to of state.playerOrder) {
      if (from === to) continue;
      const k = makeDirectedKey(from, to);
      assert(
        state.dkg.shareOk[k] === true,
        "missing/failed share confirmation",
      );
    }
  }

  // Validate each published public share against the combined commitment.
  const commits = state.playerOrder.map(
    (pid) => state.dkg.commitmentsByPlayer[pid]!,
  );
  const combined = dkgCombineCommitments(commits);
  for (const pid of state.playerOrder) {
    const x = BigInt(Number(pid) + 1);
    const expected = secpPointAddHex(
      combined.c0Hex,
      secpPointMulHex(combined.c1Hex, x),
    );
    const got = state.crypto.publicShareByPlayer[pid]!;
    assert(expected === got, "public share mismatch");
  }

  state.crypto.publicKeyHex = dkgPublicKeyFromCombinedCommitment(combined);
  state.transcript.push({
    type: "pk",
    publicKeyHex: state.crypto.publicKeyHex,
    at: Date.now(),
  });
  return state;
}

export function allCiphertextsSubmitted(state: ThresholdTallyState): boolean {
  return Object.values(state.roundState.ciphertextByPlayer).every((c) => !!c);
}

export function allAcks(state: ThresholdTallyState): boolean {
  return Object.values(state.roundState.ackByPlayer).every((v) => v);
}

export function submitCiphertext(
  state: ThresholdTallyState,
  playerId: string,
  params: { c1Hex: string; c2Hex: string },
): ThresholdTallyState {
  assert(!!state.crypto.publicKeyHex, "public key not published");
  assert(
    state.roundState.ciphertextByPlayer[playerId] === null,
    "ciphertext already submitted",
  );

  const c1Hex = params.c1Hex.startsWith("0x")
    ? params.c1Hex.slice(2)
    : params.c1Hex;
  const c2Hex = params.c2Hex.startsWith("0x")
    ? params.c2Hex.slice(2)
    : params.c2Hex;
  assert(isHex(c1Hex) && c1Hex.length >= 2, "invalid c1");
  assert(isHex(c2Hex) && c2Hex.length >= 2, "invalid c2");

  state.roundState.ciphertextByPlayer[playerId] = {
    c1Hex: c1Hex.toLowerCase(),
    c2Hex: c2Hex.toLowerCase(),
  };
  state.transcript.push({
    type: "ciphertext",
    by: playerId,
    c1Hex: c1Hex.toLowerCase(),
    c2Hex: c2Hex.toLowerCase(),
    at: Date.now(),
  });

  // If all ciphertexts are in, compute the aggregate ciphertext.
  if (allCiphertextsSubmitted(state)) {
    const ciphertexts = Object.values(
      state.roundState.ciphertextByPlayer,
    ) as any;
    let agg = ciphertexts[0] as any;
    for (let i = 1; i < ciphertexts.length; i++) {
      agg = elgamalAdd(agg, ciphertexts[i]);
    }
    state.roundState.aggregateCiphertext = agg;
  }

  return state;
}

export function submitDecryptShare(
  state: ThresholdTallyState,
  playerId: string,
  params: {
    partialHex: string;
    proof: { a1Hex: string; a2Hex: string; zHex: string };
  },
): ThresholdTallyState {
  assert(!!state.roundState.aggregateCiphertext, "aggregate not ready");

  assert(state.roundState.decryptedTotal === null, "already decrypted");
  assert(
    state.roundState.partialDecryptByPlayer[playerId] === null,
    "partial already submitted",
  );

  const pubShare = state.crypto.publicShareByPlayer[playerId];
  assert(!!pubShare, "missing public share");

  const partialHex = params.partialHex.startsWith("0x")
    ? params.partialHex.slice(2)
    : params.partialHex;
  assert(isHex(partialHex) && partialHex.length >= 2, "invalid partial");

  const a1Hex = params.proof.a1Hex.startsWith("0x")
    ? params.proof.a1Hex.slice(2)
    : params.proof.a1Hex;
  const a2Hex = params.proof.a2Hex.startsWith("0x")
    ? params.proof.a2Hex.slice(2)
    : params.proof.a2Hex;
  const zHex = params.proof.zHex.startsWith("0x")
    ? params.proof.zHex.slice(2)
    : params.proof.zHex;
  assert(isHex(a1Hex) && a1Hex.length >= 2, "invalid a1");
  assert(isHex(a2Hex) && a2Hex.length >= 2, "invalid a2");
  assert(isHex(zHex) && zHex.length === 64, "invalid z");

  assert(
    secpIsValidPointHex(state.roundState.aggregateCiphertext.c1Hex),
    "bad c1",
  );
  assert(secpIsValidPointHex(pubShare), "bad public share");
  assert(secpIsValidPointHex(partialHex), "bad partial");
  assert(secpIsValidPointHex(a1Hex), "bad a1");
  assert(secpIsValidPointHex(a2Hex), "bad a2");

  const ok = dleqVerify({
    base2Hex: state.roundState.aggregateCiphertext.c1Hex,
    publicShareHex: pubShare,
    partialHex: partialHex.toLowerCase(),
    proof: {
      a1Hex: a1Hex.toLowerCase(),
      a2Hex: a2Hex.toLowerCase(),
      zHex: zHex.toLowerCase(),
    },
    context: `threshold-tally|round:${state.roundState.round}`,
  });
  assert(ok, "invalid partial decrypt proof");

  state.roundState.partialDecryptByPlayer[playerId] = {
    partialHex: partialHex.toLowerCase(),
    proof: {
      a1Hex: a1Hex.toLowerCase(),
      a2Hex: a2Hex.toLowerCase(),
      zHex: zHex.toLowerCase(),
    },
  };
  state.transcript.push({
    type: "partial_decrypt",
    by: playerId,
    partialHex: partialHex.toLowerCase(),
    a1Hex: a1Hex.toLowerCase(),
    a2Hex: a2Hex.toLowerCase(),
    zHex: zHex.toLowerCase(),
    at: Date.now(),
  });

  // Once we have threshold partial decryptions, combine and decode.
  const threshold = state.crypto.threshold;
  const entries = Object.entries(state.roundState.partialDecryptByPlayer)
    .filter(([, v]) => !!v)
    .slice(0, threshold);
  if (entries.length >= threshold) {
    const partials = entries.map(([pid, pHex]) => ({
      x: BigInt(Number(pid) + 1),
      partialHex: (pHex as any).partialHex as string,
    }));
    const combined = elgamalCombinePartials(partials);
    const msgPoint = elgamalRecoverMessagePoint(
      state.roundState.aggregateCiphertext.c2Hex,
      combined,
    );
    const max = state.config.maxContribution * state.playerOrder.length;
    const decoded = elgamalDecodeSmallSumMessage(
      msgPoint,
      max,
      state.playerOrder.length,
    );
    assert(decoded !== null, "failed to decode message");
    state.roundState.decryptedTotal = decoded;
    state.transcript.push({
      type: "decrypt",
      by: playerId,
      total: decoded,
      at: Date.now(),
    });
  }
  return state;
}

export function ackRoundResult(
  state: ThresholdTallyState,
  playerId: string,
): ThresholdTallyState {
  state.roundState.ackByPlayer[playerId] = true;
  state.transcript.push({
    type: "ack",
    by: playerId,
    round: state.roundState.round,
    at: Date.now(),
  });
  return state;
}

export function startNextRound(
  state: ThresholdTallyState,
): ThresholdTallyState {
  const nextRound = state.roundState.round + 1;
  state.roundState = createRoundState(
    state.playerOrder,
    state.config,
    nextRound,
  );
  return state;
}
