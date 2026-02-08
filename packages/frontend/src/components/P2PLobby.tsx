/**
 * P2P Lobby Component
 * Handles the two-way join code exchange for establishing P2P connections
 * Uses wallet context for demo wallet display
 * Now includes transport settings for configurable P2P connections
 * Includes a "ready" phase for deck selection + asset sharing before game start
 */

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { JoinCodeConnection, type JoinCodeState, type ConnectionState } from '../p2p';
import { useWallet } from '../blockchain/wallet';
import { useTransportConfig } from '../hooks/useTransportConfig';
import { TransportBadge } from './TransportBadge';
import { TransportToggles, TransportSettingsModal } from './TransportSettings';
import { LobbyProtocol, type LobbyControlMessage } from '../p2p/lobby-protocol';
import { useAssetSharing, type AssetSharingChannel } from '../hooks/useAssetSharing';
import { useDeckStorage } from '../hooks/useDeckStorage';
import type { DeckList } from '../deck/types';
import {
  SenderConsentDialog,
  ReceiverConsentDialog,
  MissingPacksNotice,
  TransferList,
  BlockList,
} from './AssetPackSharing';

export type P2PRole = 'host' | 'guest';

/** Lobby phase after P2P connection is established */
type LobbyReadyPhase = 'deck-select' | 'both-ready';

interface P2PLobbyProps {
  onConnected: (connection: JoinCodeConnection, role: P2PRole) => void;
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
  const [isCreatingGame, setIsCreatingGame] = useState(false);
  const [showTransportSettings, setShowTransportSettings] = useState(false);

  // Use wallet from context (provided by App)
  const { wallet, status: walletStatus } = useWallet();
  const isConnectingWallet = walletStatus === 'connecting';

  // Transport configuration
  const { status: transportStatus, config: transportConfig, isForced } = useTransportConfig();

  const connectionRef = useRef<JoinCodeConnection | null>(null);
  const roleRef = useRef<P2PRole>('host');
  const lobbyProtocolRef = useRef<LobbyProtocol | null>(null);
  const [lobbyChannel, setLobbyChannel] = useState<AssetSharingChannel | null>(null);

  // Ready phase state
  const [readyPhase, setReadyPhase] = useState<LobbyReadyPhase | null>(null);
  const [selectedDeck, setSelectedDeck] = useState<DeckList | null>(null);
  const [localReady, setLocalReady] = useState(false);
  const [peerReady, setPeerReady] = useState(false);
  const [deckShared, setDeckShared] = useState(false);

  // Deck storage
  const { decks, isLoading: isLoadingDecks } = useDeckStorage();

  // Known card IDs from selected deck's pack (populated when deck is selected)
  const knownCardIds = useMemo(() => {
    // For now, return empty set — in future, populate from loaded pack card IDs
    return new Set<string>();
  }, []);

  // Asset sharing state
  const assetSharing = useAssetSharing(lobbyChannel, knownCardIds);

  // Initialize connection on mount
  useEffect(() => {
    connectionRef.current = new JoinCodeConnection({
      onStateChange: (state) => {
        setJoinCodeState(state);
        if (state.phase === 'error') {
          setError(state.error);
        }
        // Track role from state
        if ('role' in state && state.role) {
          roleRef.current = state.role;
        }
      },
      onMessage: (data) => {
        // Route lobby protocol messages
        if (lobbyProtocolRef.current?.handleRawMessage(data)) {
          return; // consumed by lobby protocol
        }
        console.log('[P2PLobby] Received message:', data);
      },
      onConnectionStateChange: (state) => {
        setConnectionState(state);
        if (state === 'connected' && connectionRef.current) {
          // Set up lobby protocol for asset sharing + ready coordination
          const protocol = new LobbyProtocol(connectionRef.current);
          lobbyProtocolRef.current = protocol;
          setLobbyChannel(protocol);

          // Enter deck selection phase instead of immediately starting game
          setReadyPhase('deck-select');
        }
      },
    });

    return () => {
      // Clean up lobby protocol
      lobbyProtocolRef.current?.detach();
      lobbyProtocolRef.current = null;

      // Only close if we're NOT connected - if connected, the connection
      // has been handed off to the parent component and should not be closed
      if (connectionRef.current && !connectionRef.current.isConnected()) {
        connectionRef.current.close();
      }
    };
  }, [onConnected]);

  // Listen for lobby control messages (peer ready state)
  useEffect(() => {
    const protocol = lobbyProtocolRef.current;
    if (!protocol) return;

    const unsub = protocol.onControl((msg: LobbyControlMessage) => {
      if (msg.type === 'lobby-ready') {
        setPeerReady(msg.ready);
      }
    });

    return unsub;
  }, [lobbyChannel]); // re-subscribe when channel changes (protocol is created)

  // When both players are ready, start the game
  useEffect(() => {
    if (localReady && peerReady && connectionRef.current) {
      setReadyPhase('both-ready');
      // Small delay for UI feedback before transitioning
      const timer = setTimeout(() => {
        if (connectionRef.current) {
          onConnected(connectionRef.current, roleRef.current);
        }
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [localReady, peerReady, onConnected]);

  // Share deck list with peer
  const { shareDeckList } = assetSharing;
  const handleSelectDeck = useCallback((deck: DeckList) => {
    setSelectedDeck(deck);

    // Share deck list via asset sharing protocol
    if (lobbyChannel) {
      shareDeckList(
        {
          name: deck.name,
          game: deck.game,
          pack: deck.packId,
          leader: deck.leaderId,
          cards: deck.cards,
        },
        {
          id: deck.packId,
          name: deck.packId, // Could resolve to actual pack name
          game: deck.game,
          cardCount: Object.keys(deck.cards).length,
        },
      );
      setDeckShared(true);
    }
  }, [lobbyChannel, shareDeckList]);

  // Toggle ready state
  const handleToggleReady = useCallback(() => {
    const newReady = !localReady;
    setLocalReady(newReady);
    lobbyProtocolRef.current?.sendControl({ type: 'lobby-ready', ready: newReady });
  }, [localReady]);

  const handleCreateGame = useCallback(async () => {
    if (!connectionRef.current || isCreatingGame) return;
    setError(null);
    setCopied(false);
    setIsCreatingGame(true);

    try {
      const code = await connectionRef.current.createGame();
      setOfferCode(code);
      setMode('host');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create game');
    } finally {
      setIsCreatingGame(false);
    }
  }, [isCreatingGame]);

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

  // Wallet badge component
  const WalletBadge = () => (
    <div style={{
      backgroundColor: '#0f3460',
      padding: '8px 12px',
      borderRadius: '8px',
      marginBottom: '16px',
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      border: '1px solid #3a3a5c',
    }}>
      <span style={{ color: '#6fcf6f', fontSize: '10px' }}>●</span>
      <span style={{ color: '#a0a0a0', fontSize: '12px' }}>Wallet:</span>
      {isConnectingWallet ? (
        <span style={{ color: '#ff9800', fontSize: '12px' }}>Connecting...</span>
      ) : wallet ? (
        <span style={{
          color: '#e4e4e4',
          fontSize: '12px',
          fontFamily: 'monospace',
        }}>
          {wallet.address.slice(0, 6)}...{wallet.address.slice(-4)}
        </span>
      ) : (
        <span style={{ color: '#ff6b6b', fontSize: '12px' }}>Not connected</span>
      )}
      <span style={{
        backgroundColor: '#3a3a5c',
        padding: '2px 6px',
        borderRadius: '4px',
        fontSize: '10px',
        color: '#a0a0a0',
      }}>
        Demo
      </span>
    </div>
  );

  // Transport status header component
  const TransportHeader = () => (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: '16px',
      padding: '8px 12px',
      backgroundColor: '#0f3460',
      borderRadius: '8px',
      border: '1px solid #3a3a5c',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <TransportBadge
          status={transportStatus}
          onClick={() => setShowTransportSettings(true)}
        />
        {isForced && (
          <span style={{
            fontSize: '10px',
            padding: '2px 6px',
            backgroundColor: '#f59e0b',
            color: '#000',
            borderRadius: '4px',
            fontWeight: 600,
          }}>
            FORCED: {transportConfig.forced}
          </span>
        )}
      </div>
      <TransportToggles
        compact
        onSettingsClick={() => setShowTransportSettings(true)}
      />
    </div>
  );

  // Mode: Select (Create or Join)
  if (mode === 'select') {
    return (
      <div style={containerStyle}>
        <WalletBadge />
        <TransportHeader />
        <h1 style={{ color: '#e4e4e4', marginBottom: '8px' }}>P2P Online Game</h1>
        <p style={{ color: '#a0a0a0', marginBottom: '24px' }}>
          Connect directly with another player - no server required!
        </p>

        <div style={cardStyle}>
          <h2 style={{ color: '#e4e4e4', marginBottom: '16px' }}>Start a Game</h2>

          <button
            style={{
              ...buttonStyle,
              opacity: isCreatingGame ? 0.7 : 1,
              cursor: isCreatingGame ? 'wait' : 'pointer',
            }}
            onClick={handleCreateGame}
            disabled={isCreatingGame}
          >
            {isCreatingGame ? 'Creating Game...' : 'Create Game (Host)'}
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

        {showTransportSettings && (
          <TransportSettingsModal onClose={() => setShowTransportSettings(false)} />
        )}
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
        <WalletBadge />
        <TransportHeader />
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

        {/* Ready phase (deck selection + asset sharing) */}
        {isConnected && readyPhase && (
          <ReadyPhaseUI
            readyPhase={readyPhase}
            decks={decks}
            isLoadingDecks={isLoadingDecks}
            selectedDeck={selectedDeck}
            deckShared={deckShared}
            localReady={localReady}
            peerReady={peerReady}
            peerDeckList={assetSharing.peerDeckList}
            assetSharing={assetSharing}
            onSelectDeck={handleSelectDeck}
            onToggleReady={handleToggleReady}
            cardStyle={cardStyle}
            buttonStyle={buttonStyle}
            secondaryButtonStyle={secondaryButtonStyle}
            statusStyle={statusStyle}
          />
        )}

        {error && (
          <div style={{ ...statusStyle, backgroundColor: '#4a1a1a', color: '#ff6b6b' }}>
            Error: {error}
          </div>
        )}

        <button style={secondaryButtonStyle} onClick={handleBack}>
          Cancel
        </button>

        {showTransportSettings && (
          <TransportSettingsModal onClose={() => setShowTransportSettings(false)} />
        )}
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
        <WalletBadge />
        <TransportHeader />
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

        {/* Ready phase (deck selection + asset sharing) */}
        {isConnected && readyPhase && (
          <ReadyPhaseUI
            readyPhase={readyPhase}
            decks={decks}
            isLoadingDecks={isLoadingDecks}
            selectedDeck={selectedDeck}
            deckShared={deckShared}
            localReady={localReady}
            peerReady={peerReady}
            peerDeckList={assetSharing.peerDeckList}
            assetSharing={assetSharing}
            onSelectDeck={handleSelectDeck}
            onToggleReady={handleToggleReady}
            cardStyle={cardStyle}
            buttonStyle={buttonStyle}
            secondaryButtonStyle={secondaryButtonStyle}
            statusStyle={statusStyle}
          />
        )}

        {error && (
          <div style={{ ...statusStyle, backgroundColor: '#4a1a1a', color: '#ff6b6b' }}>
            Error: {error}
          </div>
        )}

        <button style={secondaryButtonStyle} onClick={handleBack}>
          Cancel
        </button>

        {showTransportSettings && (
          <TransportSettingsModal onClose={() => setShowTransportSettings(false)} />
        )}
      </div>
    );
  }

  return null;
};

// ---------------------------------------------------------------------------
// Ready Phase UI — Deck selection, asset sharing, ready coordination
// ---------------------------------------------------------------------------

interface ReadyPhaseUIProps {
  readyPhase: LobbyReadyPhase;
  decks: DeckList[];
  isLoadingDecks: boolean;
  selectedDeck: DeckList | null;
  deckShared: boolean;
  localReady: boolean;
  peerReady: boolean;
  peerDeckList: ReturnType<typeof useAssetSharing>['peerDeckList'];
  assetSharing: ReturnType<typeof useAssetSharing>;
  onSelectDeck: (deck: DeckList) => void;
  onToggleReady: () => void;
  cardStyle: React.CSSProperties;
  buttonStyle: React.CSSProperties;
  secondaryButtonStyle: React.CSSProperties;
  statusStyle: React.CSSProperties;
}

const ReadyPhaseUI: React.FC<ReadyPhaseUIProps> = ({
  readyPhase,
  decks,
  isLoadingDecks,
  selectedDeck,
  deckShared,
  localReady,
  peerReady,
  peerDeckList,
  assetSharing,
  onSelectDeck,
  onToggleReady,
  cardStyle,
  buttonStyle,
  secondaryButtonStyle,
  statusStyle,
}) => {
  const { pendingConsent, missingPacks, transfers, blockedPeers } = assetSharing;

  return (
    <>
      {/* Connection status */}
      <div style={{ ...statusStyle, backgroundColor: '#1a4a3a', color: '#6fcf6f' }}>
        Connected! Select a deck and ready up to start.
      </div>

      {/* Deck selection */}
      <div style={cardStyle}>
        <h3 style={{ color: '#e4e4e4', marginBottom: '12px' }}>Select Your Deck</h3>

        {isLoadingDecks ? (
          <div style={{ color: '#a0a0a0', textAlign: 'center', padding: '12px' }}>
            Loading saved decks...
          </div>
        ) : decks.length === 0 ? (
          <div style={{ color: '#ff9800', textAlign: 'center', padding: '12px' }}>
            No saved decks found. Build a deck in the Deck Builder first.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {decks.map((deck) => (
              <button
                key={deck.id}
                onClick={() => onSelectDeck(deck)}
                disabled={localReady}
                style={{
                  padding: '10px 16px',
                  backgroundColor: selectedDeck?.id === deck.id ? '#0f3460' : '#1a1a2e',
                  color: '#e4e4e4',
                  border: selectedDeck?.id === deck.id ? '2px solid #4CAF50' : '1px solid #3a3a5c',
                  borderRadius: '8px',
                  cursor: localReady ? 'not-allowed' : 'pointer',
                  textAlign: 'left',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  opacity: localReady ? 0.6 : 1,
                }}
              >
                <div>
                  <div style={{ fontWeight: 600 }}>{deck.name}</div>
                  <div style={{ fontSize: '12px', color: '#a0a0a0' }}>
                    {Object.values(deck.cards).reduce((sum, q) => sum + q, 0)} cards
                  </div>
                </div>
                {selectedDeck?.id === deck.id && (
                  <span style={{ color: '#4CAF50', fontSize: '14px' }}>Selected</span>
                )}
              </button>
            ))}
          </div>
        )}

        {deckShared && (
          <div style={{ color: '#6fcf6f', fontSize: '12px', marginTop: '8px' }}>
            Deck list shared with opponent
          </div>
        )}
      </div>

      {/* Opponent deck info */}
      {peerDeckList && (
        <div style={{ ...cardStyle, backgroundColor: '#0f3460' }}>
          <h3 style={{ color: '#e4e4e4', marginBottom: '8px' }}>Opponent's Deck</h3>
          <div style={{ color: '#c0d0e0', fontSize: '14px' }}>
            <strong>{peerDeckList.name}</strong>
            <span style={{ color: '#a0a0a0', marginLeft: '8px' }}>
              ({Object.values(peerDeckList.cards).reduce((sum, q) => sum + q, 0)} cards)
            </span>
          </div>
        </div>
      )}

      {/* Asset sharing overlays */}
      {missingPacks.length > 0 && (
        <MissingPacksNotice
          packNames={missingPacks.map((p) => p.packName)}
          onRequestFromPeer={() => {
            const first = missingPacks[0];
            if (first) assetSharing.requestFromPeer(first.packId, first.missingCardIds);
          }}
          onImportIpfs={() => assetSharing.dismissMissing()}
          onSkip={() => assetSharing.dismissMissing()}
        />
      )}

      <TransferList
        transfers={transfers}
        onCancel={(packId) => assetSharing.cancelTransfer(packId)}
      />

      <BlockList
        blockedPeers={blockedPeers}
        onUnblock={(peerId) => assetSharing.unblockPeer(peerId)}
      />

      {pendingConsent?.type === 'sender' && (
        <SenderConsentDialog
          peerName={pendingConsent.peerId}
          packName={pendingConsent.packName}
          mode={pendingConsent.mode}
          cardCount={pendingConsent.cardIds?.length}
          onAllow={() => assetSharing.allowSenderRequest()}
          onDeny={() => assetSharing.denySenderRequest()}
          onBlock={() => assetSharing.blockPeer()}
        />
      )}

      {pendingConsent?.type === 'receiver' && (
        <ReceiverConsentDialog
          peerName={pendingConsent.peerId}
          packName={pendingConsent.packName}
          mode={pendingConsent.mode}
          totalSize={pendingConsent.totalSize}
          cardCount={pendingConsent.cardCount}
          onAccept={() => assetSharing.acceptReceiverOffer()}
          onDecline={() => assetSharing.declineReceiverOffer()}
          onBlock={() => assetSharing.blockPeer()}
        />
      )}

      {/* Ready status */}
      <div style={cardStyle}>
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '12px',
        }}>
          <div style={{ display: 'flex', gap: '16px' }}>
            <span style={{ color: localReady ? '#6fcf6f' : '#a0a0a0' }}>
              You: {localReady ? 'Ready' : 'Not ready'}
            </span>
            <span style={{ color: peerReady ? '#6fcf6f' : '#a0a0a0' }}>
              Opponent: {peerReady ? 'Ready' : 'Not ready'}
            </span>
          </div>
        </div>

        {readyPhase === 'both-ready' ? (
          <div style={{ ...statusStyle, backgroundColor: '#1a4a3a', color: '#6fcf6f', margin: 0 }}>
            Both players ready! Starting game...
          </div>
        ) : (
          <button
            onClick={onToggleReady}
            disabled={!selectedDeck}
            style={{
              ...buttonStyle,
              backgroundColor: localReady ? '#ff6b6b' : '#4CAF50',
              opacity: !selectedDeck ? 0.5 : 1,
              cursor: !selectedDeck ? 'not-allowed' : 'pointer',
              marginBottom: 0,
            }}
          >
            {localReady ? 'Cancel Ready' : 'Ready'}
          </button>
        )}

        {!selectedDeck && !localReady && (
          <div style={{ color: '#ff9800', fontSize: '12px', marginTop: '8px', textAlign: 'center' }}>
            Select a deck to ready up
          </div>
        )}
      </div>
    </>
  );
};
