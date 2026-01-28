/**
 * TransportBadge Component
 *
 * Visual indicator showing current transport status.
 * Color-coded by transport type with hover details.
 */

import React, { useState } from 'react';
import type { TransportStatus, TransportType } from '../p2p/transports/types';
import { TRANSPORT_NAMES, TRANSPORT_COLORS } from '../p2p/transports/types';

interface TransportBadgeProps {
  status: TransportStatus;
  onClick?: () => void;
  className?: string;
}

/**
 * Get badge label based on status
 */
function getBadgeLabel(status: TransportStatus): string {
  switch (status.state) {
    case 'idle':
      return 'Not Connected';
    case 'connecting':
      return `Connecting (${TRANSPORT_NAMES[status.transport]})...`;
    case 'connected':
      return TRANSPORT_NAMES[status.transport];
    case 'failed':
      return 'Connection Failed';
    case 'disconnected':
      return 'Disconnected';
    default:
      return 'Unknown';
  }
}

/**
 * Get badge color based on status
 */
function getBadgeColor(status: TransportStatus): string {
  switch (status.state) {
    case 'idle':
      return '#6b7280'; // gray
    case 'connecting':
      return status.transport ? TRANSPORT_COLORS[status.transport] : '#fbbf24'; // amber
    case 'connected':
      return TRANSPORT_COLORS[status.transport];
    case 'failed':
      return '#ef4444'; // red
    case 'disconnected':
      return '#6b7280'; // gray
    default:
      return '#6b7280';
  }
}

/**
 * Get status icon
 */
function getStatusIcon(status: TransportStatus): string {
  switch (status.state) {
    case 'idle':
      return '○';
    case 'connecting':
      return '◐';
    case 'connected':
      return '●';
    case 'failed':
      return '✕';
    case 'disconnected':
      return '○';
    default:
      return '?';
  }
}

export const TransportBadge: React.FC<TransportBadgeProps> = ({
  status,
  onClick,
  className = '',
}) => {
  const [showTooltip, setShowTooltip] = useState(false);

  const color = getBadgeColor(status);
  const label = getBadgeLabel(status);
  const icon = getStatusIcon(status);

  const badgeStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '4px 10px',
    borderRadius: '9999px',
    backgroundColor: `${color}20`,
    border: `1px solid ${color}`,
    color: color,
    fontSize: '12px',
    fontWeight: 500,
    cursor: onClick ? 'pointer' : 'default',
    position: 'relative',
    transition: 'all 0.2s',
  };

  const tooltipStyle: React.CSSProperties = {
    position: 'absolute',
    bottom: '100%',
    left: '50%',
    transform: 'translateX(-50%)',
    marginBottom: '8px',
    padding: '8px 12px',
    backgroundColor: '#1f2937',
    color: '#f3f4f6',
    borderRadius: '6px',
    fontSize: '11px',
    whiteSpace: 'nowrap',
    zIndex: 1000,
    boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
  };

  const getTooltipContent = () => {
    switch (status.state) {
      case 'connecting':
        return (
          <div>
            <div>Attempting: {TRANSPORT_NAMES[status.transport]}</div>
            <div style={{ opacity: 0.7 }}>Attempt #{status.attempt}</div>
          </div>
        );
      case 'connected':
        return (
          <div>
            <div>Connected via {TRANSPORT_NAMES[status.transport]}</div>
            {status.latency && (
              <div style={{ opacity: 0.7 }}>Latency: {status.latency}ms</div>
            )}
          </div>
        );
      case 'failed':
        return (
          <div>
            <div>Failed: {status.error}</div>
            <div style={{ opacity: 0.7 }}>
              Last attempt: {TRANSPORT_NAMES[status.lastAttempt]}
            </div>
          </div>
        );
      default:
        return <div>{label}</div>;
    }
  };

  return (
    <div
      className={`transport-badge ${className}`}
      style={badgeStyle}
      onClick={onClick}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <span
        style={{
          animation: status.state === 'connecting' ? 'pulse 1s infinite' : 'none',
        }}
      >
        {icon}
      </span>
      <span>{label}</span>

      {showTooltip && (
        <div style={tooltipStyle}>
          {getTooltipContent()}
        </div>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  );
};

/**
 * Mini badge for compact displays
 */
export const TransportBadgeMini: React.FC<{
  status: TransportStatus;
  onClick?: () => void;
}> = ({ status, onClick }) => {
  const color = getBadgeColor(status);
  const icon = getStatusIcon(status);

  return (
    <span
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '20px',
        height: '20px',
        borderRadius: '50%',
        backgroundColor: `${color}20`,
        border: `1px solid ${color}`,
        color: color,
        fontSize: '10px',
        cursor: onClick ? 'pointer' : 'default',
      }}
      title={getBadgeLabel(status)}
    >
      {icon}
    </span>
  );
};

export default TransportBadge;
