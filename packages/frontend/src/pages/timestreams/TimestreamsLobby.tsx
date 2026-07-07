import React, { useState, useEffect, useCallback, useRef } from 'react';
import { JoinCodeConnection, type JoinCodeState } from '../../p2p/discovery/join-code';
import type { Game } from 'boardgame.io';

// Home-era assignment mode. Defined locally so the Timestreams lobby no longer
// depends on the retired libp2p/DHT matchmaking module.
export type HomeEraAssignment = 'selectable' | 'random';

export interface TimestreamsLobbyProps {
  displayName: string;
  isHost: boolean;
  roomCode?: string;
  maxPlayers?: number;
  homeEraAssignment?: HomeEraAssignment;
  game: Game;
  onGameStart: (params: {
    connection: JoinCodeConnection;
    role: 'host' | 'guest';
    playerID: string;
    matchID: string;
    numPlayers: number;
    homeEraAssignment: HomeEraAssignment;
  }) => void;
  onError: (error: Error) => void;
}

const ERAS: string[] = ['stone', 'medieval', 'renaissance', 'industrial', 'modern', 'future'];
const ERA_LABELS: Record<string, string> = {
  stone: 'Stone Age',
  medieval: 'Medieval',
  renaissance: 'Renaissance',
  industrial: 'Industrial',
  modern: 'Modern',
  future: 'Future',
};

// Derive a match id that is identical on both peers from the shared offer code.
function matchIdFromOffer(offerCode: string): string {
  return 'ts_' + offerCode.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24);
}

const boxStyle: React.CSSProperties = {
  margin: '10px 0',
  padding: 10,
  background: '#1e2937',
  borderRadius: 6,
};

const codeStyle: React.CSSProperties = {
  fontFamily: 'monospace',
  fontSize: '0.75em',
  wordBreak: 'break-all',
  background: '#0f172a',
  padding: 8,
  borderRadius: 4,
  margin: '6px 0',
  maxHeight: 120,
  overflow: 'auto',
};

/**
 * Timestreams lobby — zero-infrastructure P2P via manual two-way join codes.
 *
 * Host: creates an invite (offer) code, shares it, then pastes the guest's
 * answer code to complete the WebRTC handshake.
 * Guest: pastes the host's invite code, sends the generated answer code back,
 * and waits for the host to accept it.
 *
 * The retired libp2p/DHT matchmaking service is no longer used here.
 */
export const TimestreamsLobby: React.FC<TimestreamsLobbyProps> = ({
  displayName,
  isHost,
  maxPlayers = 2,
  homeEraAssignment: initialHomeEra = 'selectable',
  onGameStart,
  onError,
}) => {
  const [homeEraAssignment, setHomeEraAssignment] = useState<HomeEraAssignment>(initialHomeEra);
  const [eraClaims, setEraClaims] = useState<Record<string, string>>({});

  const [phase, setPhase] = useState<JoinCodeState['phase']>('idle');
  const [offerCode, setOfferCode] = useState<string>('');   // host: our offer / guest: pasted-then-shown
  const [answerCode, setAnswerCode] = useState<string>('');  // guest: our answer / host: pasted answer
  const [pastedOffer, setPastedOffer] = useState<string>(''); // guest input
  const [pastedAnswer, setPastedAnswer] = useState<string>(''); // host input
  const [error, setError] = useState<string>('');
  const [copied, setCopied] = useState<string>('');

  const connRef = useRef<JoinCodeConnection | null>(null);
  const startedRef = useRef(false);
  // Host must remember its own offer code so it can derive the shared matchID
  // once the connection is established.
  const offerRef = useRef<string>('');

  const finishStart = useCallback((role: 'host' | 'guest') => {
    if (startedRef.current) return;
    const conn = connRef.current;
    if (!conn) return;
    startedRef.current = true;
    onGameStart({
      connection: conn,
      role,
      playerID: role === 'host' ? '0' : '1',
      matchID: matchIdFromOffer(offerRef.current),
      numPlayers: 2,
      homeEraAssignment,
    });
  }, [onGameStart, homeEraAssignment]);

  // Create the connection object once, wired to drive the manual exchange UI.
  useEffect(() => {
    const conn = new JoinCodeConnection({
      onStateChange: (state) => {
        setPhase(state.phase);
        if (state.phase === 'waiting-for-answer') {
          offerRef.current = state.offerCode;
          setOfferCode(state.offerCode);
        } else if (state.phase === 'waiting-for-host') {
          setAnswerCode(state.answerCode);
        } else if (state.phase === 'connected') {
          finishStart(isHost ? 'host' : 'guest');
        } else if (state.phase === 'error') {
          setError(state.error);
          onError(new Error(state.error));
        }
      },
      onMessage: () => {},
      onConnectionStateChange: () => {},
    });
    connRef.current = conn;

    // Host proactively creates its offer so the invite code is ready to share.
    if (isHost) {
      conn.createGame().catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        onError(err instanceof Error ? err : new Error(msg));
      });
    }

    return () => {
      // Once the game has started, ownership of the live WebRTC connection
      // transfers to the game client — closing it here would tear down the
      // connection we just handed over. Only clean up if we never started.
      if (!startedRef.current) {
        conn.close();
      }
      connRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHost]);

  const copy = useCallback((label: string, value: string) => {
    navigator.clipboard.writeText(value).then(() => {
      setCopied(label);
      setTimeout(() => setCopied(''), 2000);
    });
  }, []);

  const guestGenerateAnswer = useCallback(async () => {
    const conn = connRef.current;
    if (!conn) return;
    const code = pastedOffer.trim();
    if (!code) return;
    offerRef.current = code; // guest shares the same offer code → same matchID
    try {
      const ans = await conn.joinGame(code);
      setAnswerCode(ans);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    }
  }, [pastedOffer]);

  const hostAcceptAnswer = useCallback(async () => {
    const conn = connRef.current;
    if (!conn) return;
    const code = pastedAnswer.trim();
    if (!code) return;
    try {
      await conn.acceptAnswer(code);
      // 'connected' state will trigger finishStart via onStateChange.
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    }
  }, [pastedAnswer]);

  const handleClaimEra = (era: string) => {
    setEraClaims((prev) => ({ ...prev, [displayName]: era }));
  };

  const startLocalTest = () => {
    if (startedRef.current) return;
    startedRef.current = true;
    onGameStart({
      connection: null as unknown as JoinCodeConnection,
      role: 'host',
      playerID: '0',
      matchID: 'local_test_' + Date.now(),
      numPlayers: 2,
      homeEraAssignment,
    });
  };

  const connecting = phase === 'connecting';
  const connected = phase === 'connected';

  return (
    <div style={{ padding: 20, maxWidth: 700, margin: '0 auto', background: '#0f172a', color: '#e2e8f0' }}>
      <h2>Timestreams Lobby</h2>
      <p>
        Player: {displayName} | Mode: {isHost ? 'Host' : 'Guest'} | Serverless P2P (join codes)
      </p>

      {error && (
        <p style={{ color: '#f87171' }}>
          Connection note: {error}. You can still use “Start Local Test” below.
        </p>
      )}

      {/* Host manual-exchange flow */}
      {isHost && !connected && (
        <div style={boxStyle}>
          <h3>Invite a player (no server needed)</h3>
          <p style={{ fontSize: '0.9em', margin: '4px 0' }}>
            <strong>Step 1.</strong> Send this invite code to your opponent:
          </p>
          {offerCode ? (
            <>
              <div style={codeStyle}>{offerCode}</div>
              <button onClick={() => copy('invite', offerCode)} style={{ padding: '4px 8px' }}>
                {copied === 'invite' ? 'Copied!' : 'Copy Invite Code'}
              </button>
            </>
          ) : (
            <p style={{ color: '#94a3b8' }}>Generating invite code…</p>
          )}

          <p style={{ fontSize: '0.9em', margin: '12px 0 4px' }}>
            <strong>Step 2.</strong> Paste the answer code they send back:
          </p>
          <textarea
            value={pastedAnswer}
            onChange={(e) => setPastedAnswer(e.target.value)}
            placeholder="Paste answer code here…"
            style={{ width: '100%', minHeight: 70, fontFamily: 'monospace', fontSize: '0.75em' }}
          />
          <button
            onClick={hostAcceptAnswer}
            disabled={!pastedAnswer.trim() || connecting}
            style={{ padding: '6px 10px', marginTop: 6 }}
          >
            {connecting ? 'Connecting…' : 'Connect'}
          </button>
        </div>
      )}

      {/* Guest manual-exchange flow */}
      {!isHost && !connected && (
        <div style={boxStyle}>
          <h3>Join a game (no server needed)</h3>
          <p style={{ fontSize: '0.9em', margin: '4px 0' }}>
            <strong>Step 1.</strong> Paste the host's invite code:
          </p>
          <textarea
            value={pastedOffer}
            onChange={(e) => setPastedOffer(e.target.value)}
            placeholder="Paste invite code here…"
            disabled={!!answerCode}
            style={{ width: '100%', minHeight: 70, fontFamily: 'monospace', fontSize: '0.75em' }}
          />
          {!answerCode && (
            <button
              onClick={guestGenerateAnswer}
              disabled={!pastedOffer.trim()}
              style={{ padding: '6px 10px', marginTop: 6 }}
            >
              Generate Answer Code
            </button>
          )}

          {answerCode && (
            <>
              <p style={{ fontSize: '0.9em', margin: '12px 0 4px' }}>
                <strong>Step 2.</strong> Send this answer code back to the host, then wait:
              </p>
              <div style={codeStyle}>{answerCode}</div>
              <button onClick={() => copy('answer', answerCode)} style={{ padding: '4px 8px' }}>
                {copied === 'answer' ? 'Copied!' : 'Copy Answer Code'}
              </button>
              <p style={{ color: '#94a3b8', marginTop: 8 }}>Waiting for host to connect…</p>
            </>
          )}
        </div>
      )}

      {connected && <p style={{ color: '#22c55e' }}>Connected! Starting game…</p>}

      {/* Host-only pre-game options */}
      {isHost && !connected && (
        <div style={{ marginTop: 16 }}>
          <label>Home Era Assignment: </label>
          <select
            value={homeEraAssignment}
            onChange={(e) => setHomeEraAssignment(e.target.value as HomeEraAssignment)}
          >
            <option value="selectable">Selectable (claim eras)</option>
            <option value="random">Random (fair)</option>
          </select>

          {homeEraAssignment === 'selectable' && (
            <div style={{ margin: '12px 0' }}>
              <h4 style={{ margin: '6px 0' }}>Claim Home Era</h4>
              {ERAS.map((era) => {
                const isMine = eraClaims[displayName] === era;
                return (
                  <button
                    key={era}
                    onClick={() => handleClaimEra(era)}
                    style={{ margin: 4, background: isMine ? '#22c55e' : '#1e40af', color: 'white' }}
                  >
                    {ERA_LABELS[era]}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div style={{ marginTop: 20 }}>
        <button onClick={startLocalTest} style={{ background: '#334155' }}>
          Start Local Test (board, no network)
        </button>
        <p style={{ fontSize: '0.8em', color: '#94a3b8' }}>
          Local test opens the board on this machine only. For real multiplayer, complete the
          two-way invite/answer exchange above — no server required.
        </p>
      </div>

      <p style={{ fontSize: '0.75em', color: '#64748b', marginTop: 12 }}>
        Players ≤ {maxPlayers}. Serverless join-code P2P is 1-vs-1; peers behind symmetric NAT may
        need a TURN relay (inherent WebRTC limitation).
      </p>
    </div>
  );
};
