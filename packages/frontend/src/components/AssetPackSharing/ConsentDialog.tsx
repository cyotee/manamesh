/**
 * ConsentDialog — Consent prompts for P2P asset pack sharing
 *
 * Shows when a peer requests assets (sender side) or offers assets (receiver side).
 * Supports Allow/Deny/Block actions.
 */

import React from 'react';

// ---------------------------------------------------------------------------
// Sender consent: peer is requesting our assets
// ---------------------------------------------------------------------------

interface SenderConsentProps {
  peerName: string;
  packName: string;
  mode: 'cards-only' | 'full-pack';
  cardCount?: number;
  onAllow: () => void;
  onDeny: () => void;
  onBlock: () => void;
}

export const SenderConsentDialog: React.FC<SenderConsentProps> = ({
  peerName,
  packName,
  mode,
  cardCount,
  onAllow,
  onDeny,
  onBlock,
}) => (
  <div style={overlayStyle}>
    <div style={dialogStyle}>
      <h3 style={titleStyle}>Asset Pack Request</h3>
      <p style={bodyStyle}>
        <strong>{peerName}</strong> is requesting{' '}
        {mode === 'cards-only'
          ? `${cardCount ?? 'some'} card images`
          : 'the full asset pack'}{' '}
        from <strong>{packName}</strong>.
      </p>
      <div style={buttonRowStyle}>
        <button onClick={onAllow} style={allowBtnStyle}>Allow</button>
        <button onClick={onDeny} style={denyBtnStyle}>Deny</button>
        <button onClick={onBlock} style={blockBtnStyle}>Block Player</button>
      </div>
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// Receiver consent: peer is offering to send us assets
// ---------------------------------------------------------------------------

interface ReceiverConsentProps {
  peerName: string;
  packName: string;
  mode: 'cards-only' | 'full-pack';
  totalSize: number;
  cardCount: number;
  onAccept: () => void;
  onDecline: () => void;
  onBlock: () => void;
}

export const ReceiverConsentDialog: React.FC<ReceiverConsentProps> = ({
  peerName,
  packName,
  mode,
  totalSize,
  cardCount,
  onAccept,
  onDecline,
  onBlock,
}) => {
  const sizeStr = formatBytes(totalSize);

  return (
    <div style={overlayStyle}>
      <div style={dialogStyle}>
        <h3 style={titleStyle}>Incoming Asset Pack</h3>
        <p style={bodyStyle}>
          <strong>{peerName}</strong> is sending{' '}
          {mode === 'cards-only'
            ? `${cardCount} card images`
            : 'the full asset pack'}{' '}
          for <strong>{packName}</strong> ({sizeStr}).
        </p>
        <div style={buttonRowStyle}>
          <button onClick={onAccept} style={allowBtnStyle}>Accept</button>
          <button onClick={onDecline} style={denyBtnStyle}>Decline</button>
          <button onClick={onBlock} style={blockBtnStyle}>Block Player</button>
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Missing packs notification
// ---------------------------------------------------------------------------

interface MissingPacksNoticeProps {
  packNames: string[];
  onRequestFromPeer: () => void;
  onImportIpfs: () => void;
  onSkip: () => void;
}

export const MissingPacksNotice: React.FC<MissingPacksNoticeProps> = ({
  packNames,
  onRequestFromPeer,
  onImportIpfs,
  onSkip,
}) => (
  <div style={{
    padding: 12,
    backgroundColor: '#3d2a1a',
    border: '1px solid #ff9800',
    borderRadius: 8,
    marginBottom: 12,
  }}>
    <div style={{ fontSize: 13, color: '#ffcc02', marginBottom: 6, fontWeight: 600 }}>
      Missing Asset Packs
    </div>
    <div style={{ fontSize: 12, color: '#e4e4e4', marginBottom: 8 }}>
      Your opponent&apos;s deck uses cards from packs you don&apos;t have:{' '}
      {packNames.join(', ')}
    </div>
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      <button onClick={onRequestFromPeer} style={smallBtnStyle('#4CAF50')}>
        Request from Opponent
      </button>
      <button onClick={onImportIpfs} style={smallBtnStyle('#9C27B0')}>
        Import by IPFS Hash
      </button>
      <button onClick={onSkip} style={smallBtnStyle('#666')}>
        Skip (placeholders)
      </button>
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// Shared styles
// ---------------------------------------------------------------------------

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  backgroundColor: 'rgba(0, 0, 0, 0.7)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
};

const dialogStyle: React.CSSProperties = {
  backgroundColor: '#16213e',
  border: '1px solid #3a3a5c',
  borderRadius: 12,
  padding: 24,
  maxWidth: 420,
  width: '90%',
};

const titleStyle: React.CSSProperties = {
  margin: '0 0 12px',
  fontSize: 16,
  color: '#e4e4e4',
};

const bodyStyle: React.CSSProperties = {
  margin: '0 0 16px',
  fontSize: 13,
  color: '#b0b0c0',
  lineHeight: 1.5,
};

const buttonRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
};

const baseBtnStyle: React.CSSProperties = {
  padding: '8px 16px',
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 600,
  color: '#fff',
};

const allowBtnStyle: React.CSSProperties = { ...baseBtnStyle, backgroundColor: '#4CAF50' };
const denyBtnStyle: React.CSSProperties = { ...baseBtnStyle, backgroundColor: '#666' };
const blockBtnStyle: React.CSSProperties = { ...baseBtnStyle, backgroundColor: '#f44336' };

const smallBtnStyle = (bg: string): React.CSSProperties => ({
  padding: '6px 12px',
  backgroundColor: bg,
  color: '#fff',
  border: 'none',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: 11,
});
