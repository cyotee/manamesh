// Pure game logic helpers for unit testing

export interface Card {
  id: string;
  name: string;
}

export interface GState {
  deck: Card[];
  hands: Record<string, Card[]>;
  field: Record<string, Card[]>;  // Cards played to the field
  discard: Card[];
  winner: string | null;
  maxHandSize: number;
  cardsToWin: number;  // Number of cards played to win
}

export interface DrawResult {
  state: GState;
  drawnCard: Card | null;
}

export interface PlayResult {
  state: GState;
  success: boolean;
  error?: string;
}

/**
 * Creates the initial game state with a shuffled deck
 */
export function createInitialState(deckCards: Card[], numPlayers: number): GState {
  const hands: Record<string, Card[]> = {};
  const field: Record<string, Card[]> = {};

  for (let i = 0; i < numPlayers; i++) {
    hands[i.toString()] = [];
    field[i.toString()] = [];
  }

  return {
    deck: shuffleDeck(deckCards),
    hands,
    field,
    discard: [],
    winner: null,
    maxHandSize: 7,
    cardsToWin: 5,
  };
}

/**
 * Shuffles a deck using Fisher-Yates algorithm
 */
export function shuffleDeck(deck: Card[]): Card[] {
  const shuffled = deck.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

/**
 * Draws a card from the deck into a player's hand
 */
export function drawCard(G: GState, playerID: string): DrawResult {
  const deck = G.deck.slice();
  const hands = { ...G.hands };

  if (deck.length === 0) {
    return { state: { ...G, deck, hands }, drawnCard: null };
  }

  const card = deck.shift()!;
  const playerHand = (hands[playerID] || []).slice();
  playerHand.push(card);
  hands[playerID] = playerHand;

  return {
    state: { ...G, deck, hands },
    drawnCard: card,
  };
}

/**
 * Plays a card from a player's hand to the field
 */
export function playCard(G: GState, playerID: string, cardId: string): PlayResult {
  const hands = { ...G.hands };
  const field = { ...G.field };

  const playerHand = (hands[playerID] || []).slice();
  const cardIndex = playerHand.findIndex(c => c.id === cardId);

  if (cardIndex === -1) {
    return {
      state: G,
      success: false,
      error: 'Card not in hand',
    };
  }

  const [card] = playerHand.splice(cardIndex, 1);
  hands[playerID] = playerHand;

  const playerField = (field[playerID] || []).slice();
  playerField.push(card);
  field[playerID] = playerField;

  // Check win condition
  let winner = G.winner;
  if (playerField.length >= G.cardsToWin) {
    winner = playerID;
  }

  return {
    state: { ...G, hands, field, winner },
    success: true,
  };
}

/**
 * Discards a card from a player's hand
 */
export function discardCard(G: GState, playerID: string, cardId: string): PlayResult {
  const hands = { ...G.hands };
  const discard = G.discard.slice();

  const playerHand = (hands[playerID] || []).slice();
  const cardIndex = playerHand.findIndex(c => c.id === cardId);

  if (cardIndex === -1) {
    return {
      state: G,
      success: false,
      error: 'Card not in hand',
    };
  }

  const [card] = playerHand.splice(cardIndex, 1);
  hands[playerID] = playerHand;
  discard.push(card);

  return {
    state: { ...G, hands, discard },
    success: true,
  };
}

/**
 * Checks if the game is over
 */
export function isGameOver(G: GState): boolean {
  return G.winner !== null || G.deck.length === 0;
}

/**
 * Creates a simple test deck with numbered cards
 */
export function createTestDeck(size: number = 20): Card[] {
  const cards: Card[] = [];
  for (let i = 1; i <= size; i++) {
    cards.push({ id: `card-${i}`, name: `Card ${i}` });
  }
  return cards;
}
