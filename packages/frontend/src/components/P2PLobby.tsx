/**
 * P2P Lobby Component
 * Handles the two-way join code exchange for establishing P2P connections
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  JoinCodeConnection,
  type JoinCodeState,
  type ConnectionState,
  MDNSDiscovery,
  type LANGame,
  type MDNSState,
} from '../p2p';

interface P2PLobbyProps {
  onConnected: (connection: JoinCodeConnection) => void;
  onBack: () => void;
}

export const P2PLobby: React.FC<P2PLobbyProps> = ({ onConnected, onBack }) => {
  const [mode, setMode] = useState<'select' | 'host' | 'join' | 'lan'>('select');
  const [joinCodeState, setJoinCodeState] = useState<JoinCodeState>({ phase: 'idle' });
  const [connectionState, setConnectionState] = useState<ConnectionState>('new');
  const [offerCode, setOfferCode] = useState('');
  const [answerCode, setAnswerCode] = useState('');
  const [inputCode, setInputCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // LAN discovery state
  const [lanGames, setLanGames] = useState<LANGame[]>([]);
  const [mdnsState, setMdnsState] = useState<MDNSState>({ status: 'idle' });
  const [hostedLanGame, setHostedLanGame] = useState<LANGame | null>(null);
  const [hostName, setHostName] = useState('Player');
  const [gameName, setGameName] = useState('ManaMesh Game');

  const connectionRef = useRef<JoinCodeConnection | null>(null);
  const mdnsRef = useRef<MDNSDiscovery | null>(null);

  // Initialize connection on mount
  useEffect(() => {
    connectionRef.current = new JoinCodeConnection({
      onStateChange: (state) => {
        setJoinCodeState(state);
        if (state.phase === 'error') {
          setError(state.error);
        }
      },
      onMessage: (data) => {
        console.log('[P2PLobby] Received message:', data);
      },
      onConnectionStateChange: (state) => {
        setConnectionState(state);
        if (state === 'connected' && connectionRef.current) {
          onConnected(connectionRef.current);
        }
      },
    });

    return () => {
      // Only close if we're NOT connected - if connected, the connection
      // has been handed off to the parent component and should not be closed
      if (connectionRef.current && !connectionRef.current.isConnected()) {
        connectionRef.current.close();
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

  const handleCreateGame = useCallback(async () => {
    if (!connectionRef.current) return;
    setError(null);
    setCopied(false);

    try {
      const code = await connectionRef.current.createGame();
      setOfferCode(code);
      setMode('host');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create game');
    }
  }, []);

  const handleJoinGame = useCallback(async () => {
    if (!connectionRef.current || !inputCode.trim()) return;
    setError(null);
    setCopied(false);

    try {
      const code = await connectionRef.current.joinGame(inputCode.trim());
      setAnswerCode(code);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to join game');
    }
  }, [inputCode]);

  const handleAcceptAnswer = useCallback(async () => {
    if (!connectionRef.current || !inputCode.trim()) return;
    setError(null);

    try {
      await connectionRef.current.acceptAnswer(inputCode.trim());
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
    connectionRef.current?.cleanup();
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
      setOfferCode('');
      setAnswerCode('');
      setInputCode('');
      setError(null);
      setJoinCodeState({ phase: 'idle' });
    }
  }, [mode, onBack]);

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

  // Mode: Select (Create or Join)
  if (mode === 'select') {
    return (
      <div style={containerStyle}>
        <h1 style={{ color: '#e4e4e4', marginBottom: '8px' }}>P2P Online Game</h1>
        <p style={{ color: '#a0a0a0', marginBottom: '24px' }}>
          Connect directly with another player - no server required!
        </p>

        <div style={cardStyle}>
          <h2 style={{ color: '#e4e4e4', marginBottom: '16px' }}>Start a Game</h2>

          <button style={buttonStyle} onClick={handleCreateGame}>
            Create Game (Host)
          </button>

          <button
            style={secondaryButtonStyle}
            onClick={() => setMode('join')}
          >
            Join Game (Guest)
          </button>

          <button
            style={{ ...secondaryButtonStyle, backgroundColor: '#1a4a3a' }}
            onClick={handleStartLanDiscovery}
          >
            LAN Discovery
          </button>
        </div>

        <div style={{
          ...cardStyle,
          backgroundColor: '#0f3460',
          color: '#c0d0e0',
          fontSize: '14px',
        }}>
          <strong>How it works:</strong>
          <ol style={{ margin: '8px 0 0 0', paddingLeft: '20px' }}>
            <li>Host creates a game and shares their code</li>
            <li>Guest enters the code and shares their response code</li>
            <li>Host enters the response code to connect</li>
            <li>Play!</li>
          </ol>
        </div>

        <button
          style={{ ...secondaryButtonStyle, marginTop: '12px' }}
          onClick={onBack}
        >
          Back to Lobby
        </button>
      </div>
    );
  }

  // Mode: Host (Creating game, waiting for answer)
  if (mode === 'host') {
    const isWaitingForAnswer = joinCodeState.phase === 'waiting-for-answer';
    const isConnecting = joinCodeState.phase === 'connecting';
    const isConnected = joinCodeState.phase === 'connected';

    return (
      <div style={containerStyle}>
        <h1 style={{ color: '#e4e4e4', marginBottom: '8px' }}>Host Game</h1>

        {/* Step 1: Share your offer code */}
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

        {/* Step 2: Enter their answer code */}
        {isWaitingForAnswer && (
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

        {/* Status */}
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

  // Mode: Join (Entering offer code, showing answer code)
  if (mode === 'join') {
    const hasAnswerCode = joinCodeState.phase === 'waiting-for-host';
    const isConnecting = joinCodeState.phase === 'connecting';
    const isConnected = joinCodeState.phase === 'connected';

    return (
      <div style={containerStyle}>
        <h1 style={{ color: '#e4e4e4', marginBottom: '8px' }}>Join Game</h1>

        {/* Step 1: Enter their offer code */}
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
              onClick={handleJoinGame}
              disabled={!inputCode.trim()}
            >
              Generate Response
            </button>
          )}
        </div>

        {/* Step 2: Share your answer code */}
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

        {/* Status */}
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
