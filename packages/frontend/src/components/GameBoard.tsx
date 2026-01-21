import React from 'react';
import { BoardProps } from 'boardgame.io/react';
import { SimpleCardGameState } from '../game/game';
import { Card } from '../game/logic';
import { IPFSImage, PreloadProgress } from './IPFSImage';

interface GameBoardProps extends BoardProps<SimpleCardGameState> {}

// Extended card type that may include an IPFS image CID
interface CardWithImage extends Card {
  imageCid?: string;
}

const CardComponent: React.FC<{
  card: CardWithImage;
  onClick?: () => void;
  selected?: boolean;
}> = ({ card, onClick, selected }) => {
  const hasImage = Boolean(card.imageCid);

  return (
    <div
      onClick={onClick}
      style={{
        border: selected ? '2px solid #4CAF50' : '1px solid #3a3a5c',
        borderRadius: '8px',
        padding: hasImage ? '4px' : '8px 12px',
        margin: '4px',
        cursor: onClick ? 'pointer' : 'default',
        backgroundColor: selected ? '#1a4a3a' : '#16213e',
        minWidth: hasImage ? '100px' : '80px',
        textAlign: 'center',
        boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
        transition: 'all 0.2s ease',
        color: '#e4e4e4',
      }}
    >
      {hasImage ? (
        <>
          <IPFSImage
            cid={card.imageCid!}
            alt={card.name}
            width={92}
            height={128}
            style={{ borderRadius: '4px', marginBottom: '4px' }}
            preferGateway={true}
          />
          <div style={{ fontWeight: 'bold', fontSize: '11px', marginTop: '4px' }}>{card.name}</div>
        </>
      ) : (
        <>
          <div style={{ fontWeight: 'bold', fontSize: '14px' }}>{card.name}</div>
          <div style={{ fontSize: '10px', color: '#a0a0a0' }}>{card.id}</div>
        </>
      )}
    </div>
  );
};

const PlayerArea: React.FC<{
  playerID: string;
  hand: CardWithImage[];
  field: CardWithImage[];
  isCurrentPlayer: boolean;
  isActivePlayer: boolean;
  onCardClick?: (cardId: string) => void;
  selectedCard: string | null;
}> = ({ playerID, hand, field, isCurrentPlayer, isActivePlayer, onCardClick, selectedCard }) => (
  <div
    style={{
      border: isActivePlayer ? '2px solid #2196F3' : '1px solid #3a3a5c',
      borderRadius: '12px',
      padding: '16px',
      margin: '8px 0',
      backgroundColor: isCurrentPlayer ? '#1e2a45' : '#16213e',
    }}
  >
    <div style={{
      fontWeight: 'bold',
      marginBottom: '12px',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      color: '#e4e4e4',
    }}>
      <span>
        Player {playerID} {isCurrentPlayer && '(You)'} {isActivePlayer && '⭐'}
      </span>
      <span style={{ fontSize: '12px', color: '#a0a0a0' }}>
        Hand: {hand.length} | Field: {field.length}
      </span>
    </div>

    <div style={{ marginBottom: '12px' }}>
      <div style={{ fontSize: '12px', color: '#a0a0a0', marginBottom: '4px' }}>Field:</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', minHeight: '60px', backgroundColor: '#0f3460', borderRadius: '8px', padding: '8px' }}>
        {field.length === 0 ? (
          <span style={{ color: '#6a6a8a', padding: '8px' }}>No cards played</span>
        ) : (
          field.map(card => <CardComponent key={card.id} card={card} />)
        )}
      </div>
    </div>

    <div>
      <div style={{ fontSize: '12px', color: '#a0a0a0', marginBottom: '4px' }}>
        Hand: {!isCurrentPlayer && '(hidden)'}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', minHeight: '60px' }}>
        {isCurrentPlayer ? (
          hand.length === 0 ? (
            <span style={{ color: '#6a6a8a', padding: '8px' }}>No cards in hand</span>
          ) : (
            hand.map(card => (
              <CardComponent
                key={card.id}
                card={card}
                onClick={() => onCardClick?.(card.id)}
                selected={selectedCard === card.id}
              />
            ))
          )
        ) : (
          <span style={{ color: '#6a6a8a', padding: '8px' }}>
            {hand.length} cards (hidden)
          </span>
        )}
      </div>
    </div>
  </div>
);

// Helper to collect all image CIDs from cards for preloading
function collectImageCids(G: SimpleCardGameState): string[] {
  const cids = new Set<string>();

  // Collect from deck
  G.deck.forEach((card: CardWithImage) => {
    if (card.imageCid) cids.add(card.imageCid);
  });

  // Collect from hands
  Object.values(G.hands).forEach(hand => {
    hand.forEach((card: CardWithImage) => {
      if (card.imageCid) cids.add(card.imageCid);
    });
  });

  // Collect from field
  Object.values(G.field).forEach(field => {
    field.forEach((card: CardWithImage) => {
      if (card.imageCid) cids.add(card.imageCid);
    });
  });

  // Collect from discard
  G.discard.forEach((card: CardWithImage) => {
    if (card.imageCid) cids.add(card.imageCid);
  });

  return Array.from(cids);
}

export const GameBoard: React.FC<GameBoardProps> = ({
  G,
  ctx,
  moves,
  playerID,
}) => {
  const [selectedCard, setSelectedCard] = React.useState<string | null>(null);
  const [isPreloading, setIsPreloading] = React.useState(true);
  const currentPlayerID = playerID || '0';
  const isMyTurn = ctx.currentPlayer === currentPlayerID;
  const myHand = G.hands[currentPlayerID] || [];

  // Collect all image CIDs for preloading
  const imageCids = React.useMemo(() => collectImageCids(G), []);

  const handlePreloadComplete = React.useCallback(() => {
    setIsPreloading(false);
  }, []);

  const handleCardClick = (cardId: string) => {
    if (!isMyTurn) return;
    setSelectedCard(prev => (prev === cardId ? null : cardId));
  };

  const handleDraw = () => {
    if (!isMyTurn) return;
    moves.drawCard();
  };

  const handlePlay = () => {
    if (!isMyTurn || !selectedCard) return;
    moves.playCard(selectedCard);
    setSelectedCard(null);
  };

  const handleDiscard = () => {
    if (!isMyTurn || !selectedCard) return;
    moves.discardCard(selectedCard);
    setSelectedCard(null);
  };

  const handleEndTurn = () => {
    if (!isMyTurn) return;
    // boardgame.io handles turn ending automatically after minMoves
    // but we can use events.endTurn if available
  };

  // Game over screen
  if (ctx.gameover) {
    return (
      <div style={{
        padding: '40px',
        textAlign: 'center',
        fontFamily: 'system-ui, sans-serif',
        color: '#e4e4e4',
      }}>
        <h1>Game Over!</h1>
        {ctx.gameover.winner ? (
          <p style={{ fontSize: '24px' }}>
            🎉 Player {ctx.gameover.winner} wins! 🎉
          </p>
        ) : (
          <p style={{ fontSize: '24px' }}>It's a draw!</p>
        )}
        <button
          onClick={() => window.location.reload()}
          style={{
            padding: '12px 24px',
            fontSize: '16px',
            cursor: 'pointer',
            backgroundColor: '#4CAF50',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            marginTop: '20px',
          }}
        >
          Play Again
        </button>
      </div>
    );
  }

  return (
    <div style={{
      padding: '20px',
      maxWidth: '800px',
      margin: '0 auto',
      fontFamily: 'system-ui, sans-serif',
      color: '#e4e4e4',
    }}>
      {/* Preload deck images at game start */}
      {imageCids.length > 0 && isPreloading && (
        <PreloadProgress
          cids={imageCids}
          onComplete={handlePreloadComplete}
          showDetails={true}
        />
      )}

      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '20px',
        padding: '12px',
        backgroundColor: '#16213e',
        borderRadius: '8px',
        border: '1px solid #3a3a5c',
      }}>
        <h2 style={{ margin: 0 }}>ManaMesh - Simple Card Game</h2>
        <div style={{ color: '#a0a0a0' }}>
          <span style={{ marginRight: '16px' }}>Deck: {G.deck.length} cards</span>
          <span>Discard: {G.discard.length} cards</span>
        </div>
      </div>

      <div style={{
        padding: '12px',
        backgroundColor: isMyTurn ? '#1a4a3a' : '#3d2a1a',
        borderRadius: '8px',
        marginBottom: '20px',
        textAlign: 'center',
        border: '1px solid #3a3a5c',
      }}>
        {isMyTurn ? (
          <span style={{ color: '#6fcf6f', fontWeight: 'bold' }}>Your turn! Draw, play, or discard cards.</span>
        ) : (
          <span style={{ color: '#ff9800' }}>Waiting for Player {ctx.currentPlayer}...</span>
        )}
      </div>

      {/* Opponent's area (player 1 if you're player 0, or vice versa) */}
      {Object.keys(G.hands)
        .filter(id => id !== currentPlayerID)
        .map(id => (
          <PlayerArea
            key={id}
            playerID={id}
            hand={G.hands[id] || []}
            field={G.field[id] || []}
            isCurrentPlayer={false}
            isActivePlayer={ctx.currentPlayer === id}
            selectedCard={null}
          />
        ))}

      {/* Your area */}
      <PlayerArea
        playerID={currentPlayerID}
        hand={myHand}
        field={G.field[currentPlayerID] || []}
        isCurrentPlayer={true}
        isActivePlayer={ctx.currentPlayer === currentPlayerID}
        onCardClick={handleCardClick}
        selectedCard={selectedCard}
      />

      {/* Action buttons */}
      <div style={{
        display: 'flex',
        gap: '12px',
        justifyContent: 'center',
        marginTop: '20px'
      }}>
        <button
          onClick={handleDraw}
          disabled={!isMyTurn || G.deck.length === 0}
          style={{
            padding: '12px 24px',
            fontSize: '16px',
            cursor: isMyTurn && G.deck.length > 0 ? 'pointer' : 'not-allowed',
            backgroundColor: isMyTurn && G.deck.length > 0 ? '#2196F3' : '#3a3a5c',
            color: isMyTurn && G.deck.length > 0 ? 'white' : '#6a6a8a',
            border: 'none',
            borderRadius: '8px',
          }}
        >
          Draw Card
        </button>
        <button
          onClick={handlePlay}
          disabled={!isMyTurn || !selectedCard}
          style={{
            padding: '12px 24px',
            fontSize: '16px',
            cursor: isMyTurn && selectedCard ? 'pointer' : 'not-allowed',
            backgroundColor: isMyTurn && selectedCard ? '#4CAF50' : '#3a3a5c',
            color: isMyTurn && selectedCard ? 'white' : '#6a6a8a',
            border: 'none',
            borderRadius: '8px',
          }}
        >
          Play Selected
        </button>
        <button
          onClick={handleDiscard}
          disabled={!isMyTurn || !selectedCard}
          style={{
            padding: '12px 24px',
            fontSize: '16px',
            cursor: isMyTurn && selectedCard ? 'pointer' : 'not-allowed',
            backgroundColor: isMyTurn && selectedCard ? '#ff9800' : '#3a3a5c',
            color: isMyTurn && selectedCard ? 'white' : '#6a6a8a',
            border: 'none',
            borderRadius: '8px',
          }}
        >
          Discard Selected
        </button>
      </div>

      <div style={{
        marginTop: '20px',
        padding: '12px',
        backgroundColor: '#3d2a1a',
        borderRadius: '8px',
        fontSize: '14px',
        color: '#f0c060',
        border: '1px solid #3a3a5c',
      }}>
        <strong>Win condition:</strong> Play {G.cardsToWin} cards to the field to win!
      </div>
    </div>
  );
};
