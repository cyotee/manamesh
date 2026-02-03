/**
 * Merkle Battleship Board Component
 *
 * Local ship placement with Merkle commitment binding.
 * Per-shot verification happens via out-of-band signals:
 * - P2P mode: JoinCodeConnection.sendSignal / onSignal
 * - Local hotseat: BroadcastChannel
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { BoardProps } from "boardgame.io/react";
import type { JoinCodeConnection } from "../p2p";
import type { MerkleProofStep } from "../crypto";

import {
  MerkleBattleshipState,
  CELL_COUNT,
  GRID_SIZE,
  STANDARD_FLEET,
  type CellBit,
  type CellMark,
  type Coord,
  type Orientation,
  type PlacedShip,
} from "../game/modules/merkle-battleship";
import {
  commitmentRootHexForBoard,
  auditFullReveal,
  proofForIndex,
  randomSaltHex,
  validateFleetFromBits,
} from "../game/modules/merkle-battleship";

// Enforce legality at placement time (now that we do a full-reveal audit post-game).
// We re-check legality in the audit too.

type BattleshipBoardProps = BoardProps<MerkleBattleshipState> & {
  p2pConnection?: JoinCodeConnection;
};

type BattleshipSignalBase = {
  game: "merkle-battleship";
  matchID: string;
};

type BattleshipGuessSignal = BattleshipSignalBase & {
  type: "bs_guess";
  fromPlayerId: string;
  coord: Coord;
};

type BattleshipRevealSignal = BattleshipSignalBase & {
  type: "bs_reveal";
  toPlayerId: string;
  ownerId: string;
  coord: Coord;
  index: number;
  bit: 0 | 1;
  saltHex: string;
  proof: MerkleProofStep[];
};

type BattleshipFullRevealSignal = BattleshipSignalBase & {
  type: "bs_full_reveal";
  toPlayerId: string;
  ownerId: string;
  boardBits: CellBit[];
  saltsHex: string[];
};

type BattleshipSignal =
  | BattleshipGuessSignal
  | BattleshipRevealSignal
  | BattleshipFullRevealSignal;

function copyTextFallback(text: string): boolean {
  try {
    const el = document.createElement("textarea");
    el.value = text;
    el.setAttribute("readonly", "");
    el.style.position = "fixed";
    el.style.left = "-9999px";
    el.style.top = "0";
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function isCoord(v: unknown): v is Coord {
  return (
    isObject(v) &&
    typeof v.x === "number" &&
    typeof v.y === "number" &&
    Number.isInteger(v.x) &&
    Number.isInteger(v.y) &&
    v.x >= 0 &&
    v.x < GRID_SIZE &&
    v.y >= 0 &&
    v.y < GRID_SIZE
  );
}

function coordToIndex(c: Coord): number {
  return c.y * GRID_SIZE + c.x;
}

function indexToCoord(index: number): Coord {
  return { x: index % GRID_SIZE, y: Math.floor(index / GRID_SIZE) };
}

function shipCells(ship: PlacedShip): number[] {
  const cells: number[] = [];
  for (let i = 0; i < ship.size; i++) {
    const x =
      ship.orientation === "horizontal" ? ship.start.x + i : ship.start.x;
    const y = ship.orientation === "vertical" ? ship.start.y + i : ship.start.y;
    if (x < 0 || x >= GRID_SIZE || y < 0 || y >= GRID_SIZE) return [];
    cells.push(coordToIndex({ x, y }));
  }
  return cells;
}

function buildBoardBits(ships: PlacedShip[]): CellBit[] {
  const bits = Array.from({ length: CELL_COUNT }, () => 0 as CellBit);
  for (const s of ships) {
    for (const idx of shipCells(s)) bits[idx] = 1;
  }
  return bits;
}

function canPlaceShip(
  ships: PlacedShip[],
  candidate: PlacedShip,
): { ok: boolean; reason?: string } {
  const cells = shipCells(candidate);
  if (cells.length !== candidate.size)
    return { ok: false, reason: "Out of bounds" };

  const occupied = new Set<number>();
  for (const s of ships) {
    if (s.id === candidate.id) continue;
    for (const idx of shipCells(s)) occupied.add(idx);
  }
  for (const idx of cells) {
    if (occupied.has(idx)) return { ok: false, reason: "Overlaps" };
  }
  return { ok: true };
}

function placeOrMoveShip(
  ships: PlacedShip[],
  candidate: PlacedShip,
): PlacedShip[] {
  const filtered = ships.filter((s) => s.id !== candidate.id);
  return [...filtered, candidate];
}

function randomPlacement(): PlacedShip[] {
  const ships: PlacedShip[] = [];
  for (const spec of STANDARD_FLEET) {
    let placed = false;
    for (let attempt = 0; attempt < 2000 && !placed; attempt++) {
      const orientation: Orientation =
        Math.random() < 0.5 ? "horizontal" : "vertical";
      const maxX =
        orientation === "horizontal" ? GRID_SIZE - spec.size : GRID_SIZE - 1;
      const maxY =
        orientation === "vertical" ? GRID_SIZE - spec.size : GRID_SIZE - 1;
      const start = {
        x: Math.floor(Math.random() * (maxX + 1)),
        y: Math.floor(Math.random() * (maxY + 1)),
      };
      const candidate: PlacedShip = {
        id: spec.id,
        start,
        orientation,
        size: spec.size,
      };
      if (canPlaceShip(ships, candidate).ok) {
        ships.push(candidate);
        placed = true;
      }
    }
    if (!placed) throw new Error("Failed to randomly place fleet");
  }
  return ships;
}

const LETTERS = "ABCDEFGHIJ";

export const MerkleBattleshipBoard: React.FC<BattleshipBoardProps> = ({
  G,
  ctx,
  moves,
  playerID,
  matchID,
  p2pConnection,
}) => {
  const myId = playerID || "0";
  const storageKey = useMemo(
    () => `manamesh:merkle-battleship:${matchID}:${myId}`,
    [matchID, myId],
  );
  const opponentId = useMemo(() => {
    const pids = Object.keys(G.players);
    return pids.find((p) => p !== myId) || null;
  }, [G.players, myId]);

  const mySlice = G.players[myId];
  const opponentSlice = opponentId ? G.players[opponentId] : null;

  const [selectedShipId, setSelectedShipId] = useState<string>(
    STANDARD_FLEET[0]?.id ?? "",
  );
  const [orientation, setOrientation] = useState<Orientation>("horizontal");
  const [placedShips, setPlacedShips] = useState<PlacedShip[]>([]);
  const [placementError, setPlacementError] = useState<string | null>(null);
  const [pendingGuessIndex, setPendingGuessIndex] = useState<number | null>(
    null,
  );
  const [lastSignalError, setLastSignalError] = useState<string | null>(null);
  const [auditReport, setAuditReport] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<string | null>(null);
  const [opponentFullReveal, setOpponentFullReveal] = useState<{
    ownerId: string;
    boardBits: CellBit[];
    saltsHex: string[];
  } | null>(null);

  const saltsRef = useRef<string[] | null>(null);
  const boardBitsRef = useRef<CellBit[] | null>(null);

  // Local message bus for hotseat mode.
  const bcRef = useRef<BroadcastChannel | null>(null);

  const sendSignal = useCallback(
    (signal: BattleshipSignal) => {
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
      // No local fallback.
      throw new Error("No signal transport available");
    },
    [matchID, p2pConnection],
  );

  const handleSignal = useCallback(
    (raw: unknown) => {
      if (!isObject(raw)) return;
      if (raw.game !== "merkle-battleship") return;
      if (raw.matchID !== matchID) return;

      const type = raw.type;
      if (type === "bs_guess") {
        const s = raw as Partial<BattleshipGuessSignal>;
        if (typeof s.fromPlayerId !== "string") return;
        if (!isCoord(s.coord)) return;
        if (s.fromPlayerId === myId) return;

        // I'm the board owner being guessed.
        const bits = boardBitsRef.current;
        const salts = saltsRef.current;
        if (!opponentId || !bits || !salts) return;
        if (!mySlice?.commitmentRootHex) return;

        const idx = coordToIndex(s.coord);
        const bit = bits[idx];
        const saltHex = salts[idx];
        const proof = proofForIndex(matchID, myId, bits, salts, idx);

        const reveal: BattleshipRevealSignal = {
          game: "merkle-battleship",
          matchID,
          type: "bs_reveal",
          toPlayerId: s.fromPlayerId,
          ownerId: myId,
          coord: s.coord,
          index: idx,
          bit,
          saltHex,
          proof,
        };

        try {
          sendSignal(reveal);
        } catch (e) {
          setLastSignalError(
            e instanceof Error ? e.message : "Failed to send reveal",
          );
        }
        return;
      }

      if (type === "bs_reveal") {
        const s = raw as Partial<BattleshipRevealSignal>;
        if (s.toPlayerId !== myId) return;
        if (!isCoord(s.coord)) return;
        if (typeof s.ownerId !== "string") return;
        if (typeof s.index !== "number") return;
        if (s.bit !== 0 && s.bit !== 1) return;
        if (typeof s.saltHex !== "string") return;
        if (!Array.isArray(s.proof)) return;

        try {
          moves.applyReveal(s.coord, {
            gameId: matchID,
            ownerId: s.ownerId,
            index: s.index,
            bit: s.bit,
            saltHex: s.saltHex,
            proof: s.proof as MerkleProofStep[],
          });
          setPendingGuessIndex(null);
        } catch (e) {
          setLastSignalError(
            e instanceof Error ? e.message : "Failed to apply reveal",
          );
        }

        return;
      }

      if (type === "bs_full_reveal") {
        const s = raw as Partial<BattleshipFullRevealSignal>;
        if (s.toPlayerId !== myId) return;
        if (typeof s.ownerId !== "string") return;
        if (!Array.isArray(s.boardBits) || s.boardBits.length !== CELL_COUNT)
          return;
        if (!Array.isArray(s.saltsHex) || s.saltsHex.length !== CELL_COUNT)
          return;

        setOpponentFullReveal({
          ownerId: s.ownerId,
          boardBits: s.boardBits as CellBit[],
          saltsHex: s.saltsHex as string[],
        });
        return;
      }
    },
    [matchID, moves, myId, mySlice?.commitmentRootHex, opponentId, sendSignal],
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

  // Best-effort local persistence so a refresh doesn't lose reveal ability.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        placedShips?: PlacedShip[];
        salts?: string[];
      };
      if (!parsed || !Array.isArray(parsed.placedShips)) return;
      setPlacedShips(parsed.placedShips);

      if (Array.isArray(parsed.salts) && parsed.salts.length === CELL_COUNT) {
        saltsRef.current = parsed.salts;
        const bits = buildBoardBits(parsed.placedShips);
        boardBitsRef.current = bits;

        // If we already committed on-chain (in G), validate we can still answer reveals.
        if (mySlice?.commitmentRootHex) {
          const root = commitmentRootHexForBoard(
            matchID,
            myId,
            bits,
            parsed.salts,
          );
          if (root !== mySlice.commitmentRootHex) {
            sessionStorage.removeItem(storageKey);
            saltsRef.current = null;
            boardBitsRef.current = null;
            setLastSignalError(
              "Saved placement data did not match commitment root; cleared local cache.",
            );
          }
        }
      }
    } catch {
      // Ignore parse/storage errors.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  useEffect(() => {
    try {
      const payload: { placedShips: PlacedShip[]; salts?: string[] } = {
        placedShips,
      };
      if (saltsRef.current) payload.salts = saltsRef.current;
      sessionStorage.setItem(storageKey, JSON.stringify(payload));
    } catch {
      // Ignore storage errors.
    }
  }, [placedShips, storageKey]);

  useEffect(() => {
    if (!copyStatus) return;
    const t = window.setTimeout(() => setCopyStatus(null), 1500);
    return () => window.clearTimeout(t);
  }, [copyStatus]);

  const boardBits = useMemo(() => buildBoardBits(placedShips), [placedShips]);
  const occupiedIndices = useMemo(() => {
    const set = new Set<number>();
    for (const s of placedShips) for (const idx of shipCells(s)) set.add(idx);
    return set;
  }, [placedShips]);

  const allShipsPlaced = placedShips.length === STANDARD_FLEET.length;
  const phase = ctx.phase || G.phase;
  const isPlacement = phase === "placement";
  const isBattle = phase === "battle";
  const isGameOver = phase === "gameOver" || !!ctx.gameover;
  const isMyTurn = ctx.currentPlayer === myId;

  const tryAutoAudit = useCallback(
    (opts?: { force?: boolean }) => {
      if (!isGameOver) return;
      if (!opponentId) return;

      const canAuditMine =
        !!mySlice?.commitmentRootHex &&
        !!saltsRef.current &&
        !!boardBitsRef.current;

      if (canAuditMine) {
        try {
          sendSignal({
            game: "merkle-battleship",
            matchID,
            type: "bs_full_reveal",
            toPlayerId: opponentId,
            ownerId: myId,
            boardBits: boardBitsRef.current!,
            saltsHex: saltsRef.current!,
          });
        } catch (e) {
          setLastSignalError(
            e instanceof Error ? e.message : "Failed to send full reveal",
          );
        }
      }

      if (canAuditMine && opponentFullReveal) {
        if (!opts?.force && auditReport) return;

        const mineFleet = validateFleetFromBits(boardBitsRef.current!);
        const mine = auditFullReveal({
          matchID,
          ownerId: myId,
          boardBits: boardBitsRef.current!,
          saltsHex: saltsRef.current!,
          expectedRootHex: mySlice!.commitmentRootHex!,
          state: G,
        });

        const oppRoot = opponentSlice?.commitmentRootHex;
        const opp = oppRoot
          ? auditFullReveal({
              matchID,
              ownerId: opponentFullReveal.ownerId,
              boardBits: opponentFullReveal.boardBits,
              saltsHex: opponentFullReveal.saltsHex,
              expectedRootHex: oppRoot,
              state: G,
            })
          : null;

        const lines: string[] = [];
        lines.push(
          `Winner: ${(ctx.gameover as any)?.winner ?? G.winner ?? "?"}`,
        );
        lines.push("---");
        lines.push(`My root matches: ${mine.rootMatches}`);
        lines.push(`My fleet legal: ${mineFleet.ok}`);
        if (!mineFleet.ok) lines.push(`My fleet reason: ${mineFleet.reason}`);
        lines.push(`My guess mismatches: ${mine.guessMismatches.length}`);

        lines.push("---");
        if (!oppRoot) {
          lines.push("Opponent root missing: cannot audit opponent commitment");
        } else if (!opp) {
          lines.push("Opponent audit pending: waiting for full reveal");
        } else {
          lines.push(`Opponent root matches: ${opp.rootMatches}`);
          lines.push(`Opponent fleet legal: ${opp.fleetOk}`);
          if (!opp.fleetOk && opp.fleetReason)
            lines.push(`Opponent fleet reason: ${opp.fleetReason}`);
          lines.push(
            `Opponent guess mismatches: ${opp.guessMismatches.length}`,
          );
        }

        const secureAndValid =
          mine.rootMatches &&
          mineFleet.ok &&
          mine.guessMismatches.length === 0 &&
          !!opp &&
          opp.rootMatches &&
          opp.fleetOk &&
          opp.guessMismatches.length === 0;

        lines.push("---");
        lines.push(`Game secure+valid: ${secureAndValid}`);
        setAuditReport(lines.join("\n"));
      }
    },
    [
      G,
      auditReport,
      ctx.gameover,
      isGameOver,
      matchID,
      myId,
      mySlice,
      opponentFullReveal,
      opponentId,
      opponentSlice?.commitmentRootHex,
      sendSignal,
    ],
  );

  useEffect(() => {
    if (!isGameOver) return;
    tryAutoAudit();
  }, [isGameOver, opponentFullReveal, tryAutoAudit]);

  const myOpponentMarks: CellMark[] =
    mySlice?.opponentMarks ??
    Array.from({ length: CELL_COUNT }, () => "unknown" as const);

  const opponentAttacks = useMemo(() => {
    if (!opponentId) return new Map<number, "hit" | "miss">();
    const m = new Map<number, "hit" | "miss">();
    for (const g of G.guesses) {
      if (g.by !== opponentId) continue;
      m.set(coordToIndex(g.target), g.result);
    }
    return m;
  }, [G.guesses, opponentId]);

  const handleGridClickPlacement = (coord: Coord) => {
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
    const check = canPlaceShip(placedShips, candidate);
    if (!check.ok) {
      setPlacementError(check.reason || "Invalid placement");
      return;
    }
    setPlacementError(null);
    setPlacedShips((prev) => placeOrMoveShip(prev, candidate));
  };

  const handleConfirmPlacement = () => {
    if (!isPlacement) return;
    if (!allShipsPlaced) {
      setPlacementError("Place all ships first");
      return;
    }

    const legality = validateFleetFromBits(boardBits);
    if (!legality.ok) {
      setPlacementError(legality.reason || "Illegal fleet");
      return;
    }

    if (mySlice?.placementConfirmed) return;
    if (!saltsRef.current) {
      saltsRef.current = Array.from({ length: CELL_COUNT }, () =>
        randomSaltHex(16),
      );
    }

    boardBitsRef.current = boardBits;

    const root = commitmentRootHexForBoard(
      matchID,
      myId,
      boardBits,
      saltsRef.current,
    );
    moves.publishCommitment(root);

    try {
      sessionStorage.setItem(
        storageKey,
        JSON.stringify({ placedShips, salts: saltsRef.current }),
      );
    } catch {
      // Ignore storage errors.
    }
  };

  const handleRandomize = () => {
    try {
      setPlacedShips(randomPlacement());
      setPlacementError(null);
    } catch (e) {
      setPlacementError(
        e instanceof Error ? e.message : "Random placement failed",
      );
    }
  };

  const handleResetPlacement = () => {
    setPlacedShips([]);
    setPlacementError(null);
    saltsRef.current = null;
    boardBitsRef.current = null;

    try {
      sessionStorage.removeItem(storageKey);
    } catch {
      // Ignore storage errors.
    }
  };

  const handleGuessClick = (coord: Coord) => {
    if (!isBattle) return;
    if (!opponentId) return;
    if (!isMyTurn) return;
    const idx = coordToIndex(coord);
    if (myOpponentMarks[idx] !== "unknown") return;
    if (pendingGuessIndex !== null) return;

    setPendingGuessIndex(idx);
    setLastSignalError(null);

    const signal: BattleshipGuessSignal = {
      game: "merkle-battleship",
      matchID,
      type: "bs_guess",
      fromPlayerId: myId,
      coord,
    };

    try {
      sendSignal(signal);
    } catch (e) {
      setPendingGuessIndex(null);
      setLastSignalError(
        e instanceof Error ? e.message : "Failed to send guess",
      );
    }
  };

  const renderGrid = (opts: {
    title: string;
    onClick?: (c: Coord) => void;
    cellClass: (idx: number) => { bg: string; fg: string; label: string };
  }) => {
    return (
      <div
        style={{
          backgroundColor: "#16213e",
          border: "1px solid #3a3a5c",
          borderRadius: "12px",
          padding: "16px",
          flex: 1,
          minWidth: "320px",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "12px",
          }}
        >
          <div style={{ fontWeight: 700, color: "#e4e4e4" }}>{opts.title}</div>
          <div style={{ fontSize: "12px", color: "#94a3b8" }}>
            {GRID_SIZE}x{GRID_SIZE}
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${GRID_SIZE + 1}, 1fr)`,
            gap: "4px",
            userSelect: "none",
          }}
        >
          <div />
          {Array.from({ length: GRID_SIZE }).map((_, x) => (
            <div
              key={`h-${x}`}
              style={{
                fontSize: "11px",
                color: "#94a3b8",
                textAlign: "center",
                padding: "2px 0",
              }}
            >
              {LETTERS[x]}
            </div>
          ))}

          {Array.from({ length: GRID_SIZE }).map((_, y) => (
            <React.Fragment key={`row-${y}`}>
              <div
                style={{
                  fontSize: "11px",
                  color: "#94a3b8",
                  textAlign: "center",
                  padding: "6px 0",
                }}
              >
                {y + 1}
              </div>
              {Array.from({ length: GRID_SIZE }).map((__, x) => {
                const idx = coordToIndex({ x, y });
                const meta = opts.cellClass(idx);
                const clickable = !!opts.onClick;
                return (
                  <button
                    key={`c-${x}-${y}`}
                    onClick={() => opts.onClick?.({ x, y })}
                    disabled={!clickable}
                    style={{
                      width: "100%",
                      aspectRatio: "1 / 1",
                      borderRadius: "6px",
                      border: "1px solid rgba(255,255,255,0.08)",
                      backgroundColor: meta.bg,
                      color: meta.fg,
                      cursor: clickable ? "pointer" : "default",
                      fontSize: "12px",
                      fontWeight: 700,
                    }}
                    title={`${LETTERS[x]}${y + 1}`}
                  >
                    {meta.label}
                  </button>
                );
              })}
            </React.Fragment>
          ))}
        </div>
      </div>
    );
  };

  const myGridCell = useCallback(
    (idx: number) => {
      const hasShip = occupiedIndices.has(idx);
      const attacked = opponentAttacks.get(idx);
      if (attacked === "hit") {
        return { bg: "#7f1d1d", fg: "#fecaca", label: "X" };
      }
      if (attacked === "miss") {
        return { bg: "#0f172a", fg: "#94a3b8", label: "o" };
      }
      if (hasShip) {
        return { bg: "#1e3a8a", fg: "#bfdbfe", label: "■" };
      }
      return { bg: "#0f3460", fg: "#94a3b8", label: "" };
    },
    [occupiedIndices, opponentAttacks],
  );

  const oppGridCell = useCallback(
    (idx: number) => {
      const mark = myOpponentMarks[idx];
      const isPending = pendingGuessIndex === idx;
      if (mark === "hit") return { bg: "#991b1b", fg: "#fee2e2", label: "X" };
      if (mark === "miss") return { bg: "#0f172a", fg: "#94a3b8", label: "o" };
      if (isPending) return { bg: "#1d4ed8", fg: "#dbeafe", label: "…" };
      return { bg: "#0f3460", fg: "#94a3b8", label: "" };
    },
    [myOpponentMarks, pendingGuessIndex],
  );

  const remainingToPlace = useMemo(() => {
    const placed = new Set(placedShips.map((s) => s.id));
    return STANDARD_FLEET.filter((s) => !placed.has(s.id));
  }, [placedShips]);

  const placementStatus = useMemo(() => {
    if (!isPlacement) return null;
    if (mySlice?.placementConfirmed) {
      return {
        text: "Placement confirmed. Waiting for opponent…",
        color: "#6fcf6f",
      };
    }
    if (!allShipsPlaced) {
      return {
        text: `Place ships (${remainingToPlace.length} remaining)`,
        color: "#fbbf24",
      };
    }
    return { text: "Ready to confirm placement", color: "#6fcf6f" };
  }, [
    allShipsPlaced,
    isPlacement,
    mySlice?.placementConfirmed,
    remainingToPlace.length,
  ]);

  return (
    <div
      style={{
        padding: "20px",
        maxWidth: "1100px",
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
          marginBottom: "16px",
          padding: "12px 16px",
          backgroundColor: "#16213e",
          borderRadius: "10px",
          border: "1px solid #3a3a5c",
        }}
      >
        <div>
          <div style={{ fontSize: "18px", fontWeight: 800 }}>
            Merkle Battleship
          </div>
          <div style={{ fontSize: "12px", color: "#94a3b8" }}>
            Merkle-bound placement, per-shot proofs
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: "12px", color: "#94a3b8" }}>You: {myId}</div>
          <div style={{ fontSize: "12px", color: "#94a3b8" }}>
            Phase: <span style={{ color: "#e4e4e4" }}>{G.phase}</span>
          </div>
        </div>
      </div>

      {isGameOver && (
        <div
          style={{
            backgroundColor: "rgba(15, 52, 96, 0.65)",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: "12px",
            padding: "14px 16px",
            marginBottom: "16px",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: "10px",
              flexWrap: "wrap",
            }}
          >
            <div style={{ fontWeight: 900, fontSize: "16px" }}>Game Over</div>
            <div style={{ fontSize: "13px", color: "#e5e7eb" }}>
              Winner: {(ctx.gameover as any)?.winner ?? G.winner ?? "?"}
            </div>
          </div>

          <div
            style={{
              marginTop: "10px",
              display: "flex",
              gap: "10px",
              flexWrap: "wrap",
            }}
          >
            <button
              onClick={() => tryAutoAudit({ force: true })}
              style={{
                padding: "10px 14px",
                fontSize: "14px",
                cursor: "pointer",
                backgroundColor: "#1d4ed8",
                color: "white",
                border: "none",
                borderRadius: "8px",
              }}
            >
              Re-run Audit + Share
            </button>

            {auditReport && (
              <button
                onClick={() => {
                  setAuditReport(null);
                  setCopyStatus(null);
                }}
                style={{
                  padding: "10px 14px",
                  fontSize: "14px",
                  cursor: "pointer",
                  backgroundColor: "#374151",
                  color: "white",
                  border: "none",
                  borderRadius: "8px",
                }}
              >
                Clear
              </button>
            )}

            {auditReport && (
              <button
                onClick={async () => {
                  try {
                    if (
                      typeof navigator !== "undefined" &&
                      navigator.clipboard?.writeText
                    ) {
                      await navigator.clipboard.writeText(auditReport);
                      setCopyStatus("Copied audit report.");
                      return;
                    }

                    const ok = copyTextFallback(auditReport);
                    setCopyStatus(ok ? "Copied audit report." : "Copy failed.");
                  } catch {
                    const ok = copyTextFallback(auditReport);
                    setCopyStatus(ok ? "Copied audit report." : "Copy failed.");
                  }
                }}
                style={{
                  padding: "10px 14px",
                  fontSize: "14px",
                  cursor: "pointer",
                  backgroundColor: "#0f172a",
                  color: "white",
                  border: "1px solid rgba(255,255,255,0.12)",
                  borderRadius: "8px",
                }}
              >
                Copy
              </button>
            )}

            <button
              onClick={() => window.location.reload()}
              style={{
                padding: "10px 14px",
                fontSize: "14px",
                cursor: "pointer",
                backgroundColor: "#4CAF50",
                color: "white",
                border: "none",
                borderRadius: "8px",
              }}
            >
              Play Again
            </button>
          </div>

          {copyStatus && (
            <div
              style={{ marginTop: "10px", fontSize: "12px", color: "#93c5fd" }}
            >
              {copyStatus}
            </div>
          )}

          {auditReport && (
            <pre
              style={{
                marginTop: "10px",
                marginBottom: 0,
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                fontSize: "12px",
                lineHeight: 1.5,
                color: "#e5e7eb",
              }}
            >
              {auditReport}
            </pre>
          )}

          {lastSignalError && (
            <div
              style={{ marginTop: "10px", fontSize: "12px", color: "#fca5a5" }}
            >
              {lastSignalError}
            </div>
          )}
        </div>
      )}

      {isPlacement && (
        <div
          style={{
            backgroundColor: "#0f3460",
            border: "1px solid #3a3a5c",
            borderRadius: "12px",
            padding: "16px",
            marginBottom: "16px",
          }}
        >
          <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: "260px" }}>
              <div
                style={{
                  fontSize: "12px",
                  color: "#94a3b8",
                  marginBottom: "6px",
                }}
              >
                Fleet
              </div>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                {STANDARD_FLEET.map((s) => {
                  const isPlaced = placedShips.some((p) => p.id === s.id);
                  const isSelected = selectedShipId === s.id;
                  return (
                    <button
                      key={s.id}
                      onClick={() => setSelectedShipId(s.id)}
                      disabled={mySlice?.placementConfirmed}
                      style={{
                        padding: "8px 10px",
                        borderRadius: "10px",
                        border: isSelected
                          ? "2px solid #4CAF50"
                          : "1px solid #3a3a5c",
                        backgroundColor: isPlaced ? "#153b2b" : "#16213e",
                        color: "#e4e4e4",
                        cursor: mySlice?.placementConfirmed
                          ? "not-allowed"
                          : "pointer",
                        fontSize: "12px",
                        display: "flex",
                        gap: "8px",
                        alignItems: "center",
                      }}
                      title={
                        isPlaced ? "Placed (click to reposition)" : "Not placed"
                      }
                    >
                      <span style={{ opacity: isPlaced ? 1 : 0.7 }}>
                        {s.name}
                      </span>
                      <span style={{ color: "#94a3b8" }}>({s.size})</span>
                      {isPlaced && <span style={{ color: "#6fcf6f" }}>✓</span>}
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{ minWidth: "260px" }}>
              <div
                style={{
                  fontSize: "12px",
                  color: "#94a3b8",
                  marginBottom: "6px",
                }}
              >
                Controls
              </div>
              <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                <button
                  onClick={() =>
                    setOrientation((o) =>
                      o === "horizontal" ? "vertical" : "horizontal",
                    )
                  }
                  disabled={mySlice?.placementConfirmed}
                  style={{
                    padding: "10px 12px",
                    borderRadius: "10px",
                    border: "1px solid #3a3a5c",
                    backgroundColor: "#16213e",
                    color: "#e4e4e4",
                    cursor: mySlice?.placementConfirmed
                      ? "not-allowed"
                      : "pointer",
                  }}
                >
                  Rotate: {orientation === "horizontal" ? "→" : "↓"}
                </button>
                <button
                  onClick={handleRandomize}
                  disabled={mySlice?.placementConfirmed}
                  style={{
                    padding: "10px 12px",
                    borderRadius: "10px",
                    border: "1px solid #3a3a5c",
                    backgroundColor: "#1e293b",
                    color: "#e4e4e4",
                    cursor: mySlice?.placementConfirmed
                      ? "not-allowed"
                      : "pointer",
                  }}
                >
                  Randomize
                </button>
                <button
                  onClick={handleResetPlacement}
                  disabled={mySlice?.placementConfirmed}
                  style={{
                    padding: "10px 12px",
                    borderRadius: "10px",
                    border: "1px solid #3a3a5c",
                    backgroundColor: "#2b1b1b",
                    color: "#fecaca",
                    cursor: mySlice?.placementConfirmed
                      ? "not-allowed"
                      : "pointer",
                  }}
                >
                  Reset
                </button>
                <button
                  onClick={handleConfirmPlacement}
                  disabled={mySlice?.placementConfirmed || !allShipsPlaced}
                  style={{
                    padding: "10px 14px",
                    borderRadius: "10px",
                    border: "none",
                    backgroundColor:
                      mySlice?.placementConfirmed || !allShipsPlaced
                        ? "#374151"
                        : "#4CAF50",
                    color: "white",
                    cursor:
                      mySlice?.placementConfirmed || !allShipsPlaced
                        ? "not-allowed"
                        : "pointer",
                    fontWeight: 700,
                  }}
                >
                  Confirm Placement
                </button>
              </div>
            </div>
          </div>

          {placementStatus && (
            <div
              style={{
                marginTop: "12px",
                fontSize: "13px",
                color: placementStatus.color,
              }}
            >
              {placementStatus.text}
            </div>
          )}
          {placementError && (
            <div
              style={{ marginTop: "10px", fontSize: "13px", color: "#fca5a5" }}
            >
              {placementError}
            </div>
          )}
          {mySlice?.commitmentRootHex && (
            <div
              style={{
                marginTop: "12px",
                fontSize: "12px",
                color: "#94a3b8",
                wordBreak: "break-all",
              }}
            >
              Commitment root:{" "}
              <span style={{ color: "#e2e8f0" }}>
                {mySlice.commitmentRootHex}
              </span>
            </div>
          )}
        </div>
      )}

      {isBattle && (
        <div
          style={{
            padding: "12px",
            backgroundColor: isMyTurn ? "#1a4a3a" : "#3d2a1a",
            borderRadius: "10px",
            marginBottom: "16px",
            textAlign: "center",
            border: "1px solid #3a3a5c",
          }}
        >
          {isMyTurn ? (
            <span style={{ color: "#6fcf6f", fontWeight: 700 }}>
              Your turn. Click a cell on the opponent grid.
            </span>
          ) : (
            <span style={{ color: "#ff9800" }}>Waiting for opponent…</span>
          )}
          {pendingGuessIndex !== null && (
            <div
              style={{ marginTop: "8px", fontSize: "12px", color: "#93c5fd" }}
            >
              Awaiting proof for {LETTERS[indexToCoord(pendingGuessIndex).x]}
              {indexToCoord(pendingGuessIndex).y + 1}…
            </div>
          )}
          {lastSignalError && (
            <div
              style={{ marginTop: "8px", fontSize: "12px", color: "#fca5a5" }}
            >
              {lastSignalError}
            </div>
          )}
        </div>
      )}

      <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
        {renderGrid({
          title: `Your Fleet${mySlice?.placementConfirmed ? "" : " (placement)"}`,
          onClick:
            isPlacement && !mySlice?.placementConfirmed
              ? handleGridClickPlacement
              : undefined,
          cellClass: myGridCell,
        })}
        {renderGrid({
          title: opponentId
            ? `Opponent Waters (Player ${opponentId})`
            : "Opponent Waters",
          onClick: isBattle ? handleGuessClick : undefined,
          cellClass: oppGridCell,
        })}
      </div>
    </div>
  );
};
