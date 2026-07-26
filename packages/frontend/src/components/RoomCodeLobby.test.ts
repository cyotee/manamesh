/**
 * Structural + behavioral checks for host password / create-table flow.
 * Host must not open Trystero until Create table is clicked (so password can be set).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const srcPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "RoomCodeLobby.tsx",
);
const src = readFileSync(srcPath, "utf8");

describe("RoomCodeLobby host password + create flow", () => {
  it("does not auto-call connectQuick on mount for hosts", () => {
    // Old bug: useEffect void connectQuick() on mount with empty password
    expect(src).not.toMatch(/void\s+connectQuick\(\)\s*;\s*\n\s*return\s*\(\)\s*=>/);
    // Mount effect only handles joinCode mode / cleanup — not auto-create
    expect(src).toContain("Do NOT auto-open a Trystero");
  });

  it("exposes Create table control and keeps password editable until sessionReady", () => {
    expect(src).toContain('data-testid="host-create-table"');
    expect(src).toContain("Create table");
    expect(src).toContain("hostCanCreate");
    // Password disabled only when sessionReady (after create), not on mount
    expect(src).toMatch(/disabled=\{sessionReady\}/);
    expect(src).toContain("Set before creating table");
  });

  it("guest still has Connect button (not auto-join)", () => {
    expect(src).toContain('data-testid="join-quick"');
    expect(src).toContain("Connect");
  });
});

describe("Poker lobby role remount", () => {
  it("keys RoomCodeLobby by lobby role so Host/Guest switch remounts", () => {
    const pokerMain = readFileSync(
      path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        "../pages/poker/main.tsx",
      ),
      "utf8",
    );
    expect(pokerMain).toMatch(/key=\{`poker-lobby-\$\{lobbyRole\}`\}/);
  });
});
