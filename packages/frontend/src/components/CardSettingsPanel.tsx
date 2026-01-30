/**
 * Card Settings Panel Component
 *
 * UI for configuring card rendering preferences:
 * - Toggle between HTML text and IPFS images
 * - Custom CID input for asset packs
 * - Reset to default button
 */

import React, { useState } from 'react';
import {
  useCardSettings,
  getDefaultCid,
  type CardRenderMode,
} from '../hooks/useCardSettings';

export interface CardSettingsPanelProps {
  /** Whether the panel is expanded */
  expanded?: boolean;
  /** Callback when settings change */
  onSettingsChange?: () => void;
}

export const CardSettingsPanel: React.FC<CardSettingsPanelProps> = ({
  expanded: initialExpanded = false,
  onSettingsChange,
}) => {
  const {
    settings,
    useImages,
    setRenderMode,
    setCustomCid,
    resetCidToDefault,
    isDefaultCid,
  } = useCardSettings();

  const [isExpanded, setIsExpanded] = useState(initialExpanded);
  const [cidInput, setCidInput] = useState(settings.customCid);

  const handleRenderModeChange = (mode: CardRenderMode) => {
    setRenderMode(mode);
    onSettingsChange?.();
  };

  const handleCidChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setCidInput(e.target.value);
  };

  const handleCidBlur = () => {
    if (cidInput.trim()) {
      setCustomCid(cidInput.trim());
      onSettingsChange?.();
    }
  };

  const handleCidKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleCidBlur();
    }
  };

  const handleResetCid = () => {
    resetCidToDefault();
    setCidInput(getDefaultCid());
    onSettingsChange?.();
  };

  return (
    <div
      style={{
        backgroundColor: '#1e293b',
        borderRadius: '8px',
        border: '1px solid #334155',
        overflow: 'hidden',
        marginBottom: '16px',
      }}
    >
      {/* Header - always visible */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        style={{
          width: '100%',
          padding: '12px 16px',
          backgroundColor: 'transparent',
          border: 'none',
          color: '#e2e8f0',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          fontSize: '14px',
          fontWeight: 500,
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: '16px' }}>🎴</span>
          Card Settings
        </span>
        <span
          style={{
            transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s',
          }}
        >
          ▼
        </span>
      </button>

      {/* Expandable content */}
      {isExpanded && (
        <div
          style={{
            padding: '16px',
            borderTop: '1px solid #334155',
          }}
        >
          {/* Render Mode Toggle */}
          <div style={{ marginBottom: '16px' }}>
            <label
              style={{
                display: 'block',
                color: '#94a3b8',
                fontSize: '12px',
                marginBottom: '8px',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              Card Rendering
            </label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={() => handleRenderModeChange('html')}
                style={{
                  flex: 1,
                  padding: '10px 16px',
                  backgroundColor: !useImages ? '#3b82f6' : '#374151',
                  color: !useImages ? '#fff' : '#9ca3af',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '13px',
                  fontWeight: 500,
                  transition: 'background-color 0.2s',
                }}
              >
                HTML Text
              </button>
              <button
                onClick={() => handleRenderModeChange('ipfs')}
                style={{
                  flex: 1,
                  padding: '10px 16px',
                  backgroundColor: useImages ? '#3b82f6' : '#374151',
                  color: useImages ? '#fff' : '#9ca3af',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  fontSize: '13px',
                  fontWeight: 500,
                  transition: 'background-color 0.2s',
                }}
              >
                IPFS Images
              </button>
            </div>
          </div>

          {/* CID Input - only shown when IPFS mode is active */}
          {useImages && (
            <div>
              <label
                style={{
                  display: 'block',
                  color: '#94a3b8',
                  fontSize: '12px',
                  marginBottom: '8px',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}
              >
                Asset Pack CID
              </label>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="text"
                  value={cidInput}
                  onChange={handleCidChange}
                  onBlur={handleCidBlur}
                  onKeyDown={handleCidKeyDown}
                  placeholder="Enter IPFS CID..."
                  style={{
                    flex: 1,
                    padding: '10px 12px',
                    backgroundColor: '#0f172a',
                    border: '1px solid #334155',
                    borderRadius: '6px',
                    color: '#e2e8f0',
                    fontSize: '13px',
                    fontFamily: 'monospace',
                  }}
                />
                <button
                  onClick={handleResetCid}
                  disabled={isDefaultCid}
                  title="Reset to default CID"
                  style={{
                    padding: '10px 14px',
                    backgroundColor: isDefaultCid ? '#1f2937' : '#374151',
                    color: isDefaultCid ? '#4b5563' : '#e2e8f0',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: isDefaultCid ? 'not-allowed' : 'pointer',
                    fontSize: '13px',
                    whiteSpace: 'nowrap',
                  }}
                >
                  Reset
                </button>
              </div>
              {!isDefaultCid && (
                <p
                  style={{
                    marginTop: '8px',
                    fontSize: '11px',
                    color: '#f59e0b',
                  }}
                >
                  Using custom CID. Click Reset to use default pack.
                </p>
              )}
              <p
                style={{
                  marginTop: '8px',
                  fontSize: '11px',
                  color: '#64748b',
                }}
              >
                Default: {getDefaultCid().slice(0, 20)}...
              </p>
            </div>
          )}

          {/* Info text */}
          <div
            style={{
              marginTop: '16px',
              padding: '12px',
              backgroundColor: '#0f172a',
              borderRadius: '6px',
              fontSize: '12px',
              color: '#64748b',
            }}
          >
            {useImages ? (
              <>
                <strong style={{ color: '#94a3b8' }}>IPFS Images:</strong> Card
                images are loaded from IPFS and cached locally for offline play.
                First load may take a moment.
              </>
            ) : (
              <>
                <strong style={{ color: '#94a3b8' }}>HTML Text:</strong> Cards
                are rendered using text and CSS. Faster loading, works offline
                immediately.
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
