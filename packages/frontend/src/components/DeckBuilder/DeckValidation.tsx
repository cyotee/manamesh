/**
 * DeckValidation — Validation status bar
 *
 * Shows a colored bar with validation status:
 * green (valid), yellow (incomplete), red (errors).
 * Errors are shown inline with affected card IDs.
 */

import React from 'react';
import type { UseDeckValidationResult } from '../../hooks/useDeckValidation';

interface DeckValidationProps {
  validation: UseDeckValidationResult;
}

const STATUS_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  valid: { bg: 'rgba(76, 175, 80, 0.15)', border: '#4CAF50', text: '#6fcf6f' },
  incomplete: { bg: 'rgba(255, 152, 0, 0.15)', border: '#FF9800', text: '#ffb74d' },
  error: { bg: 'rgba(244, 67, 54, 0.15)', border: '#f44336', text: '#ff6b6b' },
};

export const DeckValidation: React.FC<DeckValidationProps> = ({ validation }) => {
  const colors = STATUS_COLORS[validation.status];
  const statusLabel =
    validation.status === 'valid'
      ? 'Deck is tournament-legal'
      : validation.status === 'incomplete'
        ? 'Deck is incomplete'
        : `${validation.errors.length} validation error${validation.errors.length !== 1 ? 's' : ''}`;

  return (
    <div style={{
      padding: '8px 12px',
      backgroundColor: colors.bg,
      border: `1px solid ${colors.border}`,
      borderRadius: 6,
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        fontSize: 13,
        color: colors.text,
        fontWeight: 'bold',
      }}>
        <span>{statusLabel}</span>
        <span>{validation.totalCards}/50 cards | Leader: {validation.hasLeader ? 'Yes' : 'No'}</span>
      </div>

      {/* Error list */}
      {validation.errors.length > 0 && (
        <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {validation.errors.map((error, i) => (
            <div key={i} style={{ fontSize: 11, color: '#ff8a80' }}>
              {error.message}
            </div>
          ))}
        </div>
      )}

      {/* Warnings */}
      {validation.warnings.length > 0 && (
        <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {validation.warnings.map((warning, i) => (
            <div key={i} style={{ fontSize: 11, color: '#ffb74d' }}>
              {warning.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
