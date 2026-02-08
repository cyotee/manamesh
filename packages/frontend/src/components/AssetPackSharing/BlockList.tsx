/**
 * BlockList — UI for managing blocked peers
 *
 * Shows list of blocked peers with unblock buttons.
 * Visible in the lobby/matchmaking area.
 */

import React from 'react';

interface BlockListProps {
  blockedPeers: string[];
  onUnblock: (peerId: string) => void;
}

export const BlockList: React.FC<BlockListProps> = ({
  blockedPeers,
  onUnblock,
}) => {
  if (blockedPeers.length === 0) return null;

  return (
    <div style={{
      padding: 10,
      backgroundColor: '#1a1a2e',
      border: '1px solid #f4433633',
      borderRadius: 8,
      marginBottom: 12,
    }}>
      <div style={{
        fontSize: 11,
        color: '#f44336',
        marginBottom: 6,
        textTransform: 'uppercase',
        fontWeight: 600,
      }}>
        Blocked Players ({blockedPeers.length})
      </div>
      {blockedPeers.map((peerId) => (
        <div
          key={peerId}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '4px 8px',
            backgroundColor: '#2a1a1a',
            borderRadius: 4,
            marginBottom: 4,
            fontSize: 11,
          }}
        >
          <span style={{ color: '#b0b0c0', fontFamily: 'monospace' }}>
            {peerId.length > 16
              ? `${peerId.slice(0, 8)}...${peerId.slice(-6)}`
              : peerId}
          </span>
          <button
            onClick={() => onUnblock(peerId)}
            style={{
              background: 'none',
              border: '1px solid #666',
              color: '#888',
              cursor: 'pointer',
              fontSize: 10,
              padding: '1px 8px',
              borderRadius: 3,
            }}
          >
            Unblock
          </button>
        </div>
      ))}
    </div>
  );
};
