import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Client } from 'boardgame.io/react';
import { Local } from 'boardgame.io/multiplayer';
import { SimpleCardGame } from './game/game';
import { GameBoard } from './components/GameBoard';
import { P2PLobby, type P2PRole } from './components/P2PLobby';
import { startP2P, P2PMultiplayer, type JoinCodeConnection } from './p2p';

// Create multiplayer clients for local play (two players on same browser)
const GameClient = Client({
  game: SimpleCardGame,
  board: GameBoard,
  multiplayer: Local(),
});

interface LobbyProps {
  onStartGame: (mode: 'local' | 'online') => void;
}

const Lobby: React.FC<LobbyProps> = ({ onStartGame }) => {
  return (
    <div style={{
      padding: '40px',
      maxWidth: '600px',
      margin: '0 auto',
      fontFamily: 'system-ui, sans-serif',
      textAlign: 'center',
    }}>
      <h1 style={{ marginBottom: '8px', color: '#e4e4e4' }}>ManaMesh</h1>
      <p style={{ color: '#a0a0a0', marginBottom: '40px' }}>
        Decentralized Card Game Platform
      </p>

      <div style={{
        backgroundColor: '#16213e',
        padding: '32px',
        borderRadius: '12px',
        marginBottom: '20px',
        border: '1px solid #3a3a5c',
      }}>
        <h2 style={{ marginBottom: '24px', color: '#e4e4e4' }}>Start a Game</h2>

        <button
          onClick={() => onStartGame('local')}
          style={{
            padding: '16px 32px',
            fontSize: '18px',
            cursor: 'pointer',
            backgroundColor: '#4CAF50',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            width: '100%',
            marginBottom: '16px',
          }}
        >
          Local Hotseat (2 Players)
        </button>

        <button
          onClick={() => onStartGame('online')}
          style={{
            padding: '16px 32px',
            fontSize: '18px',
            cursor: 'pointer',
            backgroundColor: '#2196F3',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            width: '100%',
          }}
        >
          P2P Online (No Server!)
        </button>
      </div>

      <div style={{
        backgroundColor: '#0f3460',
        padding: '16px',
        borderRadius: '8px',
        fontSize: '14px',
        textAlign: 'left',
        color: '#c0d0e0',
        border: '1px solid #3a3a5c',
      }}>
        <strong>How to play:</strong>
        <ul style={{ margin: '8px 0 0 0', paddingLeft: '20px' }}>
          <li>Draw cards from the deck</li>
          <li>Click a card to select it, then play or discard</li>
          <li>First player to play 5 cards wins!</li>
        </ul>
      </div>
    </div>
  );
};

const LocalGame: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const [activePlayer, setActivePlayer] = useState<'0' | '1'>('0');

  return (
    <div>
      <div style={{
        padding: '12px 20px',
        backgroundColor: '#16213e',
        color: '#e4e4e4',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderBottom: '1px solid #3a3a5c',
      }}>
        <button
          onClick={onBack}
          style={{
            padding: '8px 16px',
            cursor: 'pointer',
            backgroundColor: '#3a3a5c',
            color: '#e4e4e4',
            border: 'none',
            borderRadius: '4px',
          }}
        >
          ← Back to Lobby
        </button>
        <div>
          <span style={{ marginRight: '12px' }}>Viewing as:</span>
          <button
            onClick={() => setActivePlayer('0')}
            style={{
              padding: '8px 16px',
              cursor: 'pointer',
              backgroundColor: activePlayer === '0' ? '#4CAF50' : '#3a3a5c',
              color: '#e4e4e4',
              border: 'none',
              borderRadius: '4px',
              marginRight: '8px',
            }}
          >
            Player 0
          </button>
          <button
            onClick={() => setActivePlayer('1')}
            style={{
              padding: '8px 16px',
              cursor: 'pointer',
              backgroundColor: activePlayer === '1' ? '#4CAF50' : '#3a3a5c',
              color: '#e4e4e4',
              border: 'none',
              borderRadius: '4px',
            }}
          >
            Player 1
          </button>
        </div>
      </div>
      <GameClient playerID={activePlayer} matchID="local-match" />
    </div>
  );
};

// P2P Game component - uses boardgame.io with P2P transport
const P2PGame: React.FC<{
  connection: JoinCodeConnection;
  role: P2PRole;
  onBack: () => void;
}> = ({ connection, role, onBack }) => {
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'disconnected' | 'reconnecting'>('connected');

  // Create the P2P client dynamically based on role
  const P2PClient = useMemo(() => {
    const playerID = role === 'host' ? '0' : '1';

    return Client({
      game: SimpleCardGame,
      board: GameBoard,
      multiplayer: P2PMultiplayer({
        connection,
        role,
        playerID,
        matchID: 'p2p-match',
        numPlayers: 2,
      }),
      debug: false,
    });
  }, [connection, role]);

  // Monitor connection state
  useEffect(() => {
    const events = (connection as any).events;
    if (!events) return;

    const originalOnConnectionStateChange = events.onConnectionStateChange;

    events.onConnectionStateChange = (state: string) => {
      if (state === 'connected') {
        setConnectionStatus('connected');
      } else if (state === 'disconnected') {
        setConnectionStatus('reconnecting');
      } else if (state === 'failed') {
        setConnectionStatus('disconnected');
      }
      originalOnConnectionStateChange?.(state);
    };

    return () => {
      events.onConnectionStateChange = originalOnConnectionStateChange;
    };
  }, [connection]);

  const playerID = role === 'host' ? '0' : '1';

  return (
    <div>
      <div style={{
        padding: '12px 20px',
        backgroundColor: '#16213e',
        color: '#e4e4e4',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderBottom: '1px solid #3a3a5c',
      }}>
        <button
          onClick={onBack}
          style={{
            padding: '8px 16px',
            cursor: 'pointer',
            backgroundColor: '#3a3a5c',
            color: '#e4e4e4',
            border: 'none',
            borderRadius: '4px',
          }}
        >
          ← Disconnect
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <span style={{
            padding: '4px 12px',
            backgroundColor: role === 'host' ? '#4CAF50' : '#2196F3',
            borderRadius: '4px',
            fontSize: '12px',
            textTransform: 'uppercase',
          }}>
            {role}
          </span>
          <span style={{
            color: connectionStatus === 'connected' ? '#6fcf6f' :
                   connectionStatus === 'reconnecting' ? '#ff9800' : '#ff6b6b',
          }}>
            {connectionStatus === 'connected' ? '● Connected via P2P' :
             connectionStatus === 'reconnecting' ? '○ Reconnecting...' : '○ Disconnected'}
          </span>
        </div>
      </div>
      <P2PClient playerID={playerID} matchID="p2p-match" />
    </div>
  );
};

const App: React.FC = () => {
  const [gameMode, setGameMode] = useState<'lobby' | 'local' | 'online' | 'p2p-game'>('lobby');
  const [p2pConnection, setP2pConnection] = useState<JoinCodeConnection | null>(null);
  const [p2pRole, setP2pRole] = useState<P2PRole>('host');

  useEffect(() => {
    // Initialize P2P in background
    startP2P();
  }, []);

  const handleP2PConnected = useCallback((connection: JoinCodeConnection, role: P2PRole) => {
    setP2pConnection(connection);
    setP2pRole(role);
    setGameMode('p2p-game');
  }, []);

  const handleBackFromP2P = useCallback(() => {
    p2pConnection?.close();
    setP2pConnection(null);
    setGameMode('lobby');
  }, [p2pConnection]);

  if (gameMode === 'local') {
    return <LocalGame onBack={() => setGameMode('lobby')} />;
  }

  if (gameMode === 'online') {
    return (
      <P2PLobby
        onConnected={handleP2PConnected}
        onBack={() => setGameMode('lobby')}
      />
    );
  }

  if (gameMode === 'p2p-game' && p2pConnection) {
    return <P2PGame connection={p2pConnection} role={p2pRole} onBack={handleBackFromP2P} />;
  }

  return <Lobby onStartGame={setGameMode} />;
};

export default App;
