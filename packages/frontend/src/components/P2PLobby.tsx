/**
 * P2P Lobby Component
 * Handles peer discovery via DHT (primary), mDNS (LAN), and two-way join codes (fallback)
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  JoinCodeConnection,
  type JoinCodeState,
  type ConnectionState,
  MDNSDiscovery,
  type LANGame,
  type MDNSState,
  DHTConnection,
  type DHTState,
  type PublicGame,
} from '../p2p';

interface P2PLobbyProps {
  onConnected: (connection: JoinCodeConnection | DHTConnection) => void;
  onBack: () => void;
}

type DiscoveryMethod = 'dht' | 'join-code';
type Mode = 'select' | 'host' | 'join' | 'browse' | 'lan';

export const P2PLobby: React.FC<P2PLobbyProps> = ({ onConnected, onBack }) => {
  // State
  const [discoveryMethod, setDiscoveryMethod] = useState<DiscoveryMethod>('dht');
  const [mode, setMode] = useState<Mode>('select');
  const [dhtState, setDhtState] = useState<DHTState>({ phase: 'idle' });
  const [joinCodeState, setJoinCodeState] = useState<JoinCodeState>({ phase: 'idle' });
  const [connectionState, setConnectionState] = useState<ConnectionState>('new');
  const [publicGames, setPublicGames] = useState<PublicGame[]>([]);

  // Form state
  const [roomCode, setRoomCode] = useState('');
  const [inputCode, setInputCode] = useState('');
  const [hostName, setHostName] = useState('');
  const [isPublicGame, setIsPublicGame] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // DHT offer/answer codes (for join-code fallback)
  const [offerCode, setOfferCode] = useState('');
  const [answerCode, setAnswerCode] = useState('');

  // LAN discovery state
  const [lanGames, setLanGames] = useState<LANGame[]>([]);
  const [mdnsState, setMdnsState] = useState<MDNSState>({ status: 'idle' });
  const [hostedLanGame, setHostedLanGame] = useState<LANGame | null>(null);
  const [gameName, setGameName] = useState('ManaMesh Game');

  // Connection refs
  const dhtConnectionRef = useRef<DHTConnection | null>(null);
  const joinCodeConnectionRef = useRef<JoinCodeConnection | null>(null);
  const mdnsRef = useRef<MDNSDiscovery | null>(null);

  // Initialize DHT connection
  useEffect(() => {
    dhtConnectionRef.current = new DHTConnection({
      onStateChange: (state) => {
        setDhtState(state);
        if (state.phase === 'error') {
          setError(state.error);
        }
        if (state.phase === 'waiting-for-guest' && 'roomCode' in state) {
          setRoomCode(state.roomCode);
        }
      },
      onMessage: (data) => {
        console.log('[P2PLobby] DHT message:', data);
      },
      onConnectionStateChange: (state) => {
        setConnectionState(state);
        if (state === 'connected' && dhtConnectionRef.current) {
          onConnected(dhtConnectionRef.current);
        }
      },
      onPublicGamesUpdate: (games) => {
        setPublicGames(games);
      },
    });

    // Initialize DHT in background
    dhtConnectionRef.current.initialize().catch(console.error);

    return () => {
      dhtConnectionRef.current?.close();
    };
  }, [onConnected]);

  // Initialize join code connection (for fallback)
  useEffect(() => {
    joinCodeConnectionRef.current = new JoinCodeConnection({
      onStateChange: (state) => {
        setJoinCodeState(state);
        if (state.phase === 'error') {
          setError(state.error);
        }
        if (state.phase === 'waiting-for-answer' && 'offerCode' in state) {
          setOfferCode(state.offerCode);
        }
        if (state.phase === 'waiting-for-host' && 'answerCode' in state) {
          setAnswerCode(state.answerCode);
        }
      },
      onMessage: (data) => {
        console.log('[P2PLobby] JoinCode message:', data);
      },
      onConnectionStateChange: (state) => {
        setConnectionState(state);
        if (state === 'connected' && joinCodeConnectionRef.current) {
          onConnected(joinCodeConnectionRef.current);
        }
      },
    });

    return () => {
      if (joinCodeConnectionRef.current && !joinCodeConnectionRef.current.isConnected()) {
        joinCodeConnectionRef.current.close();
      }
    };
  }, [onConnected]);

  // Initialize mDNS discovery
  useEffect(() => {
    mdnsRef.current = new MDNSDiscovery({
      onGameFound: (game) => {
        setLanGames(prev => {
          // Avoid duplicates
          if (prev.some(g => g.id === game.id)) {
            return prev.map(g => g.id === game.id ? game : g);
          }
          return [...prev, game];
        });
      },
      onGameLost: (gameId) => {
        setLanGames(prev => prev.filter(g => g.id !== gameId));
      },
      onError: (err) => {
        console.error('[P2PLobby] mDNS error:', err);
        setError(err.message);
      },
    });

    return () => {
      mdnsRef.current?.cleanup();
    };
  }, []);

  // Handlers for DHT mode
  const handleCreateRoom = useCallback(async () => {
    if (!dhtConnectionRef.current) return;
    setError(null);
    setCopied(false);

    try {
      await dhtConnectionRef.current.createRoom({
        isPublic: isPublicGame,
        hostName: hostName || 'Anonymous',
        gameType: 'MTG',
      });
      setMode('host');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create room');
    }
  }, [isPublicGame, hostName]);

  const handleJoinRoom = useCallback(async () => {
    if (!dhtConnectionRef.current || !inputCode.trim()) return;
    setError(null);

    try {
      await dhtConnectionRef.current.joinRoom(inputCode.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to join room');
    }
  }, [inputCode]);

  const handleJoinPublicGame = useCallback(async (game: PublicGame) => {
    if (!dhtConnectionRef.current) return;
    setError(null);

    try {
      await dhtConnectionRef.current.joinRoom(game.roomCode);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to join game');
    }
  }, []);

  // Handlers for join-code fallback
  const handleCreateJoinCode = useCallback(async () => {
    if (!joinCodeConnectionRef.current) return;
    setError(null);
    setCopied(false);

    try {
      const code = await joinCodeConnectionRef.current.createGame();
      setOfferCode(code);
      setMode('host');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create game');
    }
  }, []);

  const handleJoinWithCode = useCallback(async () => {
    if (!joinCodeConnectionRef.current || !inputCode.trim()) return;
    setError(null);
    setCopied(false);

    try {
      const code = await joinCodeConnectionRef.current.joinGame(inputCode.trim());
      setAnswerCode(code);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to join game');
    }
  }, [inputCode]);

  const handleAcceptAnswer = useCallback(async () => {
    if (!joinCodeConnectionRef.current || !inputCode.trim()) return;
    setError(null);

    try {
      await joinCodeConnectionRef.current.acceptAnswer(inputCode.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to accept answer');
    }
  }, [inputCode]);

  const copyToClipboard = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }, []);

  const handleStartLanDiscovery = useCallback(() => {
    setMode('lan');
    setError(null);
    mdnsRef.current?.startDiscovery();
  }, []);

  const handleHostLanGame = useCallback(async () => {
    if (!mdnsRef.current) return;
    setError(null);

    try {
      const game = await mdnsRef.current.hostGame(gameName, hostName);
      setHostedLanGame(game);
      setMdnsState({ status: 'hosting', gameId: game.id });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to host LAN game');
    }
  }, [gameName, hostName]);

  const handleStopHosting = useCallback(() => {
    mdnsRef.current?.stopHosting();
    setHostedLanGame(null);
    setMdnsState({ status: 'idle' });
  }, []);

  const handleJoinLanGame = useCallback(async (game: LANGame) => {
    // For now, display connection info - in full implementation
    // this would automatically establish WebRTC connection
    console.log('[P2PLobby] Joining LAN game:', game);
    // TODO: Implement automatic connection via offer exchange
    setError('Direct LAN connection coming soon. Use join codes for now.');
  }, []);

  const handleBack = useCallback(() => {
    dhtConnectionRef.current?.cleanup();
    joinCodeConnectionRef.current?.cleanup();
    if (mode === 'lan') {
      mdnsRef.current?.stopDiscovery();
      mdnsRef.current?.stopHosting();
      setHostedLanGame(null);
      setLanGames([]);
    }
    if (mode === 'select') {
      onBack();
    } else {
      setMode('select');
      setRoomCode('');
      setOfferCode('');
      setAnswerCode('');
      setInputCode('');
      setError(null);
      setDhtState({ phase: 'idle' });
      setJoinCodeState({ phase: 'idle' });
    }
  }, [mode, onBack]);

  const switchToFallback = useCallback(() => {
    setDiscoveryMethod('join-code');
    setError(null);
    setMode('select');
  }, []);

  // Start public games watch when browsing
  useEffect(() => {
    if (mode === 'browse') {
      dhtConnectionRef.current?.startPublicGamesWatch();
    }
    return () => {
      dhtConnectionRef.current?.stopPublicGamesWatch();
    };
  }, [mode]);

  // Styles
  const containerStyle: React.CSSProperties = {
    padding: '40px',
    maxWidth: '600px',
    margin: '0 auto',
    fontFamily: 'system-ui, sans-serif',
  };

  const cardStyle: React.CSSProperties = {
    backgroundColor: '#16213e',
    padding: '24px',
    borderRadius: '12px',
    marginBottom: '20px',
    border: '1px solid #3a3a5c',
  };

  const buttonStyle: React.CSSProperties = {
    padding: '12px 24px',
    fontSize: '16px',
    cursor: 'pointer',
    backgroundColor: '#4CAF50',
    color: 'white',
    border: 'none',
    borderRadius: '8px',
    width: '100%',
    marginBottom: '12px',
  };

  const secondaryButtonStyle: React.CSSProperties = {
    ...buttonStyle,
    backgroundColor: '#3a3a5c',
  };

  const tabStyle = (active: boolean): React.CSSProperties => ({
    padding: '12px 20px',
    cursor: 'pointer',
    backgroundColor: active ? '#4CAF50' : '#3a3a5c',
    color: 'white',
    border: 'none',
    borderRadius: '8px 8px 0 0',
    flex: 1,
    fontSize: '14px',
    fontWeight: active ? 'bold' : 'normal',
  });

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '12px',
    fontSize: '14px',
    backgroundColor: '#1a1a2e',
    color: '#e4e4e4',
    border: '1px solid #3a3a5c',
    borderRadius: '8px',
    marginBottom: '12px',
    fontFamily: 'monospace',
    boxSizing: 'border-box',
  };

  const roomCodeInputStyle: React.CSSProperties = {
    ...inputStyle,
    fontSize: '24px',
    textAlign: 'center',
    letterSpacing: '4px',
    textTransform: 'uppercase',
  };

  const roomCodeDisplayStyle: React.CSSProperties = {
    backgroundColor: '#1a1a2e',
    padding: '20px',
    borderRadius: '8px',
    fontSize: '32px',
    fontFamily: 'monospace',
    color: '#4CAF50',
    textAlign: 'center',
    letterSpacing: '8px',
    marginBottom: '12px',
  };

  const codeDisplayStyle: React.CSSProperties = {
    backgroundColor: '#1a1a2e',
    padding: '12px',
    borderRadius: '8px',
    wordBreak: 'break-all',
    fontSize: '12px',
    fontFamily: 'monospace',
    color: '#a0a0a0',
    marginBottom: '12px',
    maxHeight: '120px',
    overflow: 'auto',
  };

  const statusStyle: React.CSSProperties = {
    padding: '12px',
    borderRadius: '8px',
    marginBottom: '12px',
    textAlign: 'center',
  };

  const gameListItemStyle: React.CSSProperties = {
    backgroundColor: '#1a1a2e',
    padding: '16px',
    borderRadius: '8px',
    marginBottom: '12px',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  };

  // Render DHT status indicator
  const renderDHTStatus = () => {
    const isDHTAvailable = dhtConnectionRef.current?.isDHTAvailable();
    const statusColor = isDHTAvailable ? '#4CAF50' : '#ff9800';
    const statusText = isDHTAvailable ? 'DHT Connected' : 'Connecting...';

    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
        <div style={{
          width: '10px',
          height: '10px',
          borderRadius: '50%',
          backgroundColor: statusColor,
        }} />
        <span style={{ color: '#a0a0a0', fontSize: '12px' }}>{statusText}</span>
      </div>
    );
  };

  // Mode: Select (Choose how to connect)
  if (mode === 'select') {
    return (
      <div style={containerStyle}>
        <h1 style={{ color: '#e4e4e4', marginBottom: '8px' }}>P2P Online Game</h1>
        <p style={{ color: '#a0a0a0', marginBottom: '24px' }}>
          Connect directly with another player - no server required!
        </p>

        {/* Discovery method tabs */}
        <div style={{ display: 'flex', gap: '4px', marginBottom: '0' }}>
          <button
            style={tabStyle(discoveryMethod === 'dht')}
            onClick={() => setDiscoveryMethod('dht')}
          >
            Room Code (Recommended)
          </button>
          <button
            style={tabStyle(discoveryMethod === 'join-code')}
            onClick={() => setDiscoveryMethod('join-code')}
          >
            Manual Join Codes
          </button>

          <button
            style={{ ...secondaryButtonStyle, backgroundColor: '#1a4a3a' }}
            onClick={handleStartLanDiscovery}
          >
            LAN Discovery
          </button>
        </div>

        {/* DHT mode */}
        {discoveryMethod === 'dht' && (
          <div style={{ ...cardStyle, borderTopLeftRadius: 0, borderTopRightRadius: 0 }}>
            {renderDHTStatus()}

            <div style={{ marginBottom: '16px' }}>
              <label style={{ color: '#e4e4e4', display: 'block', marginBottom: '8px' }}>
                Your Name (optional)
              </label>
              <input
                style={inputStyle}
                placeholder="Anonymous"
                value={hostName}
                onChange={(e) => setHostName(e.target.value)}
              />
            </div>

            <button style={buttonStyle} onClick={handleCreateRoom}>
              Create Room
            </button>

            <div style={{ display: 'flex', gap: '12px', marginBottom: '12px' }}>
              <input
                style={{ ...roomCodeInputStyle, marginBottom: 0 }}
                placeholder="ROOM CODE"
                value={inputCode}
                onChange={(e) => setInputCode(e.target.value.toUpperCase())}
                maxLength={6}
              />
              <button
                style={{ ...buttonStyle, width: 'auto', marginBottom: 0 }}
                onClick={handleJoinRoom}
                disabled={inputCode.length !== 6}
              >
                Join
              </button>
            </div>

            <button
              style={secondaryButtonStyle}
              onClick={() => setMode('browse')}
            >
              Browse Public Games
            </button>
          </div>
        )}

        {/* Join-code fallback mode */}
        {discoveryMethod === 'join-code' && (
          <div style={{ ...cardStyle, borderTopLeftRadius: 0, borderTopRightRadius: 0 }}>
            <p style={{ color: '#a0a0a0', fontSize: '14px', marginBottom: '16px' }}>
              Manual mode: Share codes via Discord, text, etc.
            </p>

            <button style={buttonStyle} onClick={handleCreateJoinCode}>
              Create Game (Host)
            </button>

            <button
              style={secondaryButtonStyle}
              onClick={() => setMode('join')}
            >
              Join Game (Guest)
            </button>
          </div>
        )}

        {/* How it works */}
        <div style={{
          ...cardStyle,
          backgroundColor: '#0f3460',
          color: '#c0d0e0',
          fontSize: '14px',
        }}>
          <strong>How it works:</strong>
          {discoveryMethod === 'dht' ? (
            <ol style={{ margin: '8px 0 0 0', paddingLeft: '20px' }}>
              <li>Host creates a room and gets a 6-character code</li>
              <li>Guest enters the code to join</li>
              <li>Play!</li>
            </ol>
          ) : (
            <ol style={{ margin: '8px 0 0 0', paddingLeft: '20px' }}>
              <li>Host creates a game and shares their code</li>
              <li>Guest enters the code and shares their response code</li>
              <li>Host enters the response code to connect</li>
              <li>Play!</li>
            </ol>
          )}
        </div>

        {error && (
          <div style={{ ...statusStyle, backgroundColor: '#4a1a1a', color: '#ff6b6b' }}>
            {error}
            {dhtState.phase === 'error' && dhtState.fallbackAvailable && (
              <button
                style={{ ...secondaryButtonStyle, marginTop: '12px', marginBottom: 0 }}
                onClick={switchToFallback}
              >
                Switch to Manual Mode
              </button>
            )}
          </div>
        )}

        <button
          style={{ ...secondaryButtonStyle, marginTop: '12px' }}
          onClick={onBack}
        >
          Back to Lobby
        </button>
      </div>
    );
  }

  // Mode: Browse public games
  if (mode === 'browse') {
    return (
      <div style={containerStyle}>
        <h1 style={{ color: '#e4e4e4', marginBottom: '8px' }}>Public Games</h1>
        {renderDHTStatus()}

        <div style={cardStyle}>
          {publicGames.length === 0 ? (
            <div style={{ color: '#a0a0a0', textAlign: 'center', padding: '20px' }}>
              No public games found. Create one to be the first!
            </div>
          ) : (
            publicGames.map((game) => (
              <div key={game.roomCode} style={gameListItemStyle}>
                <div>
                  <div style={{ color: '#e4e4e4', fontWeight: 'bold' }}>
                    {game.hostName}
                  </div>
                  <div style={{ color: '#a0a0a0', fontSize: '12px' }}>
                    {game.gameType} • Code: {game.roomCode}
                  </div>
                </div>
                <button
                  style={{ ...buttonStyle, width: 'auto', marginBottom: 0 }}
                  onClick={() => handleJoinPublicGame(game)}
                >
                  Join
                </button>
              </div>
            ))
          )}
        </div>

        {error && (
          <div style={{ ...statusStyle, backgroundColor: '#4a1a1a', color: '#ff6b6b' }}>
            {error}
          </div>
        )}

        <button style={secondaryButtonStyle} onClick={handleBack}>
          Back
        </button>
      </div>
    );
  }

  // Mode: Host (DHT or join-code)
  if (mode === 'host') {
    const isDHTMode = discoveryMethod === 'dht';
    const isWaitingForGuest = isDHTMode
      ? dhtState.phase === 'waiting-for-guest'
      : joinCodeState.phase === 'waiting-for-answer';
    const isConnecting = isDHTMode
      ? dhtState.phase === 'connecting'
      : joinCodeState.phase === 'connecting';
    const isConnected = isDHTMode
      ? dhtState.phase === 'connected'
      : joinCodeState.phase === 'connected';

    return (
      <div style={containerStyle}>
        <h1 style={{ color: '#e4e4e4', marginBottom: '8px' }}>Host Game</h1>
        {isDHTMode && renderDHTStatus()}

        {/* DHT mode: Show room code */}
        {isDHTMode && isWaitingForGuest && (
          <div style={cardStyle}>
            <h3 style={{ color: '#e4e4e4', marginBottom: '12px' }}>
              Share this room code
            </h3>
            <div style={roomCodeDisplayStyle}>{roomCode}</div>
            <button
              style={buttonStyle}
              onClick={() => copyToClipboard(roomCode)}
            >
              {copied ? 'Copied!' : 'Copy Code'}
            </button>
            <div style={{ ...statusStyle, backgroundColor: '#0f3460', color: '#c0d0e0' }}>
              Waiting for guest to join...
            </div>
          </div>
        )}

        {/* Join-code mode: Show offer code */}
        {!isDHTMode && (
          <>
            <div style={cardStyle}>
              <h3 style={{ color: '#e4e4e4', marginBottom: '12px' }}>
                Step 1: Share this code with your opponent
              </h3>
              {offerCode ? (
                <>
                  <div style={codeDisplayStyle}>{offerCode}</div>
                  <button
                    style={buttonStyle}
                    onClick={() => copyToClipboard(offerCode)}
                  >
                    {copied ? 'Copied!' : 'Copy Code'}
                  </button>
                </>
              ) : (
                <div style={{ ...statusStyle, backgroundColor: '#3d2a1a', color: '#ff9800' }}>
                  Generating code...
                </div>
              )}
            </div>

            {joinCodeState.phase === 'waiting-for-answer' && (
              <div style={cardStyle}>
                <h3 style={{ color: '#e4e4e4', marginBottom: '12px' }}>
                  Step 2: Enter your opponent's response code
                </h3>
                <textarea
                  style={{ ...inputStyle, minHeight: '80px', resize: 'vertical' }}
                  placeholder="Paste the response code here..."
                  value={inputCode}
                  onChange={(e) => setInputCode(e.target.value)}
                />
                <button
                  style={buttonStyle}
                  onClick={handleAcceptAnswer}
                  disabled={!inputCode.trim()}
                >
                  Connect
                </button>
              </div>
            )}
          </>
        )}

        {/* Status indicators */}
        {(dhtState.phase === 'creating-room' || dhtState.phase === 'publishing-offer') && (
          <div style={{ ...statusStyle, backgroundColor: '#3d2a1a', color: '#ff9800' }}>
            Creating room...
          </div>
        )}

        {isConnecting && (
          <div style={{ ...statusStyle, backgroundColor: '#3d2a1a', color: '#ff9800' }}>
            Connecting...
          </div>
        )}

        {isConnected && (
          <div style={{ ...statusStyle, backgroundColor: '#1a4a3a', color: '#6fcf6f' }}>
            Connected! Starting game...
          </div>
        )}

        {error && (
          <div style={{ ...statusStyle, backgroundColor: '#4a1a1a', color: '#ff6b6b' }}>
            Error: {error}
          </div>
        )}

        <button style={secondaryButtonStyle} onClick={handleBack}>
          Cancel
        </button>
      </div>
    );
  }

  // Mode: Join (join-code fallback only, DHT join is inline on select screen)
  if (mode === 'join') {
    const hasAnswerCode = joinCodeState.phase === 'waiting-for-host';
    const isConnecting = joinCodeState.phase === 'connecting';
    const isConnected = joinCodeState.phase === 'connected';

    return (
      <div style={containerStyle}>
        <h1 style={{ color: '#e4e4e4', marginBottom: '8px' }}>Join Game</h1>

        <div style={cardStyle}>
          <h3 style={{ color: '#e4e4e4', marginBottom: '12px' }}>
            Step 1: Enter the host's code
          </h3>
          <textarea
            style={{ ...inputStyle, minHeight: '80px', resize: 'vertical' }}
            placeholder="Paste the host's code here..."
            value={inputCode}
            onChange={(e) => setInputCode(e.target.value)}
            disabled={hasAnswerCode}
          />
          {!hasAnswerCode && (
            <button
              style={buttonStyle}
              onClick={handleJoinWithCode}
              disabled={!inputCode.trim()}
            >
              Generate Response
            </button>
          )}
        </div>

        {hasAnswerCode && (
          <div style={cardStyle}>
            <h3 style={{ color: '#e4e4e4', marginBottom: '12px' }}>
              Step 2: Share this response code with the host
            </h3>
            <div style={codeDisplayStyle}>{answerCode}</div>
            <button
              style={buttonStyle}
              onClick={() => copyToClipboard(answerCode)}
            >
              {copied ? 'Copied!' : 'Copy Response Code'}
            </button>
            <div style={{ ...statusStyle, backgroundColor: '#0f3460', color: '#c0d0e0' }}>
              Waiting for host to enter your code...
            </div>
          </div>
        )}

        {isConnecting && (
          <div style={{ ...statusStyle, backgroundColor: '#3d2a1a', color: '#ff9800' }}>
            Connecting...
          </div>
        )}

        {isConnected && (
          <div style={{ ...statusStyle, backgroundColor: '#1a4a3a', color: '#6fcf6f' }}>
            Connected! Starting game...
          </div>
        )}

        {error && (
          <div style={{ ...statusStyle, backgroundColor: '#4a1a1a', color: '#ff6b6b' }}>
            Error: {error}
          </div>
        )}

        <button style={secondaryButtonStyle} onClick={handleBack}>
          Cancel
        </button>
      </div>
    );
  }

  // Mode: LAN Discovery
  if (mode === 'lan') {
    const isHosting = mdnsState.status === 'hosting';

    return (
      <div style={containerStyle}>
        <h1 style={{ color: '#e4e4e4', marginBottom: '8px' }}>LAN Games</h1>
        <p style={{ color: '#a0a0a0', marginBottom: '24px' }}>
          Find games on your local network
        </p>

        {/* Host a LAN Game */}
        <div style={cardStyle}>
          <h3 style={{ color: '#e4e4e4', marginBottom: '12px' }}>
            {isHosting ? 'Hosting LAN Game' : 'Host a LAN Game'}
          </h3>

          {!isHosting ? (
            <>
              <input
                style={inputStyle}
                type="text"
                placeholder="Your name"
                value={hostName}
                onChange={(e) => setHostName(e.target.value)}
              />
              <input
                style={inputStyle}
                type="text"
                placeholder="Game name"
                value={gameName}
                onChange={(e) => setGameName(e.target.value)}
              />
              <button style={buttonStyle} onClick={handleHostLanGame}>
                Host LAN Game
              </button>
            </>
          ) : (
            <>
              <div style={{ ...statusStyle, backgroundColor: '#1a4a3a', color: '#6fcf6f' }}>
                Hosting: {hostedLanGame?.gameName}
                <br />
                <small>Waiting for players...</small>
              </div>
              <button style={secondaryButtonStyle} onClick={handleStopHosting}>
                Stop Hosting
              </button>
            </>
          )}
        </div>

        {/* Discovered Games */}
        <div style={cardStyle}>
          <h3 style={{ color: '#e4e4e4', marginBottom: '12px' }}>
            Available Games ({lanGames.length})
          </h3>

          {lanGames.length === 0 ? (
            <div style={{ color: '#a0a0a0', textAlign: 'center', padding: '20px' }}>
              Searching for games on your network...
              <br />
              <small style={{ color: '#666' }}>
                (Using localStorage simulation in browser)
              </small>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {lanGames.map(game => (
                <div
                  key={game.id}
                  style={{
                    backgroundColor: '#1a1a2e',
                    padding: '12px',
                    borderRadius: '8px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <div>
                    <div style={{ color: '#e4e4e4', fontWeight: 'bold' }}>
                      {game.gameName}
                    </div>
                    <div style={{ color: '#a0a0a0', fontSize: '12px' }}>
                      Host: {game.hostName} | Players: {game.playerCount}/{game.maxPlayers}
                    </div>
                  </div>
                  <button
                    style={{
                      ...buttonStyle,
                      width: 'auto',
                      marginBottom: 0,
                      padding: '8px 16px',
                    }}
                    onClick={() => handleJoinLanGame(game)}
                  >
                    Join
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Info box */}
        <div style={{
          ...cardStyle,
          backgroundColor: '#0f3460',
          color: '#c0d0e0',
          fontSize: '14px',
        }}>
          <strong>Note:</strong> LAN discovery works best in Electron or native apps.
          In browsers, this uses localStorage for same-device testing.
          For cross-device play, use the Join Code method.
        </div>

        {error && (
          <div style={{ ...statusStyle, backgroundColor: '#4a1a1a', color: '#ff6b6b' }}>
            {error}
          </div>
        )}

        <button style={secondaryButtonStyle} onClick={handleBack}>
          Back
        </button>
      </div>
    );
  }

  return null;
};
