import React, { useState, useEffect, useCallback, useRef } from 'react';
import { MatchmakingService } from '../../p2p/discovery/matchmaking';
import { createPokerMatchmakingConfig, type PokerLobbyEvents } from '../../p2p/discovery/matchmaking/poker/poker-lobby';
import { JoinCodeTransport } from '../../p2p/transports/joincode-transport';
import { P2PMultiplayer, type JoinCodeConnection } from '../../p2p/transport';
import type { PlayerInfo } from '../../p2p/discovery/matchmaking/types';
import type { Game } from 'boardgame.io';

export interface PokerLobbyProps {
  displayName: string;
  isHost: boolean;
  roomCode?: string;
  maxPlayers?: number;
  minBuyIn?: number;
  smallBlind?: number;
  bigBlind?: number;
  game: Game;
  onGameStart: (params: {
    connection: JoinCodeConnection;
    role: 'host' | 'guest';
    playerID: string;
    matchID: string;
    numPlayers: number;
  }) => void;
  onError: (error: Error) => void;
}

type LobbyPhase = 'connecting' | 'lobby' | 'starting' | 'error';

export const PokerLobby: React.FC<PokerLobbyProps> = ({
  displayName,
  isHost,
  roomCode,
  maxPlayers = 6,
  minBuyIn = 1000,
  smallBlind = 5,
  bigBlind = 10,
  game,
  onGameStart,
  onError,
}) => {
  const [phase, setPhase] = useState<LobbyPhase>('connecting');
  const [players, setPlayers] = useState<PlayerInfo[]>([]);
  const [myPeerId, setMyPeerId] = useState<string>('');
  const [currentRoomCode, setCurrentRoomCode] = useState<string>(roomCode || '');
  const [error, setError] = useState<string>('');
  const [isReady, setIsReady] = useState(false);
  const [joinCode, setJoinCode] = useState<string>('');

  const matchmakingRef = useRef<MatchmakingService | null>(null);
  const joinCodeTransportRef = useRef<JoinCodeTransport | null>(null);

  const handleStateChange = useCallback((state: string) => {
    console.log('[PokerLobby] Matchmaking state:', state);
    if (state === 'lobby') {
      setPhase('lobby');
    } else if (state === 'game') {
      setPhase('starting');
    } else if (state === 'error') {
      setPhase('error');
    }
  }, []);

  const handleTableFound = useCallback((table: { roomCode: string; hostPeerId: string; hostName: string; maxPlayers: number }) => {
    console.log('[PokerLobby] Table found:', table);
    setCurrentRoomCode(table.roomCode);
  }, []);

  const handlePlayerJoined = useCallback((player: PlayerInfo) => {
    console.log('[PokerLobby] Player joined:', player);
    setPlayers(prev => {
      const existing = prev.find(p => p.peerId === player.peerId);
      if (existing) {
        return prev.map(p => p.peerId === player.peerId ? player : p);
      }
      return [...prev, player];
    });
  }, []);

  const handlePlayerLeft = useCallback((peerId: string, reason: string) => {
    console.log('[PokerLobby] Player left:', peerId, reason);
    setPlayers(prev => prev.filter(p => p.peerId !== peerId));
  }, []);

  const handleReadyChange = useCallback((peerId: string, ready: boolean) => {
    console.log('[PokerLobby] Ready change:', peerId, ready);
    setPlayers(prev => prev.map(p => p.peerId === peerId ? { ...p, ready } : p));
  }, []);

  const handleJoinRequest = useCallback((peerId: string, payload: { displayName: string }) => {
    console.log('[PokerLobby] Join request from:', peerId, payload);
    if (isHost && matchmakingRef.current) {
      const currentPlayers = players.length;
      if (currentPlayers < maxPlayers) {
        matchmakingRef.current.acceptJoin(peerId, currentPlayers);
      } else {
        matchmakingRef.current.rejectJoin(peerId, 'Table is full');
      }
    }
  }, [isHost, maxPlayers, players.length]);

  const handleJoinResponse = useCallback((payload: { accepted: boolean; seatOffered?: number; reason?: string }) => {
    console.log('[PokerLobby] Join response:', payload);
    if (payload.accepted && payload.seatOffered !== undefined) {
      if (matchmakingRef.current) {
        matchmakingRef.current.confirmSeat(payload.seatOffered);
      }
    } else if (!payload.accepted) {
      setError(`Join rejected: ${payload.reason || 'Unknown reason'}`);
      setPhase('error');
    }
  }, []);

  const handleGameStart = useCallback(async (startTime: number, seed?: string, joinCodeFromMsg?: string) => {
    console.log('[PokerLobby] Game starting at:', startTime, 'seed:', seed, 'joinCode:', joinCodeFromMsg?.substring(0, 20));

    if (!isHost && joinCodeFromMsg) {
      setJoinCode(joinCodeFromMsg);
      try {
        const transport = new JoinCodeTransport();
        joinCodeTransportRef.current = transport;

        console.log('[PokerLobby] Guest joining with code:', joinCodeFromMsg.substring(0, 20));
        await transport.joinSession(joinCodeFromMsg);

        const connection = transport.getConnection();
        if (connection) {
          const seat = matchmakingRef.current?.getMySeat() ?? 1;
          const players = matchmakingRef.current?.getPlayers() ?? [];
          const matchId = `poker_${Date.now()}`;

          console.log('[PokerLobby] Guest connected, calling onGameStart');
          onGameStart({
            connection,
            role: 'guest',
            playerID: String(seat),
            matchID: matchId,
            numPlayers: players.length,
          });
        }
      } catch (err) {
        console.error('[PokerLobby] Guest connection failed:', err);
        setError(err instanceof Error ? err.message : 'Failed to connect to game');
        setPhase('error');
      }
    } else if (isHost) {
      setPhase('starting');
    }
  }, [isHost, onGameStart]);

  const handleGameAbort = useCallback((reason: string) => {
    console.log('[PokerLobby] Game aborted:', reason);
    setError(`Game aborted: ${reason}`);
    setPhase('error');
  }, []);

  const handleError = useCallback((err: Error) => {
    console.error('[PokerLobby] Error:', err);
    setError(err.message);
    setPhase('error');
    onError(err);
  }, [onError]);

  useEffect(() => {
    const config = createPokerMatchmakingConfig(displayName, {
      isHost,
      roomCode,
      maxPlayers,
      minBuyIn,
      smallBlind,
      bigBlind,
    });

    const events: PokerLobbyEvents = {
      onTableFound: handleTableFound,
      onPlayerJoined: handlePlayerJoined,
      onPlayerLeft: handlePlayerLeft,
      onReadyChange: handleReadyChange,
      onGameStart: handleGameStart,
      onGameAbort: handleGameAbort,
      onJoinRequest: handleJoinRequest,
      onJoinResponse: handleJoinResponse,
      onError: handleError,
      onStateChange: handleStateChange,
      onBuyInRequired: () => {},
      onBlindsPosted: () => {},
    };

    const matchmaking = new MatchmakingService(config, events);
    matchmakingRef.current = matchmaking;

    matchmaking.start().catch(err => {
      console.error('[PokerLobby] Failed to start matchmaking:', err);
      setError(err.message);
      setPhase('error');
    });

    return () => {
      matchmaking.leaveLobby();
      matchmaking.stop();
    };
  }, []);

  const handleToggleReady = useCallback(() => {
    if (matchmakingRef.current) {
      const newReady = !isReady;
      matchmakingRef.current.setReady(newReady);
      setIsReady(newReady);
    }
  }, [isReady]);

  const handleStartGame = useCallback(async () => {
    if (!matchmakingRef.current || !isHost) return;

    try {
      const transport = new JoinCodeTransport();
      joinCodeTransportRef.current = transport;

      const session = await transport.createHost();

      const joinCodeStr = session.connectionId;
      setJoinCode(joinCodeStr);
      console.log('[PokerLobby] Created join code:', joinCodeStr.substring(0, 20) + '...');

      matchmakingRef.current.startGame(undefined, joinCodeStr);

      setPhase('starting');

      await new Promise<void>((resolve) => {
        const checkConnection = setInterval(() => {
          const conn = transport.getConnection();
          if (conn && conn.isConnected()) {
            clearInterval(checkConnection);
            resolve();
          }
        }, 100);

        setTimeout(() => {
          clearInterval(checkConnection);
          resolve();
        }, 30000);
      });

      const seat = matchmakingRef.current.getMySeat();
      const players = matchmakingRef.current.getPlayers();
      const matchId = session.connectionId;

      console.log('[PokerLobby] Host connected, calling onGameStart');
      onGameStart({
        connection: transport.getConnection()!,
        role: 'host',
        playerID: String(seat),
        matchID: matchId,
        numPlayers: players.length,
      });
    } catch (err) {
      console.error('[PokerLobby] Failed to start game:', err);
      setError(err instanceof Error ? err.message : 'Failed to start game');
      setPhase('error');
    }
  }, [isHost, onGameStart]);

  const handleLeaveLobby = useCallback(() => {
    if (matchmakingRef.current) {
      matchmakingRef.current.leaveLobby();
      matchmakingRef.current.stop();
      matchmakingRef.current = null;
    }
    if (joinCodeTransportRef.current) {
      joinCodeTransportRef.current.cleanup();
      joinCodeTransportRef.current = null;
    }
  }, []);

  if (phase === 'connecting') {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <h2 style={styles.title}>
            {isHost ? 'Creating Game...' : 'Finding Game...'}
          </h2>
          <div style={styles.spinner} />
          {currentRoomCode && (
            <p style={styles.roomCodeLabel}>Room Code: {currentRoomCode}</p>
          )}
        </div>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <h2 style={styles.title}>Error</h2>
          <p style={styles.errorText}>{error}</p>
          <button style={styles.button} onClick={handleLeaveLobby}>
            Back to Lobby
          </button>
        </div>
      </div>
    );
  }

  if (phase === 'starting') {
    return (
      <div style={styles.container}>
        <div style={styles.card}>
          <h2 style={styles.title}>Starting Game...</h2>
          {isHost && joinCode && (
            <div style={styles.joinCodeSection}>
              <p style={styles.joinCodeLabel}>Share this code with other players:</p>
              <div style={styles.joinCodeBox}>{joinCode}</div>
            </div>
          )}
          {!isHost && <div style={styles.spinner} />}
          <p style={styles.waitingText}>Waiting for players to connect...</p>
        </div>
      </div>
    );
  }

  const allPlayersReady = players.length >= 2 && players.every(p => p.ready);
  const canStart = isHost && allPlayersReady;

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={styles.header}>
          <h2 style={styles.title}>Poker Lobby</h2>
          <span style={styles.roomCodeBadge}>Room: {currentRoomCode}</span>
        </div>

        <div style={styles.playerList}>
          <h3 style={styles.subtitle}>Players ({players.length}/{maxPlayers})</h3>
          {players.map(player => (
            <div key={player.peerId} style={styles.playerRow}>
              <span style={styles.playerName}>
                {player.name}
                {player.peerId === myPeerId && ' (You)'}
                {player.seat === 0 && ' (Host)'}
              </span>
              <span style={{
                ...styles.playerStatus,
                color: player.ready ? '#22c55e' : '#f59e0b',
              }}>
                {player.ready ? 'Ready' : 'Not Ready'}
              </span>
            </div>
          ))}
        </div>

        <div style={styles.blindsInfo}>
          <span>Small Blind: ${smallBlind}</span>
          <span>Big Blind: ${bigBlind}</span>
          <span>Min Buy-in: ${minBuyIn}</span>
        </div>

        <div style={styles.actions}>
          <button
            style={{
              ...styles.button,
              ...(isReady ? styles.readyButton : {}),
            }}
            onClick={handleToggleReady}
          >
            {isReady ? 'Cancel Ready' : 'Ready'}
          </button>

          {isHost && (
            <button
              style={{
                ...styles.button,
                ...(canStart ? styles.primaryButton : styles.disabledButton),
              }}
              onClick={handleStartGame}
              disabled={!canStart}
            >
              Start Game
            </button>
          )}
        </div>

        {!isHost && (
          <p style={styles.waitingText}>
            Waiting for host to start the game...
          </p>
        )}

        <button style={styles.leaveButton} onClick={handleLeaveLobby}>
          Leave Lobby
        </button>
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    minHeight: '100vh',
    backgroundColor: '#1a1a2e',
    padding: '20px',
  },
  card: {
    backgroundColor: '#16213e',
    borderRadius: '12px',
    padding: '32px',
    maxWidth: '480px',
    width: '100%',
    boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '24px',
  },
  title: {
    color: '#e4e4e4',
    margin: 0,
    fontSize: '24px',
  },
  roomCodeBadge: {
    backgroundColor: '#2a4365',
    color: '#63b3ed',
    padding: '4px 12px',
    borderRadius: '16px',
    fontSize: '14px',
    fontFamily: 'monospace',
  },
  subtitle: {
    color: '#a0aec0',
    margin: '0 0 12px 0',
    fontSize: '14px',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  },
  playerList: {
    marginBottom: '24px',
  },
  playerRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px',
    backgroundColor: '#1e2a45',
    borderRadius: '8px',
    marginBottom: '8px',
  },
  playerName: {
    color: '#e4e4e4',
    fontWeight: 500,
  },
  playerStatus: {
    fontSize: '12px',
    fontWeight: 600,
  },
  blindsInfo: {
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: '24px',
    padding: '12px',
    backgroundColor: '#2a4365',
    borderRadius: '8px',
    color: '#a0aec0',
    fontSize: '13px',
  },
  actions: {
    display: 'flex',
    gap: '12px',
    marginBottom: '16px',
  },
  button: {
    flex: 1,
    padding: '12px 24px',
    borderRadius: '8px',
    border: 'none',
    fontSize: '16px',
    fontWeight: 600,
    cursor: 'pointer',
    backgroundColor: '#374151',
    color: '#e4e4e4',
    transition: 'background-color 0.2s',
  },
  readyButton: {
    backgroundColor: '#22c55e',
    color: '#fff',
  },
  primaryButton: {
    backgroundColor: '#3b82f6',
    color: '#fff',
  },
  disabledButton: {
    backgroundColor: '#374151',
    color: '#6b7280',
    cursor: 'not-allowed',
  },
  leaveButton: {
    width: '100%',
    padding: '10px',
    borderRadius: '8px',
    border: '1px solid #4a5568',
    backgroundColor: 'transparent',
    color: '#a0aec0',
    fontSize: '14px',
    cursor: 'pointer',
  },
  spinner: {
    width: '40px',
    height: '40px',
    border: '3px solid #374151',
    borderTopColor: '#3b82f6',
    borderRadius: '50%',
    animation: 'spin 1s linear infinite',
    margin: '20px auto',
  },
  roomCodeLabel: {
    color: '#63b3ed',
    fontFamily: 'monospace',
    fontSize: '18px',
    marginTop: '16px',
  },
  errorText: {
    color: '#ef4444',
    textAlign: 'center',
    marginBottom: '16px',
  },
  joinCodeSection: {
    textAlign: 'center',
    margin: '20px 0',
  },
  joinCodeLabel: {
    color: '#a0aec0',
    marginBottom: '8px',
  },
  joinCodeBox: {
    backgroundColor: '#1e2a45',
    padding: '16px',
    borderRadius: '8px',
    fontFamily: 'monospace',
    fontSize: '18px',
    color: '#63b3ed',
    wordBreak: 'break-all',
  },
  waitingText: {
    color: '#6b7280',
    textAlign: 'center',
    fontSize: '14px',
    marginTop: '16px',
  },
};

export default PokerLobby;