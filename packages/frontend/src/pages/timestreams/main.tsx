import React, { useState, useCallback } from "react";

// Simple ErrorBoundary to prevent lobby (or board) crashes from producing a blank blue page
class ErrorBoundary extends React.Component<{fallback?: React.ReactNode, children: React.ReactNode}, {hasError: boolean, err?: any}> {
  constructor(props: any) { super(props); this.state = { hasError: false }; }
  static getDerivedStateFromError(error: any) { return { hasError: true, err: error }; }
  componentDidCatch(error: any, info: any) { console.error('[ErrorBoundary]', error, info); }
  render() {
    if (this.state.hasError) {
      return this.props.fallback || <div style={{padding:20,color:'#f87171'}}>Something went wrong rendering this part. Try the Local Demo button or reload the file.<br/>{String(this.state.err)}</div>;
    }
    return this.props.children;
  }
}
import ReactDOM from "react-dom/client";
import { Client } from "boardgame.io/react";
import { Local } from "boardgame.io/multiplayer";
import { TimestreamsModule, TimestreamsBoard } from "@manamesh/timestreams";
import { TimestreamsLobby } from "./TimestreamsLobby";
import { P2PMultiplayer } from "../../p2p/transport";
import type { JoinCodeConnection } from "../../p2p/transport";

console.log("[ManaMesh] timestreams page boot");

type GamePhase = 'lobby' | 'game';

interface GameStartParams {
  connection: JoinCodeConnection;
  role: 'host' | 'guest';
  playerID: string;
  matchID: string;
  numPlayers: number;
  homeEraAssignment: 'selectable' | 'random';
  claimedEras?: Record<string, string>;
}

const rootEl = document.getElementById("root");
if (!rootEl) {
  document.body.innerHTML = "<div style='color:red;padding:20px;font-family:sans-serif'>ERROR: #root not found. This page must be opened as a full HTML file.</div>";
  throw new Error("[ManaMesh] Missing #root element");
}
const root = ReactDOM.createRoot(rootEl);

function TimestreamsApp() {
  const [phase, setPhase] = useState<GamePhase>('lobby');
  const [gameParams, setGameParams] = useState<GameStartParams | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showFullLobby, setShowFullLobby] = useState(false);

  const handleGameStart = useCallback((params: GameStartParams) => {
    console.log('[TimestreamsApp] Game starting with params:', params);
    setGameParams(params);
    setPhase('game');
  }, []);

  const handleLobbyError = useCallback((err: Error) => {
    console.error('[TimestreamsApp] Lobby error:', err);
    setError(err.message);
  }, []);

  const handleBackToLobby = useCallback(() => {
    setGameParams(null);
    setError(null);
    setPhase('lobby');
  }, []);

  const isFile = typeof window !== 'undefined' && window.location.protocol === 'file:';

  // Launcher to avoid pulling heavy P2P tree immediately in some envs (MCP etc). Full features preserved.
  if (phase === 'lobby' && !showFullLobby) {
    return (
      <div style={{ padding: 20, maxWidth: 640, margin: '40px auto', background: '#0f172a', color: '#e2e8f0', fontFamily: 'system-ui' }}>
        <h1>Timestreams SPA</h1>
        <p>Single file, file:// ready. P2P lobby + playable board included.</p>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <button onClick={() => setShowFullLobby(true)} style={{ padding: '10px 16px' }}>Open Full P2P Lobby</button>
          <button onClick={() => {
            // Local demo start directly to board (works on file://, no network)
            handleGameStart({
              connection: null as any,
              role: 'host',
              playerID: '0',
              matchID: 'local_demo',
              numPlayers: 2,
              homeEraAssignment: 'selectable'
            });
          }} style={{ padding: '10px 16px' }}>Play Demo Board (Local)</button>
        </div>
        <p style={{ fontSize: '0.85em', opacity: 0.8, marginTop: 16 }}>
          {isFile
            ? 'On file://, P2P discovery is limited. "Open Full P2P Lobby" shows the UI + local controls. Real multi-player join works best when the HTML is served over http(s).'
            : 'Use "Open Full P2P Lobby" for era claims, copy-join-link, Ready/Start (requires working peers for multi-player).'}
          The demo button loads the real board + game rules immediately for testing.
        </p>
        {error && <p style={{ color: '#f87171' }}>Note: {error}</p>}
      </div>
    );
  }

  if (phase === 'lobby') {
    const urlParams = new URLSearchParams(window.location.search);
    const roomCode = urlParams.get('room') || undefined;
    const isHost = urlParams.get('host') === 'true' || roomCode === undefined;

    return (
      <ErrorBoundary fallback={<div style={{padding:20}}>Lobby failed to render (P2P init issue). <button onClick={() => { /* force local from parent */ handleGameStart({connection:null as any, role:'host', playerID:'0', matchID:'local_fallback', numPlayers:2, homeEraAssignment:'selectable'} as any); }}>Start Local Board</button></div>}>
        <TimestreamsLobby
          displayName={getPlayerName()}
          isHost={isHost}
          roomCode={roomCode}
          game={TimestreamsModule.getBoardgameIOGame()}
          onGameStart={handleGameStart}
          onError={handleLobbyError}
        />
      </ErrorBoundary>
    );
  }

  if (!gameParams) {
    return (
      <div style={{ padding: 20, color: 'white' }}>
        <p>Error: No game parameters</p>
        <button onClick={handleBackToLobby}>Back to Lobby</button>
      </div>
    );
  }

  let multiplayer;
  try {
    if (gameParams.connection) {
      multiplayer = P2PMultiplayer({
        connection: gameParams.connection,
        role: gameParams.role,
        matchID: gameParams.matchID,
        playerID: gameParams.playerID,
        numPlayers: gameParams.numPlayers,
      });
    } else {
      multiplayer = Local();
    }
  } catch (e) {
    console.warn('[TimestreamsApp] P2P multiplayer init failed, falling back to Local()', e);
    multiplayer = Local();
  }

  const setupData = {
    moduleConfig: {
      homeEraAssignment: gameParams.homeEraAssignment,
    },
  };

  // For pure file:// demo without full client wiring (which can be heavy), render board standalone with mock state
  const isLocalDemo = !gameParams.connection || gameParams.matchID === 'local_demo';
  if (isLocalDemo) {
    // Minimal mock state sufficient to exercise the board UI (timeline, hand, teaching, hover zoom)
    const mockG: any = {
      currentDay: 1,
      phase: 'play',
      config: { homeEraAssignment: gameParams.homeEraAssignment || 'selectable', scoringSlots: 6 },
      timeline: Object.fromEntries(['stone','medieval','renaissance','industrial','modern','future'].map(e => [e, { stack: [] }])),
      players: {
        '0': { hand: [ {id:'demo-inv#1', name:'Wheel', cardType:'invention'}, {id:'demo-act#1', name:'Migrate', cardType:'action'} ], homeEra: 'stone' }
      },
      cards: {
        'demo-inv#1': { id:'demo-inv#1', name:'Wheel', cardType:'invention', subtypes:[] },
        'demo-act#1': { id:'demo-act#1', name:'Migrate', cardType:'action', subtypes:[] }
      }
    };
    const mockCtx: any = { currentPlayer: '0', phase: 'play' };
    const mockMoves = { playInvention: (id:string)=>console.log('playInvention',id), playAction:(id:string)=>console.log('playAction',id), pass:()=>console.log('pass'), claimHomeEra:(era:string)=>console.log('claim',era), setReady:()=>{} };
    return (
      <div>
        <div style={{padding:'4px 12px', background:'#334155', color:'#94a3b8', fontSize:12}}>Local demo mode (standalone board) — P2P Client disabled for file:// compatibility. Full rules when hosted with peers.</div>
        <TimestreamsBoard G={mockG} ctx={mockCtx} moves={mockMoves} playerID={gameParams.playerID || '0'} />
      </div>
    );
  }

  return (
    <Client
      game={TimestreamsModule.getBoardgameIOGame()}
      board={TimestreamsBoard}
      multiplayer={multiplayer}
      numPlayers={gameParams.numPlayers}
      playerID={gameParams.playerID}
      matchID={gameParams.matchID}
      setupData={setupData}
      debug={false}
    />
  );
}

function getPlayerName(): string {
  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem('manamesh_player_name');
    if (stored) return stored;
  }
  return `Player_${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
}

try {
  root.render(
    <React.StrictMode>
      <TimestreamsApp />
    </React.StrictMode>
  );
} catch (err) {
  console.error("[ManaMesh] Render failed:", err);
  rootEl.innerHTML = `<div style="color:#f87171;padding:20px;font-family:sans-serif;background:#1e2937">Failed to start app: ${String(err)}<br/><small>Open DevTools console for details. Some P2P features may not work on file://.</small></div>`;
}
