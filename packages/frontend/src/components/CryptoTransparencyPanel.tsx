/**
 * Crypto Transparency Panel
 *
 * Displays cryptographic state to prove fairness to users.
 * Shows encrypted deck data, player keys, and verification info.
 */

import React, { useState } from 'react';
import type { CryptoPluginState } from '../crypto/plugin/crypto-plugin';

interface CryptoTransparencyPanelProps {
  /** Crypto plugin state from game */
  crypto?: CryptoPluginState;
  /** Number of players in the game */
  numPlayers: number;
  /** Current player ID */
  currentPlayerId?: string;
  /** Whether panel is expanded by default */
  defaultExpanded?: boolean;
}

/**
 * Truncate a hex string for display
 */
function truncateHex(hex: string, length: number = 16): string {
  if (hex.length <= length * 2) return hex;
  return `${hex.slice(0, length)}...${hex.slice(-length)}`;
}

/**
 * Copy text to clipboard
 */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Status badge component
 */
const StatusBadge: React.FC<{
  status: 'secure' | 'pending' | 'warning';
  label: string;
}> = ({ status, label }) => {
  const colors = {
    secure: { bg: '#065f46', border: '#10b981', text: '#6ee7b7' },
    pending: { bg: '#78350f', border: '#f59e0b', text: '#fcd34d' },
    warning: { bg: '#7f1d1d', border: '#ef4444', text: '#fca5a5' },
  };
  const c = colors[status];

  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      padding: '4px 10px',
      backgroundColor: c.bg,
      border: `1px solid ${c.border}`,
      borderRadius: '12px',
      fontSize: '12px',
      color: c.text,
      fontWeight: 500,
    }}>
      <span style={{
        width: '8px',
        height: '8px',
        borderRadius: '50%',
        backgroundColor: c.border,
      }} />
      {label}
    </span>
  );
};

/**
 * Collapsible section component
 */
const Section: React.FC<{
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}> = ({ title, children, defaultOpen = false }) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div style={{
      marginBottom: '12px',
      border: '1px solid #3a3a5c',
      borderRadius: '8px',
      overflow: 'hidden',
    }}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          width: '100%',
          padding: '10px 12px',
          backgroundColor: '#1e293b',
          border: 'none',
          color: '#e4e4e4',
          fontSize: '13px',
          fontWeight: 600,
          cursor: 'pointer',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span>{title}</span>
        <span style={{ transform: isOpen ? 'rotate(180deg)' : 'none', transition: '0.2s' }}>
          ▼
        </span>
      </button>
      {isOpen && (
        <div style={{ padding: '12px', backgroundColor: '#0f172a' }}>
          {children}
        </div>
      )}
    </div>
  );
};

/**
 * Hex data display with copy button
 */
const HexDisplay: React.FC<{
  label: string;
  value: string;
  fullWidth?: boolean;
}> = ({ label, value, fullWidth }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const success = await copyToClipboard(value);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div style={{ marginBottom: '8px' }}>
      <div style={{
        fontSize: '11px',
        color: '#94a3b8',
        marginBottom: '4px',
        fontWeight: 500,
      }}>
        {label}
      </div>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
      }}>
        <code style={{
          flex: 1,
          padding: '6px 8px',
          backgroundColor: '#1e293b',
          borderRadius: '4px',
          fontSize: '11px',
          color: '#67e8f9',
          fontFamily: 'monospace',
          wordBreak: 'break-all',
          overflow: 'hidden',
          textOverflow: fullWidth ? 'clip' : 'ellipsis',
          whiteSpace: fullWidth ? 'normal' : 'nowrap',
        }}>
          {fullWidth ? value : truncateHex(value, 20)}
        </code>
        <button
          onClick={handleCopy}
          style={{
            padding: '4px 8px',
            backgroundColor: copied ? '#065f46' : '#334155',
            border: 'none',
            borderRadius: '4px',
            color: '#e4e4e4',
            fontSize: '11px',
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          {copied ? '✓' : 'Copy'}
        </button>
      </div>
    </div>
  );
};

/**
 * Main Crypto Transparency Panel
 */
export const CryptoTransparencyPanel: React.FC<CryptoTransparencyPanelProps> = ({
  crypto,
  numPlayers,
  currentPlayerId,
  defaultExpanded = false,
}) => {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [showTechnical, setShowTechnical] = useState(false);

  // Derive stats from crypto state
  const publicKeyCount = crypto ? Object.keys(crypto.publicKeys).length : 0;
  const encryptedCardCount = crypto?.encryptedZones?.deck?.length || 0;
  const revealedCardCount = crypto ? Object.keys(crypto.revealedCards).length : 0;
  const commitmentCount = crypto ? Object.keys(crypto.commitments).length : 0;
  const shuffleProofCount = crypto ? Object.keys(crypto.shuffleProofs).length : 0;
  const pendingRevealCount = crypto ? Object.keys(crypto.pendingReveals).length : 0;

  // Determine overall status
  const getStatus = (): 'secure' | 'pending' | 'warning' => {
    if (!crypto) return 'pending';
    if (crypto.phase === 'ready' || crypto.phase === 'playing') {
      if (publicKeyCount >= numPlayers && encryptedCardCount > 0) {
        return 'secure';
      }
    }
    if (crypto.phase === 'init' || crypto.phase === 'keyExchange') {
      return 'pending';
    }
    return 'pending';
  };

  const status = getStatus();
  const statusLabels = {
    secure: 'Cryptographically Secured',
    pending: 'Setup In Progress',
    warning: 'Verification Needed',
  };

  // Local mode view (when crypto is not available)
  const renderLocalModeView = () => (
    <div style={{ padding: '16px' }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        marginBottom: '16px',
      }}>
        <span style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          padding: '4px 10px',
          backgroundColor: '#1e3a5f',
          border: '1px solid #3b82f6',
          borderRadius: '12px',
          fontSize: '12px',
          color: '#93c5fd',
          fontWeight: 500,
        }}>
          <span style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            backgroundColor: '#3b82f6',
          }} />
          Local Hotseat Mode
        </span>
      </div>

      <div style={{
        padding: '16px',
        backgroundColor: '#0f172a',
        borderRadius: '8px',
        border: '1px solid #3a3a5c',
        marginBottom: '16px',
      }}>
        <div style={{
          fontSize: '14px',
          fontWeight: 600,
          color: '#e4e4e4',
          marginBottom: '12px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
        }}>
          <span style={{ fontSize: '20px' }}>🖥️</span>
          Local Play - No Encryption Needed
        </div>
        <p style={{
          margin: 0,
          fontSize: '13px',
          color: '#94a3b8',
          lineHeight: '1.6',
        }}>
          You're playing in <strong style={{ color: '#e4e4e4' }}>local hotseat mode</strong> where
          both players share the same screen. Cryptographic fairness verification is not needed
          because there's no network communication that could be tampered with.
        </p>
      </div>

      <div style={{
        padding: '12px',
        backgroundColor: '#1e293b',
        borderRadius: '8px',
        border: '1px solid #3a3a5c',
      }}>
        <div style={{
          fontSize: '13px',
          fontWeight: 600,
          color: '#e4e4e4',
          marginBottom: '8px',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
        }}>
          <span>🌐</span> Want Cryptographic Fairness?
        </div>
        <p style={{
          margin: 0,
          fontSize: '12px',
          color: '#94a3b8',
          lineHeight: '1.5',
        }}>
          Use <strong style={{ color: '#3b82f6' }}>P2P Online</strong> mode to play over the
          network with mental poker encryption. This ensures neither player can cheat, even
          without a trusted server.
        </p>
      </div>
    </div>
  );

  // Simple view content
  const renderSimpleView = () => (
    <div>
      {/* Status Overview */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '16px',
      }}>
        <StatusBadge status={status} label={statusLabels[status]} />
        <span style={{ fontSize: '12px', color: '#94a3b8' }}>
          Phase: <strong style={{ color: '#e4e4e4' }}>{crypto?.phase || 'N/A'}</strong>
        </span>
      </div>

      {/* Quick Stats */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: '12px',
        marginBottom: '16px',
      }}>
        <div style={{
          padding: '12px',
          backgroundColor: '#1e293b',
          borderRadius: '8px',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#10b981' }}>
            {publicKeyCount}/{numPlayers}
          </div>
          <div style={{ fontSize: '11px', color: '#94a3b8' }}>Keys Exchanged</div>
        </div>
        <div style={{
          padding: '12px',
          backgroundColor: '#1e293b',
          borderRadius: '8px',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#f59e0b' }}>
            {encryptedCardCount}
          </div>
          <div style={{ fontSize: '11px', color: '#94a3b8' }}>Cards Encrypted</div>
        </div>
        <div style={{
          padding: '12px',
          backgroundColor: '#1e293b',
          borderRadius: '8px',
          textAlign: 'center',
        }}>
          <div style={{ fontSize: '24px', fontWeight: 'bold', color: '#3b82f6' }}>
            {revealedCardCount}
          </div>
          <div style={{ fontSize: '11px', color: '#94a3b8' }}>Cards Revealed</div>
        </div>
      </div>

      {/* How It Works */}
      <div style={{
        padding: '12px',
        backgroundColor: '#0f172a',
        borderRadius: '8px',
        border: '1px solid #3a3a5c',
        marginBottom: '12px',
      }}>
        <div style={{
          fontSize: '13px',
          fontWeight: 600,
          color: '#e4e4e4',
          marginBottom: '8px',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
        }}>
          <span>🔐</span> How Mental Poker Works
        </div>
        <ul style={{
          margin: 0,
          paddingLeft: '20px',
          fontSize: '12px',
          color: '#94a3b8',
          lineHeight: '1.6',
        }}>
          <li>Each player generates a secret encryption key</li>
          <li>The deck is encrypted by ALL players in sequence</li>
          <li>No single player can see any card without cooperation</li>
          <li>Cards are revealed only when ALL players decrypt together</li>
          <li>Shuffle proofs ensure no tampering occurred</li>
        </ul>
      </div>

      {/* Console Instructions */}
      <div style={{
        padding: '12px',
        backgroundColor: '#1e293b',
        borderRadius: '8px',
        border: '1px dashed #3a3a5c',
      }}>
        <div style={{
          fontSize: '12px',
          color: '#94a3b8',
          marginBottom: '8px',
        }}>
          <strong style={{ color: '#e4e4e4' }}>Verify in Console:</strong> Open browser DevTools (F12) and run:
        </div>
        <code style={{
          display: 'block',
          padding: '8px',
          backgroundColor: '#0f172a',
          borderRadius: '4px',
          fontSize: '11px',
          color: '#67e8f9',
          fontFamily: 'monospace',
        }}>
          console.log(window.__CRYPTO_STATE__)
        </code>
      </div>
    </div>
  );

  // Technical view content
  const renderTechnicalView = () => (
    <div>
      {/* Player Public Keys */}
      <Section title={`Player Public Keys (${publicKeyCount})`} defaultOpen>
        {crypto && Object.entries(crypto.publicKeys).length > 0 ? (
          Object.entries(crypto.publicKeys).map(([playerId, key]) => (
            <HexDisplay
              key={playerId}
              label={`Player ${playerId}${playerId === currentPlayerId ? ' (You)' : ''}`}
              value={key}
            />
          ))
        ) : (
          <div style={{ color: '#64748b', fontSize: '12px' }}>No keys exchanged yet</div>
        )}
      </Section>

      {/* Encrypted Deck */}
      <Section title={`Encrypted Deck (${encryptedCardCount} cards)`}>
        {crypto?.encryptedZones?.deck && crypto.encryptedZones.deck.length > 0 ? (
          <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
            {crypto.encryptedZones.deck.slice(0, 10).map((card, idx) => (
              <HexDisplay
                key={idx}
                label={`Card ${idx} (${card.layers} encryption layers)`}
                value={card.ciphertext}
              />
            ))}
            {crypto.encryptedZones.deck.length > 10 && (
              <div style={{ color: '#64748b', fontSize: '12px', marginTop: '8px' }}>
                ... and {crypto.encryptedZones.deck.length - 10} more cards
              </div>
            )}
          </div>
        ) : (
          <div style={{ color: '#64748b', fontSize: '12px' }}>Deck not encrypted yet</div>
        )}
      </Section>

      {/* Deck Commitments */}
      <Section title={`Deck Commitments (${commitmentCount})`}>
        {crypto && Object.entries(crypto.commitments).length > 0 ? (
          Object.entries(crypto.commitments).map(([playerId, commitment]) => (
            <div key={playerId} style={{ marginBottom: '12px' }}>
              <HexDisplay
                label={`Player ${playerId} - Hash`}
                value={commitment.hash}
              />
              <div style={{ fontSize: '11px', color: '#64748b' }}>
                Timestamp: {new Date(commitment.timestamp).toLocaleString()}
              </div>
            </div>
          ))
        ) : (
          <div style={{ color: '#64748b', fontSize: '12px' }}>No commitments yet</div>
        )}
      </Section>

      {/* Shuffle Proofs */}
      <Section title={`Shuffle Proofs (${shuffleProofCount})`}>
        {crypto && Object.entries(crypto.shuffleProofs).length > 0 ? (
          Object.entries(crypto.shuffleProofs).map(([playerId, proof]) => (
            <div key={playerId} style={{ marginBottom: '12px' }}>
              <div style={{ fontSize: '12px', color: '#e4e4e4', marginBottom: '8px' }}>
                Player {playerId}
              </div>
              <HexDisplay label="Commitment" value={proof.commitment} />
              <HexDisplay label="Input Hash" value={proof.inputHash} />
              <HexDisplay label="Output Hash" value={proof.outputHash} />
            </div>
          ))
        ) : (
          <div style={{ color: '#64748b', fontSize: '12px' }}>No shuffle proofs yet</div>
        )}
      </Section>

      {/* Revealed Cards */}
      <Section title={`Revealed Cards (${revealedCardCount})`}>
        {crypto && Object.entries(crypto.revealedCards).length > 0 ? (
          Object.entries(crypto.revealedCards).map(([idx, cardId]) => (
            <div key={idx} style={{
              display: 'flex',
              justifyContent: 'space-between',
              padding: '4px 0',
              fontSize: '12px',
              borderBottom: '1px solid #1e293b',
            }}>
              <span style={{ color: '#94a3b8' }}>Position {idx}</span>
              <span style={{ color: '#10b981', fontFamily: 'monospace' }}>{cardId}</span>
            </div>
          ))
        ) : (
          <div style={{ color: '#64748b', fontSize: '12px' }}>No cards revealed yet</div>
        )}
      </Section>

      {/* Pending Reveals */}
      {pendingRevealCount > 0 && (
        <Section title={`Pending Reveals (${pendingRevealCount})`}>
          {Object.entries(crypto!.pendingReveals).map(([cardIdx, shares]) => (
            <div key={cardIdx} style={{ marginBottom: '8px' }}>
              <div style={{ fontSize: '12px', color: '#f59e0b', marginBottom: '4px' }}>
                Card {cardIdx} - Waiting for decryption shares
              </div>
              <div style={{ fontSize: '11px', color: '#64748b' }}>
                Shares received: {Object.keys(shares).length}/{numPlayers}
              </div>
            </div>
          ))}
        </Section>
      )}

      {/* Raw State Export */}
      <Section title="Export Full State">
        <button
          onClick={() => {
            const data = JSON.stringify(crypto, null, 2);
            copyToClipboard(data);
          }}
          style={{
            width: '100%',
            padding: '10px',
            backgroundColor: '#3b82f6',
            border: 'none',
            borderRadius: '6px',
            color: 'white',
            fontSize: '13px',
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          Copy Full Crypto State as JSON
        </button>
        <div style={{
          marginTop: '8px',
          fontSize: '11px',
          color: '#64748b',
        }}>
          Share this JSON with a cryptographer to verify fairness
        </div>
      </Section>
    </div>
  );

  // Expose crypto state to window for console access
  React.useEffect(() => {
    if (crypto) {
      (window as unknown as { __CRYPTO_STATE__: CryptoPluginState }).__CRYPTO_STATE__ = crypto;
    }
  }, [crypto]);

  return (
    <div style={{
      position: 'fixed',
      bottom: '20px',
      left: '20px',
      width: isExpanded ? '380px' : 'auto',
      maxHeight: isExpanded ? '80vh' : 'auto',
      backgroundColor: '#16213e',
      border: '1px solid #3a3a5c',
      borderRadius: '12px',
      boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
      overflow: 'hidden',
      zIndex: 99999,
      fontFamily: 'system-ui, sans-serif',
    }}>
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        style={{
          width: '100%',
          padding: '12px 16px',
          backgroundColor: '#1e293b',
          border: 'none',
          color: '#e4e4e4',
          fontSize: '14px',
          fontWeight: 600,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '18px' }}>🔒</span>
          {isExpanded ? 'Fairness Proof' : 'Verify Fairness'}
        </span>
        <span style={{
          transform: isExpanded ? 'rotate(180deg)' : 'none',
          transition: '0.2s',
        }}>
          ▲
        </span>
      </button>

      {/* Content */}
      {isExpanded && (
        <div style={{
          overflowY: 'auto',
          maxHeight: 'calc(80vh - 50px)',
        }}>
          {/* Show local mode view when crypto is not available */}
          {!crypto ? renderLocalModeView() : (
            <div style={{ padding: '16px' }}>
              {/* View Toggle */}
              <div style={{
                display: 'flex',
                gap: '8px',
                marginBottom: '16px',
              }}>
                <button
                  onClick={() => setShowTechnical(false)}
                  style={{
                    flex: 1,
                    padding: '8px',
                    backgroundColor: !showTechnical ? '#3b82f6' : '#334155',
                    border: 'none',
                    borderRadius: '6px',
                    color: 'white',
                    fontSize: '12px',
                    fontWeight: 500,
                    cursor: 'pointer',
                  }}
                >
                  Simple View
                </button>
                <button
                  onClick={() => setShowTechnical(true)}
                  style={{
                    flex: 1,
                    padding: '8px',
                    backgroundColor: showTechnical ? '#3b82f6' : '#334155',
                    border: 'none',
                    borderRadius: '6px',
                    color: 'white',
                    fontSize: '12px',
                    fontWeight: 500,
                    cursor: 'pointer',
                  }}
                >
                  Technical Details
                </button>
              </div>

              {/* View Content */}
              {showTechnical ? renderTechnicalView() : renderSimpleView()}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default CryptoTransparencyPanel;
