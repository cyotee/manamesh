/**
 * DeckManager — Saved decks list
 *
 * Shows all saved decks with leader preview, card count,
 * and last modified date. Supports load, duplicate, and delete.
 */

import React from 'react';
import type { DeckList, EnrichedCard } from '../../deck/types';

interface DeckManagerProps {
  decks: DeckList[];
  currentDeckId: string;
  cardLookup: Map<string, EnrichedCard>;
  onLoadDeck: (deck: DeckList) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onNewDeck: () => void;
}

export const DeckManager: React.FC<DeckManagerProps> = ({
  decks,
  currentDeckId,
  cardLookup,
  onLoadDeck,
  onDuplicate,
  onDelete,
  onNewDeck,
}) => {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
      }}>
        <h3 style={{ margin: 0, color: '#e4e4e4', fontSize: 14 }}>Saved Decks</h3>
        <button
          onClick={onNewDeck}
          style={{
            padding: '4px 12px',
            backgroundColor: '#4CAF50',
            color: '#fff',
            border: 'none',
            borderRadius: 4,
            cursor: 'pointer',
            fontSize: 12,
          }}
        >
          + New Deck
        </button>
      </div>

      {decks.length === 0 ? (
        <div style={{ padding: 16, color: '#555', fontSize: 12, textAlign: 'center' }}>
          No saved decks yet
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {decks.map((deck) => {
            const leader = deck.leaderId ? cardLookup.get(deck.leaderId) : null;
            const totalCards = Object.values(deck.cards).reduce((s, q) => s + q, 0);
            const isCurrent = deck.id === currentDeckId;

            return (
              <div
                key={deck.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 10px',
                  backgroundColor: isCurrent ? '#2a2a5a' : '#1a1a2e',
                  borderRadius: 6,
                  border: isCurrent ? '1px solid #4a4a7a' : '1px solid #2a2a4a',
                  cursor: 'pointer',
                }}
                onClick={() => onLoadDeck(deck)}
              >
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, color: '#e4e4e4', fontWeight: isCurrent ? 'bold' : 'normal' }}>
                    {deck.name}
                  </div>
                  <div style={{ fontSize: 11, color: '#8888aa' }}>
                    {leader ? leader.name : 'No leader'}
                    {' | '}
                    {totalCards}/50 cards
                    {' | '}
                    {new Date(deck.updatedAt).toLocaleDateString()}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  <SmallButton
                    label="Dup"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDuplicate(deck.id);
                    }}
                  />
                  <SmallButton
                    label="Del"
                    color="#f44336"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(deck.id);
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

const SmallButton: React.FC<{
  label: string;
  color?: string;
  onClick: (e: React.MouseEvent) => void;
}> = ({ label, color = '#3a3a5c', onClick }) => (
  <button
    onClick={onClick}
    style={{
      padding: '2px 8px',
      backgroundColor: color,
      color: '#e4e4e4',
      border: 'none',
      borderRadius: 3,
      cursor: 'pointer',
      fontSize: 10,
    }}
  >
    {label}
  </button>
);
