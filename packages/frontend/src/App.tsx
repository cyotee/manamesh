import React, { useState, useEffect, useCallback } from 'react';
import { Client } from 'boardgame.io/react';
import { Local } from 'boardgame.io/multiplayer';
import { SimpleCardGame } from './game/game';
import { GameBoard } from './components/GameBoard';
import { P2PLobby } from './components/P2PLobby';
import { startP2P, type JoinCodeConnection } from './p2p';

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

// Simple P2P Game component - shows connection test before full boardgame.io integration
const P2PGame: React.FC<{
  connection: JoinCodeConnection;
  onBack: () => void;
}> = ({ connection, onBack }) => {
  const [messages, setMessages] = useState<string[]>([]);
  const [inputMessage, setInputMessage] = useState('');

  // Listen for messages
  useEffect(() => {
    const originalOnMessage = (connection as any).events?.onMessage;
    if (originalOnMessage) {
      (connection as any).events.onMessage = (data: string) => {
        setMessages((prev) => [...prev, `Peer: ${data}`]);
        originalOnMessage(data);
      };
    }
  }, [connection]);

  const sendMessage = () => {
    if (inputMessage.trim()) {
      connection.send(inputMessage);
      setMessages((prev) => [...prev, `You: ${inputMessage}`]);
      setInputMessage('');
    }
  };

  return (
    <div style={{
      padding: '40px',
      maxWidth: '600px',
      margin: '0 auto',
      fontFamily: 'system-ui, sans-serif',
    }}>
      <div style={{
        padding: '12px 20px',
        backgroundColor: '#16213e',
        color: '#e4e4e4',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderRadius: '8px',
        marginBottom: '20px',
        border: '1px solid #3a3a5c',
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
        <span style={{ color: '#6fcf6f' }}>Connected via P2P!</span>
      </div>

      <div style={{
        backgroundColor: '#16213e',
        padding: '24px',
        borderRadius: '12px',
        border: '1px solid #3a3a5c',
        marginBottom: '20px',
      }}>
        <h2 style={{ color: '#e4e4e4', marginBottom: '16px' }}>P2P Connection Test</h2>
        <p style={{ color: '#a0a0a0', marginBottom: '16px' }}>
          Send messages to test the connection. Game integration coming next!
        </p>

        <div style={{
          backgroundColor: '#1a1a2e',
          padding: '12px',
          borderRadius: '8px',
          minHeight: '150px',
          maxHeight: '200px',
          overflow: 'auto',
          marginBottom: '12px',
        }}>
          {messages.length === 0 ? (
            <span style={{ color: '#6a6a8a' }}>No messages yet...</span>
          ) : (
            messages.map((msg, i) => (
              <div key={i} style={{
                color: msg.startsWith('You:') ? '#6fcf6f' : '#e4e4e4',
                marginBottom: '4px',
              }}>
                {msg}
              </div>
            ))
          )}
        </div>

        <div style={{ display: 'flex', gap: '8px' }}>
          <input
            type="text"
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
            placeholder="Type a message..."
            style={{
              flex: 1,
              padding: '12px',
              backgroundColor: '#1a1a2e',
              color: '#e4e4e4',
              border: '1px solid #3a3a5c',
              borderRadius: '8px',
            }}
          />
          <button
            onClick={sendMessage}
            style={{
              padding: '12px 24px',
              backgroundColor: '#4CAF50',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
            }}
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
};

const App: React.FC = () => {
  const [gameMode, setGameMode] = useState<'lobby' | 'local' | 'online' | 'p2p-game'>('lobby');
  const [p2pConnection, setP2pConnection] = useState<JoinCodeConnection | null>(null);

  useEffect(() => {
    // Initialize P2P in background
    startP2P();
  }, []);

  const handleP2PConnected = useCallback((connection: JoinCodeConnection) => {
    setP2pConnection(connection);
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
    return <P2PGame connection={p2pConnection} onBack={handleBackFromP2P} />;
  }

  return <Lobby onStartGame={setGameMode} />;
};

export default App;
