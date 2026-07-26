import { describe, it, expect, vi } from "vitest";
import {
  tryQuickConnect,
  PasswordAuthError,
} from "./orchestrator";
import type { TrysteroTableSession } from "@cyotee/boardgameio-p2p/trystero";

function mockSession(
  partial: Partial<TrysteroTableSession> = {},
): TrysteroTableSession {
  return {
    role: "host",
    playerID: "0",
    seatMap: new Map([["0", "self"]]),
    hostConnections: new Map(),
    leave: () => {},
    getSeatedPlayerIDs: () => ["0"],
    ...partial,
  };
}

describe("tryQuickConnect", () => {
  it("returns trystero success when joinTable resolves", async () => {
    const session = mockSession();
    const joinTable = vi.fn().mockResolvedValue(session);
    const result = await tryQuickConnect({
      gameId: "timestreams",
      role: "host",
      roomCode: "ABCDEFG",
      maxPlayers: 4,
      mode: "trystero",
      joinTable: joinTable as any,
    });
    expect(result.backend).toBe("trystero");
    if (result.backend === "trystero") {
      expect(result.session).toBe(session);
      expect(result.playerID).toBe("0");
      expect(result.roomCode).toBe("ABCDEFG");
    }
    expect(joinTable).toHaveBeenCalled();
  });

  it("falls back to joinCode on timeout in auto mode", async () => {
    const joinTable = vi
      .fn()
      .mockRejectedValue(new Error("trystero_connect_timeout"));
    const result = await tryQuickConnect({
      gameId: "poker",
      role: "guest",
      roomCode: "ABCDEFG",
      maxPlayers: 6,
      mode: "auto",
      joinTable: joinTable as any,
    });
    expect(result.backend).toBe("fallback-joinCode");
    if (result.backend === "fallback-joinCode") {
      expect(result.reason).toContain("timeout");
    }
  });

  it("does not fallback on handshake reject (password/auth)", async () => {
    const joinTable = vi
      .fn()
      .mockRejectedValue(new Error("trystero_handshake_reject:second_host"));
    await expect(
      tryQuickConnect({
        gameId: "timestreams",
        role: "guest",
        roomCode: "ABCDEFG",
        maxPlayers: 2,
        mode: "auto",
        joinTable: joinTable as any,
      }),
    ).rejects.toBeInstanceOf(PasswordAuthError);
  });

  it("joinCode mode skips trystero", async () => {
    const joinTable = vi.fn();
    const result = await tryQuickConnect({
      gameId: "onepiece",
      role: "host",
      roomCode: "ABCDEFG",
      maxPlayers: 2,
      mode: "joinCode",
      joinTable: joinTable as any,
    });
    expect(result.backend).toBe("fallback-joinCode");
    expect(joinTable).not.toHaveBeenCalled();
  });

  it("passes optional password into joinTable for protected tables", async () => {
    const session = mockSession();
    const joinTable = vi.fn().mockResolvedValue(session);
    await tryQuickConnect({
      gameId: "timestreams",
      role: "host",
      roomCode: "ABCDEFG",
      password: "secret-table",
      maxPlayers: 4,
      mode: "trystero",
      joinTable: joinTable as any,
    });
    expect(joinTable).toHaveBeenCalledWith(
      expect.objectContaining({
        password: "secret-table",
        roomCode: "ABCDEFG",
        role: "host",
      }),
    );
  });
});
