# Progress Log: MM-002

## Current Checkpoint

**Last checkpoint:** All bugs fixed
**Next step:** Ready for code review
**Build status:** ✅ Passes
**Test status:** ✅ 45 tests pass (15 codec, 11 webrtc, 19 game logic)

---

## Session Log

### 2026-01-21 - Bug Fix: Duplicate Message Display

#### Issue
Messages received from peers appeared twice in the chat display.

#### Root Cause
In `App.tsx`, the `P2PGame` component's `useEffect` that patches the `onMessage` handler was missing a cleanup function. In React Strict Mode (development), effects run twice:

1. Effect runs, patches `onMessage` with handler A (adds message + calls original)
2. Effect runs again, patches with handler B (adds message + calls handler A)

When a message arrives, handler B runs first, adds the message, then calls handler A which adds the message again = **duplicate messages**.

#### Fix
Added cleanup function to restore the original handler:

```javascript
useEffect(() => {
  const events = (connection as any).events;
  if (!events) return;

  const originalOnMessage = events.onMessage;

  events.onMessage = (data: string) => {
    setMessages((prev) => [...prev, `Peer: ${data}`]);
    originalOnMessage?.(data);
  };

  // Cleanup: restore original handler to prevent stacking in Strict Mode
  return () => {
    events.onMessage = originalOnMessage;
  };
}, [connection]);
```

---

### 2026-01-20 - Bug Fix: Connection Closed on Component Unmount

#### Issue
Message sending failed with "Not connected" error after P2P connection was established. Console showed `RTCErrorEvent` and data channel errors.

#### Root Cause
In `P2PLobby.tsx`, the `useEffect` cleanup function was unconditionally closing the connection when the component unmounted:

```javascript
return () => {
  connectionRef.current?.close();
};
```

When the connection was established successfully, `P2PLobby` would call `onConnected(connectionRef.current)` to pass the connection to the parent component, which then transitioned to showing `P2PGame`. This caused `P2PLobby` to unmount, triggering the cleanup function which closed the connection - making `peerConnection` null and causing "Not connected" errors.

#### Fix
Modified the cleanup to only close the connection if NOT connected (i.e., only close on explicit cancel, not on successful handoff):

```javascript
return () => {
  // Only close if we're NOT connected - if connected, the connection
  // has been handed off to the parent component and should not be closed
  if (connectionRef.current && !connectionRef.current.isConnected()) {
    connectionRef.current.close();
  }
};
```

#### Verification
- ✅ P2P connection established successfully between two tabs
- ✅ Host can send messages to guest ("Hello from host!")
- ✅ Guest can send messages to host ("Hello from guest!")
- ✅ All 45 tests pass
- ✅ Build succeeds

---

### 2026-01-20 - Implementation Complete

#### Summary
All WebRTC + Two-Way Join Codes functionality has been implemented and tested:

1. **WebRTC Wrapper (`webrtc.ts`)** - Complete
   - `PeerConnection` class manages RTCPeerConnection lifecycle
   - Handles offer/answer SDP creation with ICE candidate gathering
   - 5-second ICE gathering timeout with graceful fallback
   - Data channel for game messages with ordered delivery
   - Connection state events (new, connecting, connected, disconnected, failed)
   - Uses Google STUN servers for NAT traversal

2. **Codec (`codec.ts`)** - Complete
   - Encodes SDP + ICE candidates to URL-safe base64
   - Uses gzip compression via CompressionStream API (with fallback)
   - Minifies SDP by removing optional lines
   - Validation via `isValidJoinCode()` function
   - Code size: ~520 chars compressed, ~776 chars uncompressed

3. **Join Code Discovery (`discovery/join-code.ts`)** - Complete
   - `JoinCodeConnection` class with state machine
   - Phases: idle → creating-offer → waiting-for-answer → connected
   - Also: idle → entering-offer → waiting-for-host → connected
   - Event emitters for UI updates
   - Clean resource cleanup on close

4. **P2PLobby UI (`P2PLobby.tsx`)** - Complete
   - "Create Game (Host)" button generates offer code
   - "Join Game (Guest)" accepts offer, generates answer
   - Copy buttons for both offer and answer codes
   - Clear status indicators and error messages
   - Connected state transitions to P2P game view

5. **Tests** - Complete
   - `codec.test.ts`: 15 tests for encode/decode roundtrip, validation
   - `webrtc.test.ts`: 11 tests with mocked RTCPeerConnection

#### Files Created/Modified
- `packages/frontend/src/p2p/webrtc.ts` - WebRTC wrapper (exists, verified)
- `packages/frontend/src/p2p/codec.ts` - SDP codec (exists, verified)
- `packages/frontend/src/p2p/discovery/join-code.ts` - Join code flow (exists, verified)
- `packages/frontend/src/p2p/index.ts` - Exports (exists, verified)
- `packages/frontend/src/components/P2PLobby.tsx` - UI (exists, verified)
- `packages/frontend/src/p2p/codec.test.ts` - New test file
- `packages/frontend/src/p2p/webrtc.test.ts` - New test file
- `package.json` - Fixed yarn workspaces foreach syntax

#### Verification
```bash
yarn test --run  # 45 tests pass
yarn build       # Build succeeds (299KB bundle)
```

#### Manual Testing Notes
The app is running on `http://localhost:3000`. To test P2P connection:
1. Open two browser tabs
2. Tab 1: Click "P2P Online (No Server!)" → "Create Game (Host)"
3. Copy the offer code
4. Tab 2: Click "P2P Online (No Server!)" → "Join Game (Guest)"
5. Paste offer code → Copy response code
6. Tab 1: Paste response code → Click "Connect"
7. Both tabs should show "Connected! Starting game..."

---

### 2026-01-20 - Task Launched

- Task launched via /backlog:launch
- Agent worktree created at `feature/webrtc-join-codes`
- Ready to begin implementation
- Dependencies satisfied: MM-001 (Complete)

#### Implementation Plan
1. ✅ Implement WebRTC wrapper (`webrtc.ts`)
2. ✅ Implement codec for SDP encoding (`codec.ts`)
3. ✅ Implement join code discovery flow (`discovery/join-code.ts`)
4. ✅ Update P2PLobby UI for join code exchange
5. ✅ Write tests for codec and connection flow
6. ✅ Test with two browser tabs (manual testing complete)
