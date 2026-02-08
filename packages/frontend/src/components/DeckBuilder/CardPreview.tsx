/**
 * CardPreview — Full card detail modal/panel
 *
 * Shows a large card image with all metadata fields.
 */

import React from 'react';
import { useCardImage } from '../../hooks/useCardImage';
import type { EnrichedCard } from '../../deck/types';
import { StyledEffectText } from './StyledEffectText';

interface CardPreviewProps {
  card: EnrichedCard;
  packId: string | null;
  onClose: () => void;
  onAddToDeck?: (cardId: string) => void;
}

export const CardPreview: React.FC<CardPreviewProps> = ({
  card,
  packId,
  onClose,
  onAddToDeck,
}) => {
  const { url, isLoading } = useCardImage(packId, card.id, 'front');

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.8)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          display: 'flex',
          gap: 24,
          backgroundColor: '#1a1a2e',
          borderRadius: 12,
          padding: 24,
          maxWidth: 700,
          maxHeight: '90vh',
          overflow: 'auto',
          border: '1px solid #3a3a5c',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Card image */}
        <div style={{ flexShrink: 0, width: 250 }}>
          {isLoading ? (
            <div style={{
              width: 250,
              height: 350,
              backgroundColor: '#2a2a4a',
              borderRadius: 8,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#666',
            }}>
              Loading...
            </div>
          ) : url ? (
            <img
              src={url}
              alt={card.name}
              style={{ width: 250, borderRadius: 8 }}
            />
          ) : (
            <div style={{
              width: 250,
              height: 350,
              backgroundColor: '#2a2a4a',
              borderRadius: 8,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#666',
              fontSize: 12,
            }}>
              No Image
            </div>
          )}
        </div>

        {/* Card details */}
        <div style={{ flex: 1, color: '#e4e4e4' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
            <h2 style={{ margin: '0 0 8px', fontSize: 20 }}>{card.name}</h2>
            <button
              onClick={onClose}
              style={{
                background: 'none',
                border: 'none',
                color: '#888',
                fontSize: 20,
                cursor: 'pointer',
                padding: 4,
              }}
            >
              x
            </button>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            <Tag label={card.cardType} />
            {card.colors.map((c) => (
              <Tag key={c} label={c} color={colorToHex(c)} />
            ))}
            <Tag label={card.rarity} />
            <Tag label={card.set} />
          </div>

          <DetailRow label="ID" value={card.id} />
          {card.cost != null && <DetailRow label="Cost" value={String(card.cost)} />}
          {card.power != null && <DetailRow label="Power" value={String(card.power)} />}
          {card.counter != null && <DetailRow label="Counter" value={`+${card.counter}`} />}
          {card.life != null && <DetailRow label="Life" value={String(card.life)} />}
          {card.traits.length > 0 && (
            <DetailRow label="Traits" value={card.traits.join(', ')} />
          )}

          {card.effectText && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 11, color: '#8888aa', marginBottom: 4 }}>Effect</div>
              <div style={{
                fontSize: 13,
                lineHeight: 1.5,
                padding: 8,
                backgroundColor: '#16213e',
                borderRadius: 4,
                border: '1px solid #3a3a5c',
              }}>
                <StyledEffectText text={card.effectText} />
              </div>
            </div>
          )}

          {onAddToDeck && card.cardType !== 'leader' && (
            <button
              onClick={() => onAddToDeck(card.id)}
              style={{
                marginTop: 16,
                padding: '10px 20px',
                backgroundColor: '#4CAF50',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 14,
              }}
            >
              Add to Deck
            </button>
          )}

          {onAddToDeck && card.cardType === 'leader' && (
            <button
              onClick={() => onAddToDeck(card.id)}
              style={{
                marginTop: 16,
                padding: '10px 20px',
                backgroundColor: '#FF9800',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 14,
              }}
            >
              Set as Leader
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

const Tag: React.FC<{ label: string; color?: string }> = ({ label, color }) => (
  <span
    style={{
      padding: '2px 8px',
      backgroundColor: color ?? '#3a3a5c',
      borderRadius: 4,
      fontSize: 11,
      textTransform: 'capitalize',
      color: '#e4e4e4',
    }}
  >
    {label}
  </span>
);

const DetailRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div style={{ display: 'flex', gap: 8, fontSize: 13, marginBottom: 4 }}>
    <span style={{ color: '#8888aa', minWidth: 60 }}>{label}</span>
    <span>{value}</span>
  </div>
);

function colorToHex(color: string): string {
  const map: Record<string, string> = {
    red: '#c62828',
    green: '#2e7d32',
    blue: '#1565c0',
    purple: '#6a1b9a',
    black: '#424242',
    yellow: '#f9a825',
  };
  return map[color.toLowerCase()] ?? '#3a3a5c';
}
