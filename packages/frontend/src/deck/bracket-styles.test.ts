import { describe, it, expect, beforeEach } from 'vitest';
import {
  parseEffectText,
  DEFAULT_BRACKET_STYLES,
  DEFAULT_BRACKET_FALLBACK_COLOR,
} from './bracket-styles';
import type { BracketStyleConfig, TextSegment } from './bracket-styles';

describe('parseEffectText', () => {
  it('returns empty array for empty string', () => {
    expect(parseEffectText('', DEFAULT_BRACKET_STYLES)).toEqual([]);
  });

  it('returns single plain segment for text with no brackets', () => {
    const result = parseEffectText(
      'Draw 2 cards.',
      DEFAULT_BRACKET_STYLES,
    );
    expect(result).toEqual([
      { type: 'plain', text: 'Draw 2 cards.', color: null },
    ]);
  });

  it('parses a single bracket at the start', () => {
    const result = parseEffectText(
      '[On Play] Draw 2 cards.',
      DEFAULT_BRACKET_STYLES,
    );
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      type: 'bracket',
      text: '[On Play]',
      color: '#0d47a1',
    });
    expect(result[1]).toEqual({
      type: 'plain',
      text: ' Draw 2 cards.',
      color: null,
    });
  });

  it('parses a bracket at the end', () => {
    const result = parseEffectText(
      'This card has [Rush]',
      DEFAULT_BRACKET_STYLES,
    );
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe('plain');
    expect(result[1]).toEqual({
      type: 'bracket',
      text: '[Rush]',
      color: '#b71c1c',
    });
  });

  it('parses multiple brackets', () => {
    const result = parseEffectText(
      '[On Play] Draw a card. [Trigger] Return this card.',
      DEFAULT_BRACKET_STYLES,
    );
    expect(result).toHaveLength(4);
    expect(result[0].type).toBe('bracket');
    expect(result[0].text).toBe('[On Play]');
    expect(result[1].type).toBe('plain');
    expect(result[2].type).toBe('bracket');
    expect(result[2].text).toBe('[Trigger]');
    expect(result[3].type).toBe('plain');
  });

  it('parses adjacent brackets with no plain text between', () => {
    const result = parseEffectText(
      '[Rush][Blocker]',
      DEFAULT_BRACKET_STYLES,
    );
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      type: 'bracket',
      text: '[Rush]',
      color: '#b71c1c',
    });
    expect(result[1]).toEqual({
      type: 'bracket',
      text: '[Blocker]',
      color: '#ff9800',
    });
  });

  it('matches DON.* regex for DON!! variants', () => {
    const r1 = parseEffectText('[DON!! x1] Effect.', DEFAULT_BRACKET_STYLES);
    expect(r1[0].type).toBe('bracket');
    expect(r1[0].color).toBe('#000000');

    const r2 = parseEffectText('[DON!! x2] Effect.', DEFAULT_BRACKET_STYLES);
    expect(r2[0].color).toBe('#000000');

    const r3 = parseEffectText('[DON!!-2] Effect.', DEFAULT_BRACKET_STYLES);
    expect(r3[0].color).toBe('#000000');
  });

  it('matches Activate: Main pattern', () => {
    const result = parseEffectText(
      '[Activate: Main] Tap this card.',
      DEFAULT_BRACKET_STYLES,
    );
    expect(result[0].color).toBe('#0d47a1');
  });

  it('uses fallback color for unmatched brackets', () => {
    const result = parseEffectText(
      '[Unknown Keyword] Do something.',
      DEFAULT_BRACKET_STYLES,
      '#999999',
    );
    expect(result[0]).toEqual({
      type: 'bracket',
      text: '[Unknown Keyword]',
      color: '#999999',
    });
  });

  it('uses default fallback color when not specified', () => {
    const result = parseEffectText(
      '[SomeRandomThing] text',
      DEFAULT_BRACKET_STYLES,
    );
    expect(result[0].color).toBe(DEFAULT_BRACKET_FALLBACK_COLOR);
  });

  it('matches case-insensitively', () => {
    const result = parseEffectText(
      '[on play] Draw a card.',
      DEFAULT_BRACKET_STYLES,
    );
    expect(result[0].color).toBe('#0d47a1');
  });

  it('uses custom config when provided', () => {
    const custom: BracketStyleConfig = {
      'Custom': '#ff0000',
    };
    const result = parseEffectText('[Custom] text', custom);
    expect(result[0].color).toBe('#ff0000');
  });

  it('custom config does not match default patterns', () => {
    const custom: BracketStyleConfig = {
      'Custom': '#ff0000',
    };
    const result = parseEffectText('[On Play] text', custom);
    // On Play not in custom config, should get fallback
    expect(result[0].color).toBe(DEFAULT_BRACKET_FALLBACK_COLOR);
  });

  it('handles On K.O. pattern with escaped dots', () => {
    const result = parseEffectText(
      '[On K.O.] Trash this card.',
      DEFAULT_BRACKET_STYLES,
    );
    expect(result[0].color).toBe('#6a1b9a');
  });

  it('handles text with no effect (only plain)', () => {
    const result = parseEffectText(
      'This character gains +1000 power.',
      DEFAULT_BRACKET_STYLES,
    );
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('plain');
  });

  it('skips invalid regex patterns gracefully', () => {
    const badConfig: BracketStyleConfig = {
      '[invalid(': '#ff0000',  // malformed regex
      'Valid': '#00ff00',
    };
    // Should not throw
    const result = parseEffectText('[Valid] text', badConfig);
    expect(result[0].color).toBe('#00ff00');
  });
});
