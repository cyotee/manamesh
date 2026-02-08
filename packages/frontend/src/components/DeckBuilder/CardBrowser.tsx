/**
 * CardBrowser — Card grid with lazy image loading, filtering, and hover preview
 *
 * Displays cards from loaded asset packs in a responsive grid.
 * Hovering a card shows a large preview pane on the right.
 * Clicking adds to deck (or sets leader for leader cards).
 * Right-clicking opens the full detail modal.
 */

import React, { useState, useMemo, useCallback } from 'react';
import { useCardImage } from '../../hooks/useCardImage';
import type { EnrichedCard, CardFilters as CardFiltersType } from '../../deck/types';
import { DEFAULT_FILTERS } from '../../deck/types';
import { CardFilters } from './CardFilters';
import { CardPreview } from './CardPreview';
import { StyledEffectText } from './StyledEffectText';

interface CardBrowserProps {
  cards: EnrichedCard[];
  /** Maps cardId → packId so each tile resolves its own pack for image loading */
  cardPackMap: Map<string, string>;
  onAddCard: (cardId: string, card: EnrichedCard) => string | null;
  onSetLeader: (cardId: string, card: EnrichedCard) => void;
  /** Current deck card quantities for showing count badges */
  deckCards: Record<string, number>;
  /** Currently set leader ID */
  leaderId: string;
}

type GridSize = 'small' | 'medium' | 'large';

const GRID_SIZES: Record<GridSize, { cols: string }> = {
  small: { cols: 'repeat(auto-fill, minmax(100px, 1fr))' },
  medium: { cols: 'repeat(auto-fill, minmax(150px, 1fr))' },
  large: { cols: 'repeat(auto-fill, minmax(200px, 1fr))' },
};

export const CardBrowser: React.FC<CardBrowserProps> = ({
  cards,
  cardPackMap,
  onAddCard,
  onSetLeader,
  deckCards,
  leaderId,
}) => {
  const [filters, setFilters] = useState<CardFiltersType>(DEFAULT_FILTERS);
  const [gridSize, setGridSize] = useState<GridSize>('medium');
  const [previewCard, setPreviewCard] = useState<EnrichedCard | null>(null);
  const [hoveredCard, setHoveredCard] = useState<EnrichedCard | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Extract available filter options from card data
  const availableColors = useMemo(
    () => [...new Set(cards.flatMap((c) => c.colors))].sort(),
    [cards],
  );
  const availableTypes = useMemo(
    () => [...new Set(cards.map((c) => c.cardType))].sort(),
    [cards],
  );
  const availableSets = useMemo(
    () => [...new Set(cards.map((c) => c.set))].sort(),
    [cards],
  );
  const availableRarities = useMemo(
    () => [...new Set(cards.map((c) => c.rarity))].sort(),
    [cards],
  );

  // Apply filters
  const filteredCards = useMemo(() => {
    let result = cards;

    // Text search
    if (filters.search) {
      const q = filters.search.toLowerCase();
      result = result.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.effectText.toLowerCase().includes(q) ||
          c.id.toLowerCase().includes(q),
      );
    }

    // Color filter
    if (filters.colors.length > 0) {
      result = result.filter((c) =>
        c.colors.some((color) => filters.colors.includes(color)),
      );
    }

    // Type filter
    if (filters.cardTypes.length > 0) {
      result = result.filter((c) => filters.cardTypes.includes(c.cardType));
    }

    // Cost range
    if (filters.costMin != null) {
      result = result.filter((c) => c.cost != null && c.cost >= filters.costMin!);
    }
    if (filters.costMax != null) {
      result = result.filter((c) => c.cost != null && c.cost <= filters.costMax!);
    }

    // Power range
    if (filters.powerMin != null) {
      result = result.filter((c) => c.power != null && c.power >= filters.powerMin!);
    }
    if (filters.powerMax != null) {
      result = result.filter((c) => c.power != null && c.power <= filters.powerMax!);
    }

    // Set filter
    if (filters.sets.length > 0) {
      result = result.filter((c) => filters.sets.includes(c.set));
    }

    // Rarity filter
    if (filters.rarities.length > 0) {
      result = result.filter((c) => filters.rarities.includes(c.rarity));
    }

    // Sort
    result = [...result].sort((a, b) => {
      let cmp = 0;
      switch (filters.sortBy) {
        case 'name':
          cmp = a.name.localeCompare(b.name);
          break;
        case 'cost':
          cmp = (a.cost ?? 99) - (b.cost ?? 99);
          break;
        case 'power':
          cmp = (a.power ?? 0) - (b.power ?? 0);
          break;
        case 'color':
          cmp = (a.colors[0] ?? '').localeCompare(b.colors[0] ?? '');
          break;
        case 'set':
          cmp = a.set.localeCompare(b.set);
          break;
        case 'rarity':
          cmp = rarityOrder(a.rarity) - rarityOrder(b.rarity);
          break;
      }
      return filters.sortDir === 'asc' ? cmp : -cmp;
    });

    return result;
  }, [cards, filters]);

  const handleFiltersChange = useCallback((newFilters: CardFiltersType) => {
    setFilters(newFilters);
  }, []);

  const handleCardClick = useCallback(
    (card: EnrichedCard) => {
      if (card.cardType === 'leader') {
        onSetLeader(card.id, card);
        showToast(`Set ${card.name} as leader`);
      } else {
        const err = onAddCard(card.id, card);
        if (err) {
          showToast(err);
        } else {
          showToast(`Added ${card.name}`);
        }
      }
    },
    [onAddCard, onSetLeader],
  );

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  };

  const grid = GRID_SIZES[gridSize];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1, minHeight: 0, overflow: 'hidden' }}>
      {/* Filters */}
      <CardFilters
        filters={filters}
        onChange={handleFiltersChange}
        availableColors={availableColors}
        availableTypes={availableTypes}
        availableSets={availableSets}
        availableRarities={availableRarities}
      />

      {/* Toolbar */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        fontSize: 12,
        color: '#8888aa',
      }}>
        <span>{filteredCards.length} cards</span>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['small', 'medium', 'large'] as GridSize[]).map((size) => (
            <button
              key={size}
              onClick={() => setGridSize(size)}
              style={{
                padding: '3px 8px',
                fontSize: 11,
                backgroundColor: gridSize === size ? '#4a4a7a' : '#2a2a4a',
                color: '#e4e4e4',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer',
                textTransform: 'capitalize',
              }}
            >
              {size}
            </button>
          ))}
        </div>
      </div>

      {/* Grid + hover preview row */}
      <div style={{ display: 'flex', flex: 1, minHeight: 0, gap: 8 }}>
        {/* Scroll wrapper — takes flex height, scrolls the grid inside */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: 'auto',
            overflowX: 'hidden',
          }}
          onMouseLeave={() => setHoveredCard(null)}
        >
          {/* Card grid — natural height, not constrained */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: grid.cols,
              gap: 8,
              padding: 2,
            }}
          >
            {filteredCards.map((card) => (
              <CardTile
                key={card.id}
                card={card}
                packId={cardPackMap.get(card.id) ?? null}
                qty={deckCards[card.id] ?? 0}
                isLeader={card.id === leaderId}
                onClick={() => handleCardClick(card)}
                onRightClick={() => setPreviewCard(card)}
                onHover={() => setHoveredCard(card)}
              />
            ))}
          </div>
        </div>

        {/* Hover preview pane — sticky on the right */}
        <HoverPreviewPane
          card={hoveredCard}
          packId={hoveredCard ? (cardPackMap.get(hoveredCard.id) ?? null) : null}
        />
      </div>

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed',
          bottom: 24,
          left: '50%',
          transform: 'translateX(-50%)',
          padding: '8px 16px',
          backgroundColor: '#333',
          color: '#e4e4e4',
          borderRadius: 6,
          fontSize: 13,
          zIndex: 1001,
          boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
        }}>
          {toast}
        </div>
      )}

      {/* Detail modal (right-click) */}
      {previewCard && (
        <CardPreview
          card={previewCard}
          packId={cardPackMap.get(previewCard.id) ?? null}
          onClose={() => setPreviewCard(null)}
          onAddToDeck={(cardId) => {
            const card = cards.find((c) => c.id === cardId);
            if (card) handleCardClick(card);
          }}
        />
      )}
    </div>
  );
};

// --- Hover preview pane ---

const HoverPreviewPane: React.FC<{
  card: EnrichedCard | null;
  packId: string | null;
}> = ({ card, packId }) => {
  const { url } = useCardImage(packId, card?.id ?? null, 'front');

  return (
    <div style={{
      width: 400,
      flexShrink: 0,
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      alignItems: 'center',
      padding: 4,
      overflowY: 'auto',
    }}>
      {card && url ? (
        <>
          <img
            src={url}
            alt={card.name}
            style={{
              width: '100%',
              borderRadius: 8,
              objectFit: 'contain',
            }}
          />
          <div style={{ width: '100%', fontSize: 24, color: '#e4e4e4' }}>
            <div style={{ fontWeight: 'bold', fontSize: 28, marginBottom: 4 }}>{card.name}</div>
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6 }}>
              <MiniTag label={card.cardType} />
              {card.colors.map((c) => <MiniTag key={c} label={c} color={colorToHex(c)} />)}
              <MiniTag label={card.rarity} />
              <MiniTag label={card.set} />
            </div>
            {card.cost != null && <InfoLine label="Cost" value={String(card.cost)} />}
            {card.power != null && <InfoLine label="Power" value={String(card.power)} />}
            {card.counter != null && <InfoLine label="Counter" value={`+${card.counter}`} />}
            {card.life != null && <InfoLine label="Life" value={String(card.life)} />}
            {card.traits.length > 0 && <InfoLine label="Traits" value={card.traits.join(', ')} />}
            {card.effectText && (
              <div style={{
                marginTop: 10,
                padding: 10,
                backgroundColor: '#16213e',
                borderRadius: 6,
                border: '1px solid #3a3a5c',
                fontSize: 22,
                lineHeight: 1.4,
                color: '#ccc',
              }}>
                <StyledEffectText text={card.effectText} />
              </div>
            )}
          </div>
        </>
      ) : card ? (
        <div style={{
          width: '100%',
          height: 560,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#1a1a2e',
          borderRadius: 8,
          border: '1px solid #3a3a5c',
          color: '#555',
          fontSize: 12,
        }}>
          Loading...
        </div>
      ) : (
        <div style={{
          width: '100%',
          height: 560,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#1a1a2e',
          borderRadius: 8,
          border: '1px dashed #2a2a4a',
          color: '#444',
          fontSize: 12,
          textAlign: 'center',
          padding: 16,
        }}>
          Hover over a card to preview
        </div>
      )}
    </div>
  );
};

const MiniTag: React.FC<{ label: string; color?: string }> = ({ label, color }) => (
  <span style={{
    padding: '2px 10px',
    backgroundColor: color ?? '#3a3a5c',
    borderRadius: 5,
    fontSize: 20,
    textTransform: 'capitalize',
    color: '#e4e4e4',
  }}>
    {label}
  </span>
);

const InfoLine: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div style={{ display: 'flex', gap: 10, fontSize: 22, marginBottom: 4 }}>
    <span style={{ color: '#8888aa', minWidth: 80 }}>{label}</span>
    <span style={{ color: '#ccc' }}>{value}</span>
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

// --- CardTile sub-component ---

const CardTile: React.FC<{
  card: EnrichedCard;
  packId: string | null;
  qty: number;
  isLeader: boolean;
  onClick: () => void;
  onRightClick: () => void;
  onHover: () => void;
}> = ({ card, packId, qty, isLeader, onClick, onRightClick, onHover }) => {
  const { url, isLoading } = useCardImage(packId, card.id, 'front');

  return (
    <div
      style={{
        position: 'relative',
        cursor: 'pointer',
        borderRadius: 6,
        overflow: 'hidden',
        border: isLeader
          ? '2px solid #FF9800'
          : qty > 0
            ? '2px solid #4CAF50'
            : '1px solid #3a3a5c',
        backgroundColor: '#1a1a2e',
        transition: 'transform 100ms',
        // Fixed aspect ratio so the grid can size rows before images load
        aspectRatio: '5 / 7',
      }}
      onClick={onClick}
      onMouseEnter={onHover}
      onContextMenu={(e) => {
        e.preventDefault();
        onRightClick();
      }}
    >
      {isLoading ? (
        <div style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#555',
          fontSize: 11,
        }}>
          ...
        </div>
      ) : url ? (
        <img
          src={url}
          alt={card.name}
          style={{
            display: 'block',
            width: '100%',
            height: '100%',
            objectFit: 'contain',
          }}
          loading="lazy"
        />
      ) : (
        <div style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 8,
          color: '#666',
          fontSize: 10,
          textAlign: 'center',
        }}>
          <div style={{ fontWeight: 'bold' }}>{card.name}</div>
          <div>{card.id}</div>
        </div>
      )}

      {/* Quantity badge */}
      {qty > 0 && (
        <div style={{
          position: 'absolute',
          top: 4,
          right: 4,
          backgroundColor: '#4CAF50',
          color: '#fff',
          borderRadius: '50%',
          width: 20,
          height: 20,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 11,
          fontWeight: 'bold',
        }}>
          {qty}
        </div>
      )}

      {/* Leader badge */}
      {isLeader && (
        <div style={{
          position: 'absolute',
          top: 4,
          left: 4,
          backgroundColor: '#FF9800',
          color: '#fff',
          borderRadius: 4,
          padding: '1px 6px',
          fontSize: 9,
          fontWeight: 'bold',
        }}>
          LEADER
        </div>
      )}

      {/* Card name overlay */}
      <div style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        padding: '4px 6px',
        background: 'linear-gradient(transparent, rgba(0,0,0,0.8))',
        fontSize: 10,
        color: '#e4e4e4',
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}>
        {card.name}
      </div>
    </div>
  );
};

function rarityOrder(r: string): number {
  const order: Record<string, number> = {
    C: 0, UC: 1, R: 2, SR: 3, SEC: 4, L: 5, SP: 6,
  };
  return order[r.toUpperCase()] ?? 99;
}
