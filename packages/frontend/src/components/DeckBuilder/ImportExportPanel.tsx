/**
 * ImportExportPanel — YAML/TOML/IPFS deck import and export
 *
 * Provides buttons to export the current deck to YAML/TOML files,
 * and a text area / file input for importing deck lists.
 */

import React, { useState, useCallback, useRef } from 'react';
import type { DeckList, DeckListExport } from '../../deck/types';
import {
  exportToYaml,
  exportToToml,
  importFromText,
  exportToDeckList,
  downloadFile,
  readFileAsText,
} from '../../deck/serialization';

interface ImportExportPanelProps {
  deck: DeckList;
  packId: string;
  onImport: (deck: DeckList) => void;
}

export const ImportExportPanel: React.FC<ImportExportPanelProps> = ({
  deck,
  packId,
  onImport,
}) => {
  const [importText, setImportText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [showImport, setShowImport] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExportYaml = useCallback(() => {
    const yaml = exportToYaml(deck);
    const safeName = deck.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    downloadFile(yaml, `${safeName}.yaml`, 'text/yaml');
  }, [deck]);

  const handleExportToml = useCallback(() => {
    const toml = exportToToml(deck);
    const safeName = deck.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    downloadFile(toml, `${safeName}.toml`, 'text/toml');
  }, [deck]);

  const handleImportText = useCallback(() => {
    setError(null);
    try {
      const imported = importFromText(importText);
      const deckList = exportToDeckList(imported, packId);
      onImport(deckList);
      setImportText('');
      setShowImport(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [importText, packId, onImport]);

  const handleImportFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setError(null);
      try {
        const text = await readFileAsText(file);
        const imported = importFromText(text);
        const deckList = exportToDeckList(imported, packId);
        onImport(deckList);
        setShowImport(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }

      // Reset input
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
    [packId, onImport],
  );

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      padding: 8,
    }}>
      {/* Export buttons */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <ActionButton label="Export YAML" onClick={handleExportYaml} />
        <ActionButton label="Export TOML" onClick={handleExportToml} />
        <ActionButton
          label={showImport ? 'Cancel' : 'Import'}
          color={showImport ? '#666' : '#2196F3'}
          onClick={() => {
            setShowImport(!showImport);
            setError(null);
          }}
        />
      </div>

      {/* Import panel */}
      {showImport && (
        <div style={{
          padding: 8,
          backgroundColor: '#16213e',
          borderRadius: 6,
          border: '1px solid #3a3a5c',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <label style={{
              padding: '6px 12px',
              backgroundColor: '#3a3a5c',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: 12,
              color: '#e4e4e4',
            }}>
              Upload File
              <input
                ref={fileInputRef}
                type="file"
                accept=".yaml,.yml,.toml,.txt"
                onChange={handleImportFile}
                style={{ display: 'none' }}
              />
            </label>
            <span style={{ fontSize: 11, color: '#666', lineHeight: '28px' }}>or paste below</span>
          </div>

          <textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder="Paste YAML or TOML deck list here..."
            rows={6}
            style={{
              backgroundColor: '#0f172a',
              border: '1px solid #3a3a5c',
              borderRadius: 4,
              color: '#e4e4e4',
              fontSize: 12,
              fontFamily: 'monospace',
              padding: 8,
              resize: 'vertical',
              outline: 'none',
            }}
          />

          <button
            onClick={handleImportText}
            disabled={!importText.trim()}
            style={{
              padding: '6px 12px',
              backgroundColor: importText.trim() ? '#4CAF50' : '#333',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              cursor: importText.trim() ? 'pointer' : 'not-allowed',
              fontSize: 12,
            }}
          >
            Import Deck
          </button>

          {error && (
            <div style={{
              padding: 6,
              backgroundColor: 'rgba(244, 67, 54, 0.15)',
              border: '1px solid #f44336',
              borderRadius: 4,
              fontSize: 11,
              color: '#ff6b6b',
            }}>
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const ActionButton: React.FC<{
  label: string;
  color?: string;
  onClick: () => void;
}> = ({ label, color = '#3a3a5c', onClick }) => (
  <button
    onClick={onClick}
    style={{
      padding: '6px 12px',
      backgroundColor: color,
      color: '#e4e4e4',
      border: 'none',
      borderRadius: 4,
      cursor: 'pointer',
      fontSize: 12,
    }}
  >
    {label}
  </button>
);
