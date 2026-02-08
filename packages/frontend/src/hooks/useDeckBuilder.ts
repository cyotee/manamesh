/**
 * useDeckBuilder Hook
 *
 * Central state management for deck construction.
 * Handles add/remove cards, set leader, undo/redo.
 */

import { useState, useCallback, useRef } from 'react';
import type { DeckList, DeckAction, EnrichedCard } from '../deck/types';
import { canAddCard } from '../deck/validation';

export interface UseDeckBuilderResult {
  /** Current deck state */
  deck: DeckList;
  /** Set the entire deck (e.g., when loading from storage) */
  setDeck: (deck: DeckList) => void;
  /** Add a card to the deck. Returns error message or null. */
  addCard: (cardId: string, card: EnrichedCard) => string | null;
  /** Remove one copy of a card from the deck */
  removeCard: (cardId: string) => void;
  /** Set the leader card */
  setLeader: (cardId: string) => void;
  /** Clear the leader card */
  clearLeader: () => void;
  /** Update deck name */
  setName: (name: string) => void;
  /** Undo last action */
  undo: () => void;
  /** Redo last undone action */
  redo: () => void;
  /** Whether undo is available */
  canUndo: boolean;
  /** Whether redo is available */
  canRedo: boolean;
  /** Leader card (resolved) */
  leaderCard: EnrichedCard | null;
  /** Set the leader card reference for validation */
  setLeaderCard: (card: EnrichedCard | null) => void;
}

const MAX_UNDO = 50;

export function useDeckBuilder(initialDeck: DeckList): UseDeckBuilderResult {
  const [deck, setDeckState] = useState<DeckList>(initialDeck);
  const [leaderCard, setLeaderCard] = useState<EnrichedCard | null>(null);

  // Undo/redo stacks store deck snapshots
  const undoStack = useRef<DeckList[]>([]);
  const redoStack = useRef<DeckList[]>([]);

  const pushUndo = useCallback((current: DeckList) => {
    undoStack.current.push({ ...current, cards: { ...current.cards } });
    if (undoStack.current.length > MAX_UNDO) {
      undoStack.current.shift();
    }
    // Any new action clears the redo stack
    redoStack.current = [];
  }, []);

  const setDeck = useCallback((newDeck: DeckList) => {
    setDeckState(newDeck);
    // Reset undo/redo when loading a whole new deck
    undoStack.current = [];
    redoStack.current = [];
  }, []);

  const addCard = useCallback(
    (cardId: string, card: EnrichedCard): string | null => {
      // Validate before adding
      const error = canAddCard(deck, cardId, card, leaderCard);
      if (error) return error;

      pushUndo(deck);
      setDeckState((prev) => ({
        ...prev,
        cards: {
          ...prev.cards,
          [cardId]: (prev.cards[cardId] ?? 0) + 1,
        },
        updatedAt: Date.now(),
      }));

      return null;
    },
    [deck, leaderCard, pushUndo],
  );

  const removeCard = useCallback(
    (cardId: string) => {
      const current = deck.cards[cardId];
      if (!current) return;

      pushUndo(deck);
      setDeckState((prev) => {
        const newCards = { ...prev.cards };
        if (newCards[cardId] <= 1) {
          delete newCards[cardId];
        } else {
          newCards[cardId] -= 1;
        }
        return { ...prev, cards: newCards, updatedAt: Date.now() };
      });
    },
    [deck, pushUndo],
  );

  const setLeader = useCallback(
    (cardId: string) => {
      pushUndo(deck);
      setDeckState((prev) => ({
        ...prev,
        leaderId: cardId,
        updatedAt: Date.now(),
      }));
    },
    [deck, pushUndo],
  );

  const clearLeader = useCallback(() => {
    pushUndo(deck);
    setDeckState((prev) => ({
      ...prev,
      leaderId: '',
      updatedAt: Date.now(),
    }));
    setLeaderCard(null);
  }, [deck, pushUndo]);

  const setName = useCallback((name: string) => {
    setDeckState((prev) => ({
      ...prev,
      name,
      updatedAt: Date.now(),
    }));
  }, []);

  const undo = useCallback(() => {
    const prev = undoStack.current.pop();
    if (!prev) return;
    redoStack.current.push({ ...deck, cards: { ...deck.cards } });
    setDeckState(prev);
  }, [deck]);

  const redo = useCallback(() => {
    const next = redoStack.current.pop();
    if (!next) return;
    undoStack.current.push({ ...deck, cards: { ...deck.cards } });
    setDeckState(next);
  }, [deck]);

  return {
    deck,
    setDeck,
    addCard,
    removeCard,
    setLeader,
    clearLeader,
    setName,
    undo,
    redo,
    canUndo: undoStack.current.length > 0,
    canRedo: redoStack.current.length > 0,
    leaderCard,
    setLeaderCard,
  };
}
