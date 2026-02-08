/**
 * CardFilters — Search and filter controls for the card browser
 *
 * Provides text search, color/type/cost/rarity filters, and sorting.
 * Active filters shown as removable chips.
 */

import React, { useCallback } from 'react';
import type { CardFilters as CardFiltersType, CardSortField } from '../../deck/types';

interface CardFiltersProps {
  filters: CardFiltersType;
  onChange: (filters: CardFiltersType) => void;
  availableColors: string[];
  availableTypes: string[];
  availableSets: string[];
  availableRarities: string[];
}

export const CardFilters: React.FC<CardFiltersProps> = ({
  filters,
  onChange,
  availableColors,
  availableTypes,
  availableSets,
  availableRarities,
}) => {
  const update = useCallback(
    (partial: Partial<CardFiltersType>) => {
      onChange({ ...filters, ...partial });
    },
    [filters, onChange],
  );

  const toggleArrayItem = useCallback(
    (key: 'colors' | 'cardTypes' | 'sets' | 'rarities', value: string) => {
      const current = filters[key];
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      update({ [key]: next });
    },
    [filters, update],
  );

  // Collect active filter chips
  const chips: { label: string; onRemove: () => void }[] = [];
  for (const c of filters.colors) {
    chips.push({ label: `Color: ${c}`, onRemove: () => toggleArrayItem('colors', c) });
  }
  for (const t of filters.cardTypes) {
    chips.push({ label: `Type: ${t}`, onRemove: () => toggleArrayItem('cardTypes', t) });
  }
  for (const s of filters.sets) {
    chips.push({ label: `Set: ${s}`, onRemove: () => toggleArrayItem('sets', s) });
  }
  for (const r of filters.rarities) {
    chips.push({ label: `Rarity: ${r}`, onRemove: () => toggleArrayItem('rarities', r) });
  }
  if (filters.costMin != null) {
    chips.push({ label: `Cost >= ${filters.costMin}`, onRemove: () => update({ costMin: null }) });
  }
  if (filters.costMax != null) {
    chips.push({ label: `Cost <= ${filters.costMax}`, onRemove: () => update({ costMax: null }) });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Search */}
      <input
        type="text"
        placeholder="Search cards..."
        value={filters.search}
        onChange={(e) => update({ search: e.target.value })}
        style={{
          padding: '8px 12px',
          backgroundColor: '#16213e',
          border: '1px solid #3a3a5c',
          borderRadius: 6,
          color: '#e4e4e4',
          fontSize: 13,
          outline: 'none',
        }}
      />

      {/* Filter row */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {/* Colors */}
        <FilterGroup
          label="Color"
          options={availableColors}
          selected={filters.colors}
          onToggle={(v) => toggleArrayItem('colors', v)}
          colorMap
        />

        {/* Card types */}
        <FilterGroup
          label="Type"
          options={availableTypes}
          selected={filters.cardTypes}
          onToggle={(v) => toggleArrayItem('cardTypes', v)}
        />

        {/* Cost range */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 11, color: '#8888aa' }}>Cost</span>
          <MiniInput
            placeholder="min"
            value={filters.costMin ?? ''}
            onChange={(v) => update({ costMin: v === '' ? null : Number(v) })}
          />
          <span style={{ color: '#555' }}>-</span>
          <MiniInput
            placeholder="max"
            value={filters.costMax ?? ''}
            onChange={(v) => update({ costMax: v === '' ? null : Number(v) })}
          />
        </div>

        {/* Sort */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ fontSize: 11, color: '#8888aa' }}>Sort</span>
          <select
            value={filters.sortBy}
            onChange={(e) => update({ sortBy: e.target.value as CardSortField })}
            style={selectStyle}
          >
            <option value="cost">Cost</option>
            <option value="name">Name</option>
            <option value="power">Power</option>
            <option value="color">Color</option>
            <option value="set">Set</option>
            <option value="rarity">Rarity</option>
          </select>
          <button
            onClick={() => update({ sortDir: filters.sortDir === 'asc' ? 'desc' : 'asc' })}
            style={{
              padding: '4px 8px',
              backgroundColor: '#3a3a5c',
              border: 'none',
              borderRadius: 4,
              color: '#e4e4e4',
              cursor: 'pointer',
              fontSize: 12,
            }}
          >
            {filters.sortDir === 'asc' ? 'Asc' : 'Desc'}
          </button>
        </div>
      </div>

      {/* Active filter chips */}
      {chips.length > 0 && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {chips.map((chip, i) => (
            <span
              key={i}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                padding: '2px 8px',
                backgroundColor: '#2a2a4a',
                borderRadius: 12,
                fontSize: 11,
                color: '#c0c0e0',
              }}
            >
              {chip.label}
              <button
                onClick={chip.onRemove}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#888',
                  cursor: 'pointer',
                  padding: 0,
                  fontSize: 13,
                  lineHeight: 1,
                }}
              >
                x
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

// --- Sub-components ---

const FilterGroup: React.FC<{
  label: string;
  options: string[];
  selected: string[];
  onToggle: (value: string) => void;
  colorMap?: boolean;
}> = ({ label, options, selected, onToggle, colorMap }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
    <span style={{ fontSize: 11, color: '#8888aa' }}>{label}</span>
    {options.map((opt) => {
      const isActive = selected.includes(opt);
      const bgColor = colorMap ? colorToHex(opt) : (isActive ? '#4a4a7a' : '#2a2a4a');
      return (
        <button
          key={opt}
          onClick={() => onToggle(opt)}
          style={{
            padding: '3px 8px',
            fontSize: 11,
            backgroundColor: bgColor,
            color: '#e4e4e4',
            border: isActive ? '1px solid #8888cc' : '1px solid transparent',
            borderRadius: 4,
            cursor: 'pointer',
            textTransform: 'capitalize',
            opacity: isActive ? 1 : 0.6,
          }}
        >
          {opt}
        </button>
      );
    })}
  </div>
);

const MiniInput: React.FC<{
  placeholder: string;
  value: string | number;
  onChange: (value: string) => void;
}> = ({ placeholder, value, onChange }) => (
  <input
    type="number"
    placeholder={placeholder}
    value={value}
    onChange={(e) => onChange(e.target.value)}
    style={{
      width: 40,
      padding: '4px 6px',
      backgroundColor: '#16213e',
      border: '1px solid #3a3a5c',
      borderRadius: 4,
      color: '#e4e4e4',
      fontSize: 11,
      outline: 'none',
    }}
  />
);

const selectStyle: React.CSSProperties = {
  padding: '4px 8px',
  backgroundColor: '#16213e',
  border: '1px solid #3a3a5c',
  borderRadius: 4,
  color: '#e4e4e4',
  fontSize: 11,
  outline: 'none',
};

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
