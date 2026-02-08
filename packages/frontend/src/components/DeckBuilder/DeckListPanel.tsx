/**
 * DeckListPanel — Current deck list display
 *
 * Shows the leader card, deck cards grouped by type,
 * quantities, and running total.
 */

import React, { useMemo } from 'react';
import { useCardImage } from '../../hooks/useCardImage';
import type { EnrichedCard, DeckList } from '../../deck/types';

interface DeckListPanelProps {
  deck: DeckList;
  cardLookup: Map<string, EnrichedCard>;
  /** Maps cardId → packId for resolving card images across multiple packs */
  cardPackMap: Map<string, string>;
  onRemoveCard: (cardId: string) => void;
  onClearLeader: () => void;
  onNameChange: (name: string) => void;
}

export const DeckListPanel: React.FC<DeckListPanelProps> = ({
  deck,
  cardLookup,
  cardPackMap,
  onRemoveCard,
  onClearLeader,
  onNameChange,
}) => {
  const leader = deck.leaderId ? cardLookup.get(deck.leaderId) : null;
  const totalCards = Object.values(deck.cards).reduce((s, q) => s + q, 0);

  // Group cards by type
  const grouped = useMemo(() => {
    const groups: Record<string, { card: EnrichedCard; qty: number }[]> = {};

    for (const [cardId, qty] of Object.entries(deck.cards)) {
      const card = cardLookup.get(cardId);
      if (!card) continue;
      const type = card.cardType || 'unknown';
      if (!groups[type]) groups[type] = [];
      groups[type].push({ card, qty });
    }

    // Sort within each group by cost then name
    for (const group of Object.values(groups)) {
      group.sort((a, b) => (a.card.cost ?? 99) - (b.card.cost ?? 99) || a.card.name.localeCompare(b.card.name));
    }

    return groups;
  }, [deck.cards, cardLookup]);

  const typeOrder = ['character', 'event', 'stage', 'unknown'];

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      minWidth: 280,
      maxWidth: 320,
      height: '100%',
      overflow: 'hidden',
    }}>
      {/* Deck name */}
      <input
        type="text"
        value={deck.name}
        onChange={(e) => onNameChange(e.target.value)}
        style={{
          padding: '6px 10px',
          backgroundColor: '#16213e',
          border: '1px solid #3a3a5c',
          borderRadius: 6,
          color: '#e4e4e4',
          fontSize: 14,
          fontWeight: 'bold',
          outline: 'none',
        }}
      />

      {/* Card count */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        fontSize: 13,
        color: totalCards === 50 ? '#4CAF50' : totalCards > 50 ? '#f44336' : '#8888aa',
      }}>
        <span>Main Deck</span>
        <span style={{ fontWeight: 'bold' }}>{totalCards}/50</span>
      </div>

      {/* Leader */}
      <div style={{
        padding: 8,
        backgroundColor: '#16213e',
        borderRadius: 6,
        border: leader ? '1px solid #FF9800' : '1px dashed #3a3a5c',
      }}>
        {leader ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <LeaderThumb packId={cardPackMap.get(deck.leaderId) ?? null} cardId={deck.leaderId} />
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12, color: '#FF9800', fontWeight: 'bold' }}>Leader</div>
              <div style={{ fontSize: 13, color: '#e4e4e4' }}>{leader.name}</div>
              <div style={{ fontSize: 11, color: '#8888aa' }}>
                {leader.colors.join('/')} | Life: {leader.life ?? '?'}
              </div>
            </div>
            <button
              onClick={onClearLeader}
              style={{
                background: 'none',
                border: 'none',
                color: '#888',
                cursor: 'pointer',
                fontSize: 16,
              }}
            >
              x
            </button>
          </div>
        ) : (
          <div style={{ textAlign: 'center', color: '#555', fontSize: 12, padding: 8 }}>
            Click a leader card to set it
          </div>
        )}
      </div>

      {/* Deck cards grouped by type */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {typeOrder.map((type) => {
          const group = grouped[type];
          if (!group || group.length === 0) return null;
          const groupTotal = group.reduce((s, g) => s + g.qty, 0);

          return (
            <div key={type} style={{ marginBottom: 8 }}>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: 11,
                color: '#8888aa',
                textTransform: 'capitalize',
                padding: '4px 0',
                borderBottom: '1px solid #2a2a4a',
              }}>
                <span>{type}s</span>
                <span>{groupTotal}</span>
              </div>
              {group.map(({ card, qty }) => (
                <DeckCardRow
                  key={card.id}
                  card={card}
                  qty={qty}
                  onRemove={() => onRemoveCard(card.id)}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
};

// --- Sub-components ---

const DeckCardRow: React.FC<{
  card: EnrichedCard;
  qty: number;
  onRemove: () => void;
}> = ({ card, qty, onRemove }) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      padding: '4px 4px',
      fontSize: 12,
      color: '#e4e4e4',
      borderBottom: '1px solid rgba(58, 58, 92, 0.3)',
      cursor: 'pointer',
    }}
    onClick={onRemove}
    title="Click to remove one copy"
  >
    <span style={{
      fontSize: 11,
      color: '#888',
      minWidth: 16,
      textAlign: 'right',
    }}>
      {card.cost != null ? card.cost : '-'}
    </span>
    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
      {card.name}
    </span>
    <span style={{
      fontWeight: 'bold',
      color: qty >= 4 ? '#f44336' : '#8888aa',
      minWidth: 18,
      textAlign: 'center',
    }}>
      x{qty}
    </span>
  </div>
);

const LeaderThumb: React.FC<{ packId: string | null; cardId: string }> = ({ packId, cardId }) => {
  const { url } = useCardImage(packId, cardId, 'front');
  return url ? (
    <img src={url} alt="Leader" style={{ width: 40, height: 56, borderRadius: 4, objectFit: 'cover' }} />
  ) : (
    <div style={{ width: 40, height: 56, borderRadius: 4, backgroundColor: '#2a2a4a' }} />
  );
};
