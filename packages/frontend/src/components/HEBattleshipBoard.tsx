import React, { useMemo, useRef, useState } from "react";
import type { BoardProps } from "boardgame.io/react";

import {
  CELL_COUNT,
  STANDARD_FLEET,
  validateFleetFromBits,
  type CellBit,
  type PlacedShip,
  GRID_SIZE,
  type Coord,
  type Orientation,
} from "../game/modules/merkle-battleship";
import type { HEBattleshipState } from "../game/modules/he-battleship";

import {
  bigintToHex,
  paillierAdd,
  paillierDecrypt,
  paillierEncrypt,
  paillierGenerateKeypair,
  paillierPublicKeyFromNHex,
  type PaillierKeypair,
} from "../crypto";

// NOTE: This board reuses the placement UI concepts from Merkle Battleship,
// but it is a demo-only page focusing on homomorphic encryption.

function shipCells(ship: PlacedShip): number[] {
  const out: number[] = [];
  const dx = ship.orientation === "horizontal" ? 1 : 0;
  const dy = ship.orientation === "vertical" ? 1 : 0;
  for (let i = 0; i < ship.size; i++) {
    out.push((ship.start.y + dy * i) * GRID_SIZE + (ship.start.x + dx * i));
  }
  return out;
}

function buildBoardBits(ships: PlacedShip[]): CellBit[] {
  const bits = Array.from({ length: CELL_COUNT }, () => 0 as CellBit);
  for (const s of ships) for (const idx of shipCells(s)) bits[idx] = 1;
  return bits;
}

function isValidCoord(c: Coord): boolean {
  return (
    Number.isInteger(c.x) &&
    Number.isInteger(c.y) &&
    c.x >= 0 &&
    c.x < GRID_SIZE &&
    c.y >= 0 &&
    c.y < GRID_SIZE
  );
}

function canPlaceShip(
  existing: PlacedShip[],
  candidate: PlacedShip,
): { ok: boolean; reason?: string } {
  // Basic bounds + overlap checks.
  const cells = shipCells(candidate);
  for (const idx of cells) {
    const x = idx % GRID_SIZE;
    const y = Math.floor(idx / GRID_SIZE);
    if (!isValidCoord({ x, y })) return { ok: false, reason: "Out of bounds" };
  }
  const occupied = new Set<number>();
  for (const s of existing) for (const idx of shipCells(s)) occupied.add(idx);
  for (const idx of cells)
    if (occupied.has(idx)) return { ok: false, reason: "Overlap" };
  return { ok: true };
}

function placeOrMoveShip(
  existing: PlacedShip[],
  ship: PlacedShip,
): PlacedShip[] {
  const next = existing.filter((s) => s.id !== ship.id);
  next.push(ship);
  return next;
}

export const HEBattleshipBoard: React.FC<BoardProps<any>> = ({
  G,
  ctx,
  moves,
  playerID,
}) => {
  const state = G as HEBattleshipState;
  const myId = playerID || "0";
  const opponentId = useMemo(() => {
    const pids = Object.keys(state.players);
    return pids.find((p) => p !== myId) || null;
  }, [myId, state.players]);

  const mySlice = state.players[myId];
  const oppSlice = opponentId ? state.players[opponentId] : null;

  const [selectedShipId, setSelectedShipId] = useState<string>(
    STANDARD_FLEET[0]?.id ?? "",
  );
  const [orientation, setOrientation] = useState<Orientation>("horizontal");
  const [placedShips, setPlacedShips] = useState<PlacedShip[]>([]);
  const [status, setStatus] = useState<string | null>(null);

  const keypairRef = useRef<PaillierKeypair | null>(null);
  const publishedKeyRef = useRef(false);

  const boardBits = useMemo(() => buildBoardBits(placedShips), [placedShips]);
  const occupiedCount = useMemo(
    () => boardBits.reduce((acc, b) => acc + (b === 1 ? 1 : 0), 0),
    [boardBits],
  );

  const allShipsPlaced = placedShips.length === STANDARD_FLEET.length;
  const phase = ctx.phase || state.phase;
  const isPlacement = phase === "placement";

  const handleGridClick = (coord: Coord) => {
    if (!isPlacement) return;
    if (mySlice?.placementConfirmed) return;

    const spec = STANDARD_FLEET.find((s) => s.id === selectedShipId);
    if (!spec) return;

    const candidate: PlacedShip = {
      id: spec.id,
      start: coord,
      orientation,
      size: spec.size,
    };
    const check = canPlaceShip(
      placedShips.filter((s) => s.id !== candidate.id),
      candidate,
    );
    if (!check.ok) {
      setStatus(check.reason || "Invalid placement");
      return;
    }
    setStatus(null);
    setPlacedShips((prev) => placeOrMoveShip(prev, candidate));
  };

  const handleConfirm = () => {
    if (!isPlacement) return;
    if (!allShipsPlaced) {
      setStatus("Place all ships first");
      return;
    }

    const legality = validateFleetFromBits(boardBits);
    if (!legality.ok) {
      setStatus(legality.reason || "Illegal fleet");
      return;
    }

    // Persist our placement into game state (server-side move). We'll later use
    // this to resolve guesses in the demo battle phase.
    (moves as any).setBoardBits({ boardBits });

    // Generate keypair once per match/session (demo) and publish the public key.
    if (!keypairRef.current) keypairRef.current = paillierGenerateKeypair();
    const { publicKey, privateKey } = keypairRef.current;

    if (!publishedKeyRef.current && !mySlice?.paillierPublicNHex) {
      (moves as any).publishPublicKey({
        paillierPublicNHex: bigintToHex(publicKey.n),
      });
      publishedKeyRef.current = true;
    }

    // We can only publish a decryptable commitment once we know opponent's public key.
    const oppN = oppSlice?.paillierPublicNHex;
    if (!oppN) {
      setStatus(
        "Published your Paillier public key. Waiting for opponent to publish theirs...",
      );
      return;
    }

    const oppPk = paillierPublicKeyFromNHex(oppN);

    // Encrypt each bit under opponent's key and add ciphertexts to get Enc(sum(bits)).
    let encSumForOpp = paillierEncrypt(oppPk, 0n);
    for (const b of boardBits) {
      const c = paillierEncrypt(oppPk, b === 1 ? 1n : 0n);
      encSumForOpp = paillierAdd(oppPk, encSumForOpp, c);
    }

    // Sanity check: decrypt locally (only possible with opponent key; this is just a local check).
    // We can't decrypt encSumForOpp since it's under oppPk. Keep a local plaintext check instead.
    const myPlainCount = boardBits.reduce((acc, bit) => acc + (bit ? 1 : 0), 0);
    if (myPlainCount !== occupiedCount) {
      setStatus("Internal error: plaintext count mismatch");
      return;
    }

    // Also show that our own key works by encrypting/decrypting the plaintext count.
    const encMyCount = paillierEncrypt(publicKey, BigInt(myPlainCount));
    const decMyCount = paillierDecrypt(publicKey, privateKey, encMyCount);

    setStatus(
      `Published encrypted ship count for opponent to decrypt. (Local self-check: Enc/Dec(${myPlainCount}) = ${decMyCount.toString()}).`,
    );

    (moves as any).publishHomomorphicCommitment({
      encShipCountForOpponentHex: bigintToHex(encSumForOpp),
    });
  };

  const verifyOpponent = () => {
    if (!oppSlice?.encShipCountForOpponentHex) {
      setStatus("Opponent has not published an encrypted ship count yet.");
      return;
    }
    if (!keypairRef.current) {
      setStatus("Generate your keypair first by confirming your placement.");
      return;
    }
    try {
      const { publicKey, privateKey } = keypairRef.current;
      const c = BigInt("0x" + oppSlice.encShipCountForOpponentHex);
      const dec = paillierDecrypt(publicKey, privateKey, c);
      setStatus(
        `Decrypted opponent ship count: ${dec.toString()} (expected 17).`,
      );
    } catch (e) {
      setStatus(
        e instanceof Error ? e.message : "Failed to parse opponent commitment",
      );
    }
  };

  const renderGrid = () => {
    return (
      <div
        style={{
          backgroundColor: "#16213e",
          border: "1px solid #3a3a5c",
          borderRadius: 12,
          padding: 16,
          width: "100%",
          maxWidth: 520,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginBottom: 10,
          }}
        >
          <div style={{ fontWeight: 800 }}>Placement Grid</div>
          <div style={{ fontSize: 12, color: "#94a3b8" }}>
            {GRID_SIZE}x{GRID_SIZE}
          </div>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${GRID_SIZE}, 1fr)`,
            gap: 4,
            userSelect: "none",
          }}
        >
          {Array.from({ length: CELL_COUNT }).map((_, idx) => {
            const x = idx % GRID_SIZE;
            const y = Math.floor(idx / GRID_SIZE);
            const occupied = boardBits[idx] === 1;
            return (
              <button
                key={idx}
                onClick={() => handleGridClick({ x, y })}
                disabled={!isPlacement || !!mySlice?.placementConfirmed}
                title={`${x},${y}`}
                style={{
                  width: "100%",
                  aspectRatio: "1 / 1",
                  borderRadius: 6,
                  border: "1px solid rgba(255,255,255,0.08)",
                  backgroundColor: occupied ? "#1e3a8a" : "#0f3460",
                  color: occupied ? "#bfdbfe" : "#94a3b8",
                  cursor: "pointer",
                  fontWeight: 800,
                }}
              >
                {occupied ? "■" : ""}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  const renderBattleGrid = () => {
    if (!opponentId) {
      return (
        <div
          style={{
            backgroundColor: "#16213e",
            border: "1px solid #3a3a5c",
            borderRadius: 12,
            padding: 16,
            width: "100%",
            maxWidth: 520,
          }}
        >
          <div style={{ fontWeight: 800 }}>Opponent Grid</div>
          <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 6 }}>
            Waiting for opponent...
          </div>
        </div>
      );
    }

    const marks = (mySlice as any)?.opponentMarks as
      | Array<"unknown" | "miss" | "hit">
      | undefined;

    const isMyTurn = String(ctx.currentPlayer) === String(myId);

    return (
      <div
        style={{
          backgroundColor: "#16213e",
          border: "1px solid #3a3a5c",
          borderRadius: 12,
          padding: 16,
          width: "100%",
          maxWidth: 520,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginBottom: 10,
          }}
        >
          <div style={{ fontWeight: 800 }}>Opponent Grid</div>
          <div style={{ fontSize: 12, color: "#94a3b8" }}>
            {isMyTurn ? "Your turn" : `Waiting for Player ${ctx.currentPlayer}`}
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${GRID_SIZE}, 1fr)`,
            gap: 4,
            userSelect: "none",
          }}
        >
          {Array.from({ length: CELL_COUNT }).map((_, idx) => {
            const x = idx % GRID_SIZE;
            const y = Math.floor(idx / GRID_SIZE);
            const mark = marks?.[idx] ?? "unknown";
            const disabled = !isMyTurn || mark !== "unknown";
            const bg =
              mark === "unknown"
                ? "#0b2447"
                : mark === "miss"
                  ? "#334155"
                  : "#b91c1c";
            const label = mark === "hit" ? "X" : mark === "miss" ? "·" : "";
            return (
              <button
                key={idx}
                onClick={() => {
                  if (disabled) return;
                  (moves as any).guess({ x, y });
                }}
                disabled={disabled}
                title={`${x},${y}`}
                style={{
                  width: "100%",
                  aspectRatio: "1 / 1",
                  borderRadius: 6,
                  border: "1px solid rgba(255,255,255,0.08)",
                  backgroundColor: bg,
                  color: "#e5e7eb",
                  cursor: disabled ? "not-allowed" : "pointer",
                  fontWeight: 900,
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div
      style={{
        padding: 20,
        maxWidth: 980,
        margin: "0 auto",
        fontFamily: "system-ui, sans-serif",
        color: "#e4e4e4",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
          padding: "12px 16px",
          backgroundColor: "#16213e",
          borderRadius: 10,
          border: "1px solid #3a3a5c",
        }}
      >
        <div>
          <div style={{ fontSize: 18, fontWeight: 900 }}>
            Homomorphic Battleship (Demo)
          </div>
          <div style={{ fontSize: 12, color: "#94a3b8" }}>
            Paillier-encrypted ship-count commitment (additive homomorphism)
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 12, color: "#94a3b8" }}>You: {myId}</div>
          <div style={{ fontSize: 12, color: "#94a3b8" }}>
            Phase:{" "}
            <span style={{ color: "#e4e4e4" }}>{String(state.phase)}</span>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        {isPlacement ? renderGrid() : renderBattleGrid()}
        <div
          style={{
            flex: 1,
            minWidth: 320,
            backgroundColor: "rgba(15, 52, 96, 0.65)",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 12,
            padding: 16,
          }}
        >
          <div style={{ fontWeight: 900, marginBottom: 10 }}>Controls</div>

          <div
            style={{
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
              marginBottom: 12,
            }}
          >
            <select
              value={selectedShipId}
              onChange={(e) => setSelectedShipId(e.target.value)}
              disabled={!isPlacement || !!mySlice?.placementConfirmed}
              style={{
                padding: 8,
                borderRadius: 8,
                background: "#0f172a",
                color: "#e5e7eb",
                border: "1px solid rgba(255,255,255,0.12)",
              }}
            >
              {STANDARD_FLEET.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.size})
                </option>
              ))}
            </select>
            <button
              onClick={() =>
                setOrientation((o) =>
                  o === "horizontal" ? "vertical" : "horizontal",
                )
              }
              disabled={!isPlacement || !!mySlice?.placementConfirmed}
              style={{
                padding: "8px 12px",
                borderRadius: 8,
                background: "#374151",
                color: "#fff",
                border: "none",
                cursor: "pointer",
              }}
            >
              Orientation: {orientation}
            </button>
          </div>

          <div style={{ fontSize: 13, color: "#cbd5e1", marginBottom: 12 }}>
            Occupied cells (plaintext): <strong>{occupiedCount}</strong>{" "}
            (expected 17)
          </div>

          <button
            onClick={handleConfirm}
            disabled={!isPlacement || !!mySlice?.placementConfirmed}
            style={{
              width: "100%",
              padding: "10px 14px",
              borderRadius: 10,
              backgroundColor: "#1d4ed8",
              color: "#fff",
              border: "none",
              cursor: "pointer",
              fontWeight: 800,
              marginBottom: 10,
            }}
          >
            Publish Homomorphic Commitment
          </button>

          <button
            onClick={verifyOpponent}
            style={{
              width: "100%",
              padding: "10px 14px",
              borderRadius: 10,
              backgroundColor: "#0f172a",
              color: "#e5e7eb",
              border: "1px solid rgba(255,255,255,0.12)",
              cursor: "pointer",
              fontWeight: 800,
            }}
          >
            Inspect Opponent Commitment
          </button>

          <div style={{ marginTop: 12, fontSize: 12, color: "#94a3b8" }}>
            Placement phase: publish your key + an encrypted ship count for your
            opponent to decrypt. Battle phase: click opponent grid to guess
            (demo-only; not trustless).
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
              }}
            >
              {status}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
};
