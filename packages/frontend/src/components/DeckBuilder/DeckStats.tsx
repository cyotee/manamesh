/**
 * DeckStats — Statistics panel for deck composition
 *
 * Shows cost curve, color distribution, type breakdown,
 * and counter/power analysis.
 */

import React, { useMemo } from 'react';
import type { DeckList, EnrichedCard } from '../../deck/types';
import { calculateDeckStats } from '../../deck/stats';

interface DeckStatsProps {
  deck: DeckList;
  cardLookup: Map<string, EnrichedCard>;
}

export const DeckStats: React.FC<DeckStatsProps> = ({ deck, cardLookup }) => {
  const stats = useMemo(
    () => calculateDeckStats(deck, cardLookup),
    [deck, cardLookup],
  );

  if (stats.totalCards === 0) {
    return (
      <div style={{ padding: 16, color: '#555', fontSize: 12, textAlign: 'center' }}>
        Add cards to see statistics
      </div>
    );
  }

  const maxCost = Math.max(...Object.values(stats.costCurve), 1);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 8 }}>
      {/* Cost curve */}
      <StatSection title="Cost Curve">
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 60 }}>
          {Array.from({ length: 11 }, (_, i) => {
            const count = stats.costCurve[i] ?? 0;
            const height = maxCost > 0 ? (count / maxCost) * 60 : 0;
            return (
              <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                {count > 0 && (
                  <span style={{ fontSize: 9, color: '#888', marginBottom: 2 }}>{count}</span>
                )}
                <div style={{
                  width: '100%',
                  height: Math.max(height, 1),
                  backgroundColor: '#4a6fa5',
                  borderRadius: '2px 2px 0 0',
                }} />
                <span style={{ fontSize: 9, color: '#666', marginTop: 2 }}>
                  {i === 10 ? '10+' : i}
                </span>
              </div>
            );
          })}
        </div>
        <div style={{ fontSize: 11, color: '#8888aa', marginTop: 4 }}>
          Avg cost: {stats.avgCost.toFixed(1)}
        </div>
      </StatSection>

      {/* Color distribution */}
      <StatSection title="Colors">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {Object.entries(stats.colorDistribution)
            .sort(([, a], [, b]) => b - a)
            .map(([color, count]) => (
              <div key={color} style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                padding: '2px 8px',
                backgroundColor: colorToHex(color),
                borderRadius: 4,
                fontSize: 11,
                color: '#fff',
              }}>
                <span style={{ textTransform: 'capitalize' }}>{color}</span>
                <span style={{ fontWeight: 'bold' }}>{count}</span>
              </div>
            ))}
        </div>
      </StatSection>

      {/* Type breakdown */}
      <StatSection title="Types">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {Object.entries(stats.typeBreakdown)
            .sort(([, a], [, b]) => b - a)
            .map(([type, count]) => (
              <div key={type} style={{
                padding: '2px 8px',
                backgroundColor: '#2a2a4a',
                borderRadius: 4,
                fontSize: 11,
                color: '#c0c0e0',
                textTransform: 'capitalize',
              }}>
                {type}: {count}
              </div>
            ))}
        </div>
      </StatSection>

      {/* Counter distribution */}
      <StatSection title="Counter">
        <div style={{ fontSize: 11, color: '#c0c0e0' }}>
          <div>With counter: {stats.counterDistribution.withCounter}</div>
          <div>Without: {stats.counterDistribution.withoutCounter}</div>
          {stats.counterDistribution.withCounter > 0 && (
            <div>Avg counter: +{stats.counterDistribution.avgCounter.toFixed(0)}</div>
          )}
        </div>
      </StatSection>
    </div>
  );
};

const StatSection: React.FC<{ title: string; children: React.ReactNode }> = ({
  title,
  children,
}) => (
  <div>
    <div style={{
      fontSize: 11,
      fontWeight: 'bold',
      color: '#8888aa',
      marginBottom: 4,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    }}>
      {title}
    </div>
    {children}
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
