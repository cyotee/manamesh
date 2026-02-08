/**
 * Bracket-text styling for card effect text.
 *
 * Card effect text contains keywords in square brackets like [On Play],
 * [DON!! x1], [Trigger]. This module provides configurable pattern→color
 * mapping with regex support, localStorage persistence, and a parser
 * that splits effect text into styled segments.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Maps regex pattern strings to hex color codes.
 * Patterns are tested against the text INSIDE the brackets (not including [ ]).
 * Key order determines priority — first match wins.
 *
 * Example: { "On Play": "#2e7d32", "DON.*": "#f57f17" }
 */
export type BracketStyleConfig = Record<string, string>;

/** A segment of parsed effect text. */
export interface TextSegment {
  type: 'plain' | 'bracket';
  /** The text content (brackets included for bracket segments). */
  text: string;
  /** Hex background color for bracket segments. null for plain segments. */
  color: string | null;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/** Fallback color for brackets that don't match any configured pattern. */
export const DEFAULT_BRACKET_FALLBACK_COLOR = '#5a4a7a';

export const DEFAULT_BRACKET_STYLES: BracketStyleConfig = {
  // Timing / trigger keywords
  'On Play':           '#0d47a1',  // dark blue (matches Blocker)
  'When Attacking':    '#0d47a1',  // dark blue (matches On Play)
  'On K\\.O\\.':       '#6a1b9a',  // purple
  'On Block':          '#1565c0',  // blue
  'Trigger':           '#fdd835',  // yellow
  'End of Turn':       '#4e342e',  // brown

  // Keyword abilities
  'Rush':              '#b71c1c',  // dark red
  'Blocker':           '#ff9800',  // orange
  'Counter':           '#c62828',  // red

  // DON!! variants (catches DON!! x1, DON!! x2, DON!!-2, etc.)
  'DON.*':             '#000000',  // black

  // Activate abilities (specific before catch-all)
  'Activate:\\s*Main': '#0d47a1',  // dark blue (matches Main)
  'Activate.*':        '#6a1b9a',  // purple

  // Turn restrictions
  'Once Per Turn':     '#37474f',  // blue-grey
  'Your Turn':         '#0d47a1',  // dark blue (matches Main)
  "Opponent's Turn":   '#b71c1c',  // dark red

  // Phase keywords
  'Main':              '#0d47a1',  // dark blue
};

// ---------------------------------------------------------------------------
// localStorage persistence (follows assets/config.ts pattern)
// ---------------------------------------------------------------------------

const STYLES_STORAGE_KEY = 'manamesh-bracket-styles';
const FALLBACK_STORAGE_KEY = 'manamesh-bracket-fallback-color';

let cachedStyles: BracketStyleConfig | null = null;
let cachedFallback: string | null = null;

function loadStylesFromStorage(): BracketStyleConfig | null {
  try {
    const stored = localStorage.getItem(STYLES_STORAGE_KEY);
    if (stored) return JSON.parse(stored);
  } catch { /* ignore */ }
  return null;
}

function loadFallbackFromStorage(): string | null {
  try {
    return localStorage.getItem(FALLBACK_STORAGE_KEY);
  } catch { /* ignore */ }
  return null;
}

export function getBracketStyles(): BracketStyleConfig {
  if (cachedStyles) return cachedStyles;
  cachedStyles = loadStylesFromStorage() ?? { ...DEFAULT_BRACKET_STYLES };
  return cachedStyles;
}

export function getBracketFallbackColor(): string {
  if (cachedFallback) return cachedFallback;
  cachedFallback = loadFallbackFromStorage() ?? DEFAULT_BRACKET_FALLBACK_COLOR;
  return cachedFallback;
}

export function setBracketStyles(styles: BracketStyleConfig): BracketStyleConfig {
  cachedStyles = { ...styles };
  try {
    localStorage.setItem(STYLES_STORAGE_KEY, JSON.stringify(cachedStyles));
  } catch { /* ignore */ }
  return cachedStyles;
}

export function setBracketFallbackColor(color: string): string {
  cachedFallback = color;
  try {
    localStorage.setItem(FALLBACK_STORAGE_KEY, color);
  } catch { /* ignore */ }
  return cachedFallback;
}

export function resetBracketStyles(): BracketStyleConfig {
  cachedStyles = { ...DEFAULT_BRACKET_STYLES };
  cachedFallback = DEFAULT_BRACKET_FALLBACK_COLOR;
  try {
    localStorage.setItem(STYLES_STORAGE_KEY, JSON.stringify(cachedStyles));
    localStorage.setItem(FALLBACK_STORAGE_KEY, cachedFallback);
  } catch { /* ignore */ }
  return cachedStyles;
}

// ---------------------------------------------------------------------------
// Compiled regex cache
// ---------------------------------------------------------------------------

let compiledPatterns: Array<{ regex: RegExp; color: string }> | null = null;
let compiledFromConfig: BracketStyleConfig | null = null;

function getCompiledPatterns(
  config: BracketStyleConfig,
): Array<{ regex: RegExp; color: string }> {
  if (compiledPatterns && compiledFromConfig === config) {
    return compiledPatterns;
  }

  compiledPatterns = [];
  for (const [pattern, color] of Object.entries(config)) {
    try {
      compiledPatterns.push({
        regex: new RegExp(`^${pattern}$`, 'i'),
        color,
      });
    } catch {
      console.warn(`[bracket-styles] Invalid regex pattern: "${pattern}"`);
    }
  }
  compiledFromConfig = config;
  return compiledPatterns;
}

// ---------------------------------------------------------------------------
// Parser
// ---------------------------------------------------------------------------

/**
 * Parse card effect text into segments, splitting on bracket expressions.
 *
 * Example:
 *   parseEffectText("[On Play] Draw 2 cards.")
 *   → [
 *       { type: 'bracket', text: '[On Play]', color: '#2e7d32' },
 *       { type: 'plain',   text: ' Draw 2 cards.', color: null },
 *     ]
 */
export function parseEffectText(
  text: string,
  config?: BracketStyleConfig,
  fallback?: string,
): TextSegment[] {
  if (!text) return [];

  const styles = config ?? getBracketStyles();
  const fallbackColor = fallback ?? getBracketFallbackColor();
  const patterns = getCompiledPatterns(styles);

  const segments: TextSegment[] = [];
  const bracketRegex = /\[([^\]]+)\]/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = bracketRegex.exec(text)) !== null) {
    // Plain text before this bracket
    if (match.index > lastIndex) {
      segments.push({
        type: 'plain',
        text: text.slice(lastIndex, match.index),
        color: null,
      });
    }

    // Find matching color for bracket content
    const innerText = match[1];
    let matchedColor: string | null = null;
    for (const { regex, color } of patterns) {
      if (regex.test(innerText)) {
        matchedColor = color;
        break;
      }
    }

    segments.push({
      type: 'bracket',
      text: match[0],
      color: matchedColor ?? fallbackColor,
    });

    lastIndex = match.index + match[0].length;
  }

  // Remaining plain text
  if (lastIndex < text.length) {
    segments.push({
      type: 'plain',
      text: text.slice(lastIndex),
      color: null,
    });
  }

  return segments;
}
