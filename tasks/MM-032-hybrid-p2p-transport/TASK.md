# Task MM-032: Hybrid P2P Transport with Configurable Options

**Repo:** ManaMesh
**Status:** Ready
**Created:** 2026-01-28
**Dependencies:** MM-002, MM-003, MM-004
**Worktree:** `feature/hybrid-p2p-transport`

---

## Description

Implement a hybrid P2P transport layer that eliminates Google STUN server dependency by detecting network conditions and selecting the optimal transport strategy. The system supports four transport types (LAN/mDNS, Direct IP, libp2p Circuit Relay, Join Code fallback) with user-configurable settings to enable/disable each transport, force specific transports for testing, and persist preferences via localStorage and URL parameters.

## Dependencies

- MM-002: WebRTC + Two-Way Join Codes (base WebRTC infrastructure being modified)
- MM-003: libp2p DHT Discovery (circuit relay infrastructure)
- MM-004: mDNS Local Discovery (LAN detection capability)

## User Stories

### US-MM-032.1: Sequential Transport Fallback

As a player, I want the app to automatically try different connection methods in order so that I can connect to peers without manually configuring network settings.

**Acceptance Criteria:**
- [ ] Transport manager attempts enabled transports in priority order: LAN → Direct IP → Circuit Relay → Join Code
- [ ] Failed transports are skipped with appropriate timeout (e.g., 5s per transport)
- [ ] Console logs explain which transport was attempted and why it succeeded/failed
- [ ] Connection succeeds on first working transport without trying remaining options

### US-MM-032.2: Transport Settings UI

As a user, I want to configure which transport methods are enabled so that I can optimize for my network environment or testing needs.

**Acceptance Criteria:**
- [ ] P2P Lobby displays inline transport toggle switches for each of the 4 transport types
- [ ] Settings modal provides detailed transport configuration with descriptions
- [ ] Each transport can be independently enabled/disabled
- [ ] UI shows current transport status badge (e.g., "Connected via LAN", "Using Relay")
- [ ] Settings are reactive - changes take effect on next connection attempt

### US-MM-032.3: Force Transport Mode (Testing)

As a developer, I want to force a specific transport for testing so that I can verify each transport works independently.

**Acceptance Criteria:**
- [ ] "Force Transport" dropdown in settings allows selecting a single transport
- [ ] When forced, only that transport is attempted (no fallback)
- [ ] Clear visual indicator when in forced mode (e.g., warning badge)
- [ ] Force mode can be disabled to return to automatic selection

### US-MM-032.4: Settings Persistence

As a user, I want my transport settings to persist across sessions so that I don't have to reconfigure each time.

**Acceptance Criteria:**
- [ ] Transport settings saved to localStorage on change
- [ ] Settings restored from localStorage on app load
- [ ] URL parameters override localStorage (e.g., `?transport=relay`, `?transport=lan`)
- [ ] URL param `?transport=all` resets to default (all enabled)
- [ ] Settings can be cleared/reset to defaults via UI button

### US-MM-032.5: Transport Status Indicator

As a user, I want to see which transport method is currently in use so that I understand my connection quality and troubleshoot issues.

**Acceptance Criteria:**
- [ ] Visual badge in P2P lobby shows current transport type
- [ ] Badge color indicates transport type (e.g., green=LAN, blue=Relay, yellow=JoinCode)
- [ ] Hovering/clicking badge shows additional info (latency estimate, peer info)
- [ ] Badge updates if transport changes during session

### US-MM-032.6: Verbose Logging Mode

As a developer, I want detailed console logs about transport selection so that I can debug connection issues.

**Acceptance Criteria:**
- [ ] Logging toggle in settings enables verbose transport logs
- [ ] Logs include: transport attempted, detection result, timing, failure reason
- [ ] Logs are prefixed with `[Transport]` for easy filtering
- [ ] Logging preference persists in localStorage

## Technical Details

### Transport Priority Order (Fixed)

1. **LAN/mDNS** - Same local network, no NAT traversal needed
2. **Direct IP** - Manual IP:port exchange for VPN/port-forwarded setups
3. **libp2p Circuit Relay** - NAT traversal via Protocol Labs relay nodes
4. **Join Code** - Current two-way SDP exchange (uses Google STUN as last resort)

### Transport Manager Interface

```typescript
interface TransportConfig {
  enabled: {
    lan: boolean;      // Default: true
    directIp: boolean; // Default: true
    relay: boolean;    // Default: true
    joinCode: boolean; // Default: true
  };
  forced: TransportType | null;  // null = auto-select
  verboseLogging: boolean;       // Default: false
}

type TransportType = 'lan' | 'directIp' | 'relay' | 'joinCode';

interface TransportResult {
  type: TransportType;
  connection: PeerConnection;
  latency?: number;
}

interface TransportManager {
  config: TransportConfig;
  connect(targetPeer: string): Promise<TransportResult>;
  getStatus(): TransportStatus;
  onStatusChange(callback: (status: TransportStatus) => void): void;
}
```

### URL Parameter Schema

- `?transport=lan` - Force LAN only
- `?transport=relay` - Force circuit relay only
- `?transport=joincode` - Force join code only
- `?transport=directip` - Force direct IP only
- `?transport=all` - Enable all (reset)
- `?transport=lan,relay` - Enable only specified transports

### Settings Storage Schema

```typescript
// localStorage key: 'manamesh_transport_config'
interface StoredTransportConfig {
  version: 1;
  enabled: Record<TransportType, boolean>;
  forced: TransportType | null;
  verboseLogging: boolean;
}
```

## Files to Create/Modify

**New Files:**
- `src/p2p/transport-manager.ts` - Core transport selection logic
- `src/p2p/transports/lan-transport.ts` - LAN/mDNS transport adapter
- `src/p2p/transports/direct-ip-transport.ts` - Manual IP transport adapter
- `src/p2p/transports/relay-transport.ts` - libp2p circuit relay adapter
- `src/p2p/transports/joincode-transport.ts` - Existing join code wrapped as adapter
- `src/components/TransportSettings.tsx` - Settings modal component
- `src/components/TransportBadge.tsx` - Status indicator component
- `src/hooks/useTransportConfig.ts` - React hook for config state + persistence

**Modified Files:**
- `src/p2p/webrtc.ts` - Make ICE_SERVERS configurable, add STUN-free option
- `src/components/P2PLobby.tsx` - Add inline transport toggles and badge
- `src/App.tsx` - Parse URL params for transport config on load

**Tests:**
- `src/p2p/transport-manager.test.ts` - Unit tests for fallback logic
- `src/p2p/transports/*.test.ts` - Tests for each transport adapter

## Inventory Check

Before starting, verify:
- [ ] MM-002 WebRTC infrastructure exists (`src/p2p/webrtc.ts`)
- [ ] MM-003 libp2p DHT exists (`src/p2p/libp2p-config.ts`)
- [ ] MM-004 mDNS exists (`src/p2p/discovery/mdns.ts`)
- [ ] P2PLobby component exists for UI integration
- [ ] Circuit relay transport is importable from `@libp2p/circuit-relay-v2`

## Completion Criteria

- [ ] All acceptance criteria met
- [ ] Tests pass for transport manager and each adapter
- [ ] Build succeeds with no new warnings
- [ ] Demo works: connection via LAN on same machine
- [ ] Demo works: connection via relay when LAN disabled
- [ ] Demo works: URL param `?transport=relay` forces relay mode
- [ ] Settings persist across page refresh
- [ ] No Google STUN servers used when relay or LAN transport succeeds

---

**When complete, output:** `<promise>TASK_COMPLETE</promise>`

**If blocked, output:** `<promise>TASK_BLOCKED: [reason]</promise>`
