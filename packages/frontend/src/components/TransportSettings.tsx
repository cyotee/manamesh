/**
 * TransportSettings Component
 *
 * Modal and inline settings for transport configuration.
 * Allows enabling/disabling transports, forcing modes, and debugging.
 */

import React, { useState } from 'react';
import type { TransportType } from '../p2p/transports/types';
import { TRANSPORT_NAMES, TRANSPORT_COLORS, TRANSPORT_PRIORITY } from '../p2p/transports/types';
import { useTransportConfig, generateTransportUrl } from '../hooks/useTransportConfig';

interface TransportSettingsProps {
  onClose?: () => void;
  inline?: boolean;
}

/**
 * Transport descriptions for the settings panel
 */
const TRANSPORT_DESCRIPTIONS: Record<TransportType, string> = {
  lan: 'Same local network (fastest, no internet needed)',
  directIp: 'Manual IP address for VPN or port-forwarded setups',
  relay: 'Decentralized relay via Protocol Labs nodes (no STUN)',
  joinCode: 'Copy/paste codes (uses Google STUN as fallback)',
};

/**
 * Full settings modal
 */
export const TransportSettingsModal: React.FC<TransportSettingsProps> = ({
  onClose,
}) => {
  const {
    config,
    transports,
    setTransportEnabled,
    setForcedTransport,
    setVerboseLogging,
    resetConfig,
    isForced,
  } = useTransportConfig();

  const [showShareUrl, setShowShareUrl] = useState(false);

  const modalStyle: React.CSSProperties = {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  };

  const contentStyle: React.CSSProperties = {
    backgroundColor: '#1f2937',
    borderRadius: '12px',
    padding: '24px',
    maxWidth: '500px',
    width: '90%',
    maxHeight: '80vh',
    overflow: 'auto',
    color: '#f3f4f6',
  };

  const headerStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '20px',
  };

  const sectionStyle: React.CSSProperties = {
    marginBottom: '24px',
  };

  const sectionTitleStyle: React.CSSProperties = {
    fontSize: '14px',
    fontWeight: 600,
    color: '#9ca3af',
    marginBottom: '12px',
    textTransform: 'uppercase',
    letterSpacing: '0.5px',
  };

  return (
    <div style={modalStyle} onClick={onClose}>
      <div style={contentStyle} onClick={e => e.stopPropagation()}>
        <div style={headerStyle}>
          <h2 style={{ margin: 0, fontSize: '20px' }}>Transport Settings</h2>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: '#9ca3af',
              fontSize: '24px',
              cursor: 'pointer',
              padding: '4px',
            }}
          >
            ×
          </button>
        </div>

        {/* Transport Toggles */}
        <div style={sectionStyle}>
          <div style={sectionTitleStyle}>Available Transports</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {transports.map(({ type, name, color, enabled, forced }) => (
              <div
                key={type}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '12px',
                  padding: '12px',
                  backgroundColor: enabled ? `${color}10` : '#374151',
                  borderRadius: '8px',
                  border: `1px solid ${enabled ? color : '#4b5563'}`,
                  opacity: config.forced && config.forced !== type ? 0.5 : 1,
                }}
              >
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={e => setTransportEnabled(type, e.target.checked)}
                  disabled={config.forced !== null && config.forced !== type}
                  style={{
                    width: '20px',
                    height: '20px',
                    accentColor: color,
                    marginTop: '2px',
                  }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontWeight: 500 }}>{name}</span>
                    {forced && (
                      <span
                        style={{
                          fontSize: '10px',
                          padding: '2px 6px',
                          backgroundColor: '#f59e0b',
                          color: '#000',
                          borderRadius: '4px',
                          fontWeight: 600,
                        }}
                      >
                        FORCED
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: '12px', color: '#9ca3af', marginTop: '4px' }}>
                    {TRANSPORT_DESCRIPTIONS[type]}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Force Transport */}
        <div style={sectionStyle}>
          <div style={sectionTitleStyle}>Force Transport (Testing)</div>
          <select
            value={config.forced ?? ''}
            onChange={e => setForcedTransport(e.target.value as TransportType || null)}
            style={{
              width: '100%',
              padding: '10px 12px',
              backgroundColor: '#374151',
              border: '1px solid #4b5563',
              borderRadius: '6px',
              color: '#f3f4f6',
              fontSize: '14px',
            }}
          >
            <option value="">Auto (try all enabled)</option>
            {TRANSPORT_PRIORITY.map(type => (
              <option key={type} value={type}>
                Force: {TRANSPORT_NAMES[type]} only
              </option>
            ))}
          </select>
          {isForced && (
            <div
              style={{
                marginTop: '8px',
                padding: '8px 12px',
                backgroundColor: '#f59e0b20',
                border: '1px solid #f59e0b',
                borderRadius: '6px',
                fontSize: '12px',
                color: '#f59e0b',
              }}
            >
              ⚠️ Force mode active - only {TRANSPORT_NAMES[config.forced!]} will be attempted
            </div>
          )}
        </div>

        {/* Debug Options */}
        <div style={sectionStyle}>
          <div style={sectionTitleStyle}>Debug Options</div>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={config.verboseLogging}
              onChange={e => setVerboseLogging(e.target.checked)}
              style={{ width: '18px', height: '18px' }}
            />
            <span>Enable verbose logging (console)</span>
          </label>
        </div>

        {/* Share URL */}
        <div style={sectionStyle}>
          <div style={sectionTitleStyle}>Share Configuration</div>
          <button
            onClick={() => setShowShareUrl(!showShareUrl)}
            style={{
              padding: '10px 16px',
              backgroundColor: '#374151',
              border: '1px solid #4b5563',
              borderRadius: '6px',
              color: '#f3f4f6',
              cursor: 'pointer',
              width: '100%',
              textAlign: 'left',
            }}
          >
            {showShareUrl ? 'Hide URL' : 'Generate shareable URL'}
          </button>
          {showShareUrl && (
            <div style={{ marginTop: '8px' }}>
              <input
                type="text"
                readOnly
                value={generateTransportUrl(config)}
                onClick={e => (e.target as HTMLInputElement).select()}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  backgroundColor: '#111827',
                  border: '1px solid #374151',
                  borderRadius: '6px',
                  color: '#9ca3af',
                  fontSize: '12px',
                  fontFamily: 'monospace',
                }}
              />
              <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '4px' }}>
                Share this URL to apply the same transport settings
              </div>
            </div>
          )}
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: '12px' }}>
          <button
            onClick={resetConfig}
            style={{
              flex: 1,
              padding: '10px 16px',
              backgroundColor: '#374151',
              border: '1px solid #4b5563',
              borderRadius: '6px',
              color: '#f3f4f6',
              cursor: 'pointer',
            }}
          >
            Reset to Defaults
          </button>
          <button
            onClick={onClose}
            style={{
              flex: 1,
              padding: '10px 16px',
              backgroundColor: '#3b82f6',
              border: 'none',
              borderRadius: '6px',
              color: '#fff',
              cursor: 'pointer',
              fontWeight: 500,
            }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

/**
 * Inline transport toggles for the lobby
 */
export const TransportToggles: React.FC<{
  compact?: boolean;
  onSettingsClick?: () => void;
}> = ({ compact = false, onSettingsClick }) => {
  const { transports, setTransportEnabled, config } = useTransportConfig();

  if (compact) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        {transports.map(({ type, name, color, enabled }) => (
          <button
            key={type}
            onClick={() => setTransportEnabled(type, !enabled)}
            title={`${name}: ${enabled ? 'Enabled' : 'Disabled'}`}
            style={{
              width: '28px',
              height: '28px',
              borderRadius: '6px',
              border: `2px solid ${enabled ? color : '#4b5563'}`,
              backgroundColor: enabled ? `${color}20` : 'transparent',
              color: enabled ? color : '#6b7280',
              cursor: 'pointer',
              fontSize: '12px',
              fontWeight: 600,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {type[0].toUpperCase()}
          </button>
        ))}
        {onSettingsClick && (
          <button
            onClick={onSettingsClick}
            title="Transport Settings"
            style={{
              width: '28px',
              height: '28px',
              borderRadius: '6px',
              border: '1px solid #4b5563',
              backgroundColor: 'transparent',
              color: '#9ca3af',
              cursor: 'pointer',
              fontSize: '14px',
            }}
          >
            ⚙
          </button>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <div style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '4px' }}>
        Transports
      </div>
      {transports.map(({ type, name, color, enabled }) => (
        <label
          key={type}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            cursor: 'pointer',
            opacity: config.forced && config.forced !== type ? 0.5 : 1,
          }}
        >
          <input
            type="checkbox"
            checked={enabled}
            onChange={e => setTransportEnabled(type, e.target.checked)}
            disabled={config.forced !== null && config.forced !== type}
            style={{ accentColor: color }}
          />
          <span
            style={{
              fontSize: '13px',
              color: enabled ? '#f3f4f6' : '#6b7280',
            }}
          >
            {name}
          </span>
        </label>
      ))}
    </div>
  );
};

export default TransportSettingsModal;
