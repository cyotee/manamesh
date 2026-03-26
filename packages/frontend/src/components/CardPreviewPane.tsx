/**
 * CardPreviewPane — Shows an enlarged view of the hovered card.
 *
 * Displays the card's face image at CARD_SIZES.preview dimensions
 * when the player hovers over a face-up card on the board.
 * Sits to the left of the Phaser board in a flex layout.
 */

import { CARD_SIZES } from '../phaser/types';

export interface CardPreviewPaneProps {
  /** Instance ID of the hovered card, or null if nothing is hovered */
  cardId: string | null;
  /** Map of instance IDs → object URLs for card face images */
  cardImages: Record<string, string>;
  /** Name of the hovered card */
  cardName: string | null;
}

export function CardPreviewPane({ cardId, cardImages, cardName }: CardPreviewPaneProps) {
  const imageUrl = cardId ? cardImages[cardId] : null;
  const { width, height } = CARD_SIZES.preview;

  return (
    <div
      style={{
        width: `${width + 32}px`,
        minWidth: `${width + 32}px`,
        padding: '16px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'flex-start',
        backgroundColor: '#0d1b2a',
        borderRadius: '8px',
        border: '1px solid #3a3a5c',
      }}
    >
      {imageUrl ? (
        <>
          <img
            src={imageUrl}
            alt={cardName ?? 'Card preview'}
            style={{
              width: `${width}px`,
              height: `${height}px`,
              objectFit: 'contain',
              borderRadius: '8px',
              border: '1px solid #3a3a5c',
            }}
          />
          {cardName && (
            <div
              style={{
                marginTop: '8px',
                color: '#e4e4e4',
                fontSize: '14px',
                fontFamily: 'system-ui, sans-serif',
                textAlign: 'center',
                maxWidth: `${width}px`,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {cardName}
            </div>
          )}
        </>
      ) : (
        <div
          style={{
            width: `${width}px`,
            height: `${height}px`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '8px',
            border: '1px dashed #3a3a5c',
            color: '#556677',
            fontSize: '14px',
            fontFamily: 'system-ui, sans-serif',
            textAlign: 'center',
            padding: '16px',
          }}
        >
          Hover a card to preview
        </div>
      )}
    </div>
  );
}
