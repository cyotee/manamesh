# Agent Task Assignment

**Task:** MM-002 - WebRTC + Two-Way Join Codes
**Repo:** ManaMesh
**Mode:** Implementation
**Task File:** tasks/MM-002.md
**Progress File:** tasks/MM-002-PROGRESS.md

## Dependencies

All dependencies are complete:

| Dependency | Status | Title |
|------------|--------|-------|
| MM-001 | Complete | Frontend Skeleton + boardgame.io Core |

## Required Reading

1. `tasks/MM-002.md` - Full requirements and acceptance criteria
2. `tasks/MM-002-PROGRESS.md` - Prior work and current state
3. `CLAUDE.md` - Repository context and commands

## Instructions

1. Read tasks/MM-002.md to understand requirements
2. Read tasks/MM-002-PROGRESS.md to see what's been done
3. Continue work from where you left off
4. **Update tasks/MM-002-PROGRESS.md** as you work (newest entries first)
5. When complete, output: `<promise>TASK_COMPLETE</promise>`
6. If blocked, output: `<promise>TASK_BLOCKED: [reason]</promise>`

## On Context Compaction

If your context is compacted or you're resuming work:
1. Re-read this PROMPT.md
2. Re-read tasks/MM-002-PROGRESS.md for your prior state
3. Continue from the last recorded progress

## Key Technical Context

### P2P Layer Location
- `packages/frontend/src/p2p/` - All P2P code lives here
- Existing files: `webrtc.ts`, `codec.ts`, `discovery/join-code.ts`, `index.ts`

### Files to Create/Modify
- `packages/frontend/src/p2p/webrtc.ts` - WebRTC wrapper (may need expansion)
- `packages/frontend/src/p2p/codec.ts` - SDP encoding/decoding (may need expansion)
- `packages/frontend/src/p2p/discovery/join-code.ts` - Join code flow
- `packages/frontend/src/components/P2PLobby.tsx` - UI for join code exchange

### Development Commands
```bash
yarn dev:frontend    # Start Vite dev server
yarn test           # Run Vitest tests
yarn build          # Type-check and build
```

## Completion Checklist

Before marking complete, verify:
- [ ] All acceptance criteria in tasks/MM-002.md are checked
- [ ] tasks/MM-002-PROGRESS.md has final summary
- [ ] Two browser tabs can connect via join codes
- [ ] Codec tests pass
- [ ] `yarn build` succeeds
- [ ] No server required for connection

## Troubleshooting

**If WebRTC connection fails:**
- Check browser console for ICE candidate errors
- Ensure STUN servers are accessible
- Try on localhost first before cross-network testing

**If codec produces oversized strings:**
- Check compression is working
- Ensure only essential SDP fields are included
- Target: codes under 500 characters
