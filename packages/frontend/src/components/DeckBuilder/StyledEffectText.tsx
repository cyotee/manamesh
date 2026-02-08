/**
 * StyledEffectText — Renders card effect text with colored bracket keywords.
 *
 * Parses [Keyword] patterns in effect text and renders them as styled spans
 * with configurable background colors.
 */

import React, { useMemo } from 'react';
import { parseEffectText } from '../../deck/bracket-styles';
import type { BracketStyleConfig } from '../../deck/bracket-styles';

interface StyledEffectTextProps {
  text: string;
  /** Optional config override (defaults to persisted config). */
  config?: BracketStyleConfig;
  /** Optional fallback color override for unmatched brackets. */
  fallbackColor?: string;
}

export const StyledEffectText: React.FC<StyledEffectTextProps> = ({
  text,
  config,
  fallbackColor,
}) => {
  const segments = useMemo(
    () => parseEffectText(text, config, fallbackColor),
    [text, config, fallbackColor],
  );

  return (
    <span>
      {segments.map((seg, i) =>
        seg.type === 'plain' ? (
          <span key={i}>{seg.text}</span>
        ) : (
          <span
            key={i}
            style={{
              backgroundColor: seg.color ?? undefined,
              color: '#ffffff',
              padding: '1px 5px',
              borderRadius: 3,
              fontWeight: 600,
              whiteSpace: 'nowrap',
            }}
          >
            {seg.text}
          </span>
        ),
      )}
    </span>
  );
};
