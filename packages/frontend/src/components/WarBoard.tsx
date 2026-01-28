/**
 * War Board Component
 *
 * Classic War card game board.
 */

import React from 'react';
import type { BoardProps } from 'boardgame.io/react';
import type { WarState, WarCard } from '../game/modules/war/types';

interface WarBoardProps extends BoardProps<WarState> {}

const SUIT_SYMBOLS: Record<string, string> = {
  hearts: '\u2665',
  diamonds: '\u2666',
  clubs: '\u2663',
  spades: '\u2660',
};

const SUIT_COLORS: Record<string, string> = {
  hearts: '#e74c3c',
  diamonds: '#e74c3c',
  clubs: '#2c3e50',
  spades: '#2c3e50',
};

const CardDisplay: React.FC<{
  card?: WarCard;
  faceDown?: boolean;
  large?: boolean;
}> = ({ card, faceDown, large }) => {
  const width = large ? 100 : 70;
  const height = large ? 140 : 100;

  if (faceDown || !card) {
    return (
      <div style={{
        width,
        height,
        backgroundColor: '#1a365d',
        border: '2px solid #3182ce',
        borderRadius: '8px',
        margin: '4px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundImage: 'repeating-linear-gradient(45deg, #2a4365, #2a4365 10px, #1a365d 10px, #1a365d 20px)',
      }}>
        <span style={{ fontSize: large ? '32px' : '24px', color: '#63b3ed' }}>🂠</span>
      </div>
    );
  }

  return (
    <div style={{
      width,
      height,
      backgroundColor: '#fff',
      border: '2px solid #ccc',
      borderRadius: '8px',
      margin: '4px',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      boxShadow: '0 4px 8px rgba(0,0,0,0.3)',
    }}>
      <span style={{
        fontSize: large ? '32px' : '24px',
        fontWeight: 'bold',
        color: SUIT_COLORS[card.suit],
      }}>
        {card.rank}
      </span>
      <span style={{
        fontSize: large ? '40px' : '28px',
        color: SUIT_COLORS[card.suit],
      }}>
        {SUIT_SYMBOLS[card.suit]}
      </span>
    </div>
  );
};

const PlayerArea: React.FC<{
  playerId: string;
  player: WarState['players'][string];
  isCurrentUser: boolean;
  isTop: boolean;
}> = ({ playerId, player, isCurrentUser, isTop }) => {
  const totalCards = player.deck.length + player.won.length + player.played.length;

  return (
    <div style={{
      display: 'flex',
      flexDirection: isTop ? 'column' : 'column-reverse',
      alignItems: 'center',
      padding: '20px',
      backgroundColor: isCurrentUser ? '#1e2a45' : '#16213e',
      borderRadius: '12px',
      border: '1px solid #3a3a5c',
      minWidth: '300px',
    }}>
      <div style={{
        marginBottom: isTop ? '16px' : '0',
        marginTop: isTop ? '0' : '16px',
        textAlign: 'center',
      }}>
        <div style={{ fontWeight: 'bold', color: '#e4e4e4', fontSize: '18px' }}>
          Player {playerId} {isCurrentUser && '(You)'}
        </div>
        <div style={{ color: '#a0a0a0', fontSize: '14px' }}>
          {totalCards} cards total
        </div>
      </div>

      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '40px',
      }}>
        {/* Deck */}
        <div style={{ textAlign: 'center' }}>
          <div style={{
            position: 'relative',
            width: '70px',
            height: '100px',
          }}>
            {player.deck.length > 0 ? (
              <>
                {/* Stack effect */}
                {player.deck.length > 2 && (
                  <div style={{
                    position: 'absolute',
                    top: '4px',
                    left: '4px',
                    width: '70px',
                    height: '100px',
                    backgroundColor: '#1a365d',
                    border: '2px solid #3182ce',
                    borderRadius: '8px',
                  }} />
                )}
                {player.deck.length > 1 && (
                  <div style={{
                    position: 'absolute',
                    top: '2px',
                    left: '2px',
                    width: '70px',
                    height: '100px',
                    backgroundColor: '#1a365d',
                    border: '2px solid #3182ce',
                    borderRadius: '8px',
                  }} />
                )}
                <div style={{ position: 'absolute', top: 0, left: 0 }}>
                  <CardDisplay faceDown />
                </div>
              </>
            ) : (
              <div style={{
                width: '70px',
                height: '100px',
                border: '2px dashed #3a3a5c',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#6a6a8a',
                fontSize: '12px',
              }}>
                Empty
              </div>
            )}
          </div>
          <div style={{ color: '#a0a0a0', fontSize: '12px', marginTop: '8px' }}>
            Deck: {player.deck.length}
          </div>
        </div>

        {/* Played card */}
        <div style={{ textAlign: 'center' }}>
          {player.played.length > 0 ? (
            <div style={{ display: 'flex', gap: '4px' }}>
              {player.played.map((card, i) => (
                <CardDisplay
                  key={card.id}
                  card={card}
                  faceDown={i < player.played.length - 1}
                  large={i === player.played.length - 1}
                />
              ))}
            </div>
          ) : (
            <div style={{
              width: '100px',
              height: '140px',
              border: '2px dashed #3a3a5c',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#6a6a8a',
              fontSize: '14px',
            }}>
              Play Area
            </div>
          )}
        </div>

        {/* Won pile */}
        <div style={{ textAlign: 'center' }}>
          <div style={{
            position: 'relative',
            width: '70px',
            height: '100px',
          }}>
            {player.won.length > 0 ? (
              <>
                {player.won.length > 2 && (
                  <div style={{
                    position: 'absolute',
                    top: '4px',
                    left: '4px',
                    width: '70px',
                    height: '100px',
                    backgroundColor: '#1a365d',
                    border: '2px solid #22c55e',
                    borderRadius: '8px',
                  }} />
                )}
                {player.won.length > 1 && (
                  <div style={{
                    position: 'absolute',
                    top: '2px',
                    left: '2px',
                    width: '70px',
                    height: '100px',
                    backgroundColor: '#1a365d',
                    border: '2px solid #22c55e',
                    borderRadius: '8px',
                  }} />
                )}
                <div style={{ position: 'absolute', top: 0, left: 0 }}>
                  <CardDisplay faceDown />
                </div>
              </>
            ) : (
              <div style={{
                width: '70px',
                height: '100px',
                border: '2px dashed #22c55e',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#6a6a8a',
                fontSize: '12px',
              }}>
                Won
              </div>
            )}
          </div>
          <div style={{ color: '#22c55e', fontSize: '12px', marginTop: '8px' }}>
            Won: {player.won.length}
          </div>
        </div>
      </div>
    </div>
  );
};

export const WarBoard: React.FC<WarBoardProps> = ({
  G,
  ctx,
  moves,
  playerID,
}) => {
  const currentPlayerID = playerID || '0';
  const opponentID = currentPlayerID === '0' ? '1' : '0';

  const myPlayer = G.players[currentPlayerID];
  const opponentPlayer = G.players[opponentID];

  const canFlip = G.phase === 'flip' && myPlayer?.played.length === 0 && myPlayer?.deck.length > 0;
  const needsWarCards = G.warInProgress && G.phase === 'flip' && myPlayer?.played.length > 0 && myPlayer?.deck.length >= 4;

  const handleFlip = () => {
    moves.flipCard(currentPlayerID);
  };

  const handlePlaceWarCards = () => {
    moves.placeWarCards(currentPlayerID);
  };

  const handleResolve = () => {
    moves.resolveRound();
  };

  // Check if both players have flipped
  const bothFlipped = myPlayer?.played.length > 0 && opponentPlayer?.played.length > 0;
  const canResolve = G.phase === 'resolve' || (bothFlipped && !G.warInProgress);

  // Game over screen
  if (ctx.gameover || G.phase === 'gameOver') {
    const winner = ctx.gameover?.winner || G.winner;
    return (
      <div style={{
        padding: '40px',
        textAlign: 'center',
        fontFamily: 'system-ui, sans-serif',
        color: '#e4e4e4',
      }}>
        <h1>Game Over!</h1>
        <p style={{ fontSize: '24px' }}>
          {winner === currentPlayerID ? (
            <span style={{ color: '#4ade80' }}>You win!</span>
          ) : (
            <span style={{ color: '#f87171' }}>Player {winner} wins!</span>
          )}
        </p>
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
      {/* Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '20px',
        padding: '12px 20px',
        backgroundColor: '#16213e',
        borderRadius: '8px',
        border: '1px solid #3a3a5c',
      }}>
        <h2 style={{ margin: 0 }}>War</h2>
        {G.warInProgress && (
          <span style={{
            padding: '8px 16px',
            backgroundColor: '#dc2626',
            borderRadius: '8px',
            fontWeight: 'bold',
            animation: 'pulse 1s infinite',
          }}>
            WAR!
          </span>
        )}
      </div>

      {/* Opponent area (top) */}
      <PlayerArea
        playerId={opponentID}
        player={opponentPlayer}
        isCurrentUser={false}
        isTop={true}
      />

      {/* Battle area / status */}
      <div style={{
        padding: '20px',
        margin: '20px 0',
        textAlign: 'center',
        backgroundColor: '#0f3460',
        borderRadius: '12px',
      }}>
        {G.warInProgress ? (
          <div>
            <div style={{ fontSize: '24px', marginBottom: '12px' }}>
              ⚔️ WAR! ⚔️
            </div>
            <div style={{ color: '#a0a0a0' }}>
              Place 3 cards face-down, then flip the 4th!
            </div>
          </div>
        ) : bothFlipped ? (
          <div>
            <div style={{ fontSize: '20px', marginBottom: '12px' }}>
              Cards revealed!
            </div>
            <button
              onClick={handleResolve}
              style={{
                padding: '12px 32px',
                fontSize: '16px',
                cursor: 'pointer',
                backgroundColor: '#4CAF50',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
              }}
            >
              Resolve Round
            </button>
          </div>
        ) : (
          <div style={{ color: '#a0a0a0' }}>
            Flip your cards to battle!
          </div>
        )}
      </div>

      {/* Your area (bottom) */}
      <PlayerArea
        playerId={currentPlayerID}
        player={myPlayer}
        isCurrentUser={true}
        isTop={false}
      />

      {/* Action buttons */}
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        gap: '16px',
        marginTop: '20px',
      }}>
        {canFlip && (
          <button
            onClick={handleFlip}
            style={{
              padding: '16px 48px',
              fontSize: '18px',
              cursor: 'pointer',
              backgroundColor: '#3b82f6',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
            }}
          >
            Flip Card!
          </button>
        )}

        {needsWarCards && (
          <button
            onClick={handlePlaceWarCards}
            style={{
              padding: '16px 48px',
              fontSize: '18px',
              cursor: 'pointer',
              backgroundColor: '#dc2626',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
            }}
          >
            Place War Cards!
          </button>
        )}
      </div>
    </div>
  );
};
