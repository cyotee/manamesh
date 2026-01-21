/**
 * P2P Lobby Component
 * Handles the two-way join code exchange for establishing P2P connections
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { JoinCodeConnection, type JoinCodeState, type ConnectionState } from '../p2p';

interface P2PLobbyProps {
  onConnected: (connection: JoinCodeConnection) => void;
  onBack: () => void;
}

export const P2PLobby: React.FC<P2PLobbyProps> = ({ onConnected, onBack }) => {
  const [mode, setMode] = useState<'select' | 'host' | 'join'>('select');
  const [joinCodeState, setJoinCodeState] = useState<JoinCodeState>({ phase: 'idle' });
  const [connectionState, setConnectionState] = useState<ConnectionState>('new');
  const [offerCode, setOfferCode] = useState('');
  const [answerCode, setAnswerCode] = useState('');
  const [inputCode, setInputCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const connectionRef = useRef<JoinCodeConnection | null>(null);

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

  const handleBack = useCallback(() => {
    connectionRef.current?.cleanup();
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

  return null;
};
