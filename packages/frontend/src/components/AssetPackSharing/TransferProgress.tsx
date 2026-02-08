/**
 * TransferProgress — Progress bar for P2P asset pack transfers
 *
 * Shows chunk progress, transfer size, and cancel button during
 * active P2P asset pack transfers.
 */

import React from 'react';
import type { TransferState } from '../../p2p/asset-sharing';

interface TransferProgressProps {
  transfer: TransferState;
  onCancel: () => void;
}

export const TransferProgress: React.FC<TransferProgressProps> = ({
  transfer,
  onCancel,
}) => {
  const { totalChunks, chunksCompleted, status, direction, mode } = transfer;
  const percent = totalChunks
    ? Math.round((chunksCompleted / totalChunks) * 100)
    : 0;

  const isActive = status === 'transferring';
  const isDone = status === 'complete';
  const isError = status === 'error';
  const isCancelled = status === 'cancelled';
  const isDenied = status === 'denied';
  const isPending = status === 'pending-consent' || status === 'pending-remote';

  const label = direction === 'sending' ? 'Sending' : 'Receiving';
  const modeLabel = mode === 'full-pack' ? 'full pack' : 'card images';

  let statusColor = '#ff9800'; // pending
  let statusText = `Waiting for ${direction === 'sending' ? 'your approval' : 'peer approval'}...`;

  if (isActive) {
    statusColor = '#2196F3';
    statusText = `${label} ${modeLabel}: ${percent}%`;
  } else if (isDone) {
    statusColor = '#4CAF50';
    statusText = 'Transfer complete';
  } else if (isError) {
    statusColor = '#f44336';
    statusText = 'Transfer failed';
  } else if (isCancelled) {
    statusColor = '#888';
    statusText = 'Transfer cancelled';
  } else if (isDenied) {
    statusColor = '#f44336';
    statusText = 'Request denied';
  }

  return (
    <div style={{
      padding: 10,
      backgroundColor: '#1a1a2e',
      border: `1px solid ${statusColor}33`,
      borderRadius: 8,
      marginBottom: 8,
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 6,
      }}>
        <span style={{ fontSize: 12, color: statusColor, fontWeight: 600 }}>
          {statusText}
        </span>
        {(isActive || isPending) && (
          <button
            onClick={onCancel}
            style={{
              background: 'none',
              border: '1px solid #666',
              color: '#888',
              cursor: 'pointer',
              fontSize: 10,
              padding: '2px 8px',
              borderRadius: 3,
            }}
          >
            Cancel
          </button>
        )}
      </div>

      {/* Progress bar */}
      {(isActive || isDone) && (
        <div style={{
          height: 4,
          backgroundColor: '#2a2a4a',
          borderRadius: 2,
          overflow: 'hidden',
        }}>
          <div style={{
            width: `${percent}%`,
            height: '100%',
            backgroundColor: statusColor,
            transition: 'width 200ms',
          }} />
        </div>
      )}

      {isActive && totalChunks && (
        <div style={{ fontSize: 10, color: '#666', marginTop: 4, textAlign: 'right' }}>
          {chunksCompleted}/{totalChunks} chunks
          {transfer.totalSize ? ` (${formatBytes(transfer.totalSize)})` : ''}
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Transfer list (shows all active transfers)
// ---------------------------------------------------------------------------

interface TransferListProps {
  transfers: TransferState[];
  onCancel: (packId: string) => void;
}

export const TransferList: React.FC<TransferListProps> = ({
  transfers,
  onCancel,
}) => {
  if (transfers.length === 0) return null;

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11, color: '#8888aa', marginBottom: 4, textTransform: 'uppercase' }}>
        Transfers
      </div>
      {transfers.map((t) => (
        <TransferProgress
          key={t.packId}
          transfer={t}
          onCancel={() => onCancel(t.packId)}
        />
      ))}
    </div>
  );
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
