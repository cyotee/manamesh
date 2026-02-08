/**
 * Asset Pack Management Page
 *
 * Standalone page for managing asset packs outside of the deck builder.
 * Features: view loaded/stored packs, delete individual packs, IPFS import.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  getStoredPacks,
  getAllLoadedPacks,
  loadPack,
  unloadPack,
  type StoredPackMetadata,
  type LoadedAssetPack,
} from '../assets/loader';
import { clearPackCache } from '../assets/loader/cache';

interface AssetPackManagementProps {
  onBack: () => void;
}

export const AssetPackManagement: React.FC<AssetPackManagementProps> = ({ onBack }) => {
  const [storedPacks, setStoredPacks] = useState<StoredPackMetadata[]>([]);
  const [loadedPacks, setLoadedPacks] = useState<LoadedAssetPack[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [ipfsCid, setIpfsCid] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const CID_REGEX = /^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{58,})$/i;

  const refresh = useCallback(async () => {
    const [stored, loaded] = await Promise.all([
      getStoredPacks(),
      Promise.resolve(getAllLoadedPacks()),
    ]);
    setStoredPacks(stored);
    setLoadedPacks(loaded);
  }, []);

  useEffect(() => {
    refresh().finally(() => setIsLoading(false));
  }, [refresh]);

  const handleImportIpfs = useCallback(async () => {
    const trimmed = ipfsCid.trim();
    if (!CID_REGEX.test(trimmed)) {
      setImportError('Invalid IPFS CID format');
      return;
    }

    setIsImporting(true);
    setImportError(null);
    setImportSuccess(null);

    try {
      await loadPack({ type: 'ipfs-zip', cid: trimmed });
      setImportSuccess(`Imported pack from IPFS: ${trimmed.slice(0, 12)}...`);
      setIpfsCid('');
      await refresh();
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setIsImporting(false);
    }
  }, [ipfsCid, refresh]);

  const handleDeletePack = useCallback(async (packId: string) => {
    unloadPack(packId);
    await clearPackCache(packId);
    setDeleteConfirm(null);
    await refresh();
  }, [refresh]);

  const getPackCid = (pack: StoredPackMetadata): string | null => {
    const source = pack.source;
    if (!source || typeof source !== 'object') return null;
    if ('cid' in source && typeof (source as any).cid === 'string') {
      return (source as any).cid;
    }
    return null;
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Ignore clipboard errors
    }
  };

  const formatDate = (ts: number) => new Date(ts).toLocaleDateString();

  // --- Styles ---

  const containerStyle: React.CSSProperties = {
    padding: '40px',
    maxWidth: '800px',
    margin: '0 auto',
    fontFamily: 'system-ui, sans-serif',
  };

  const cardStyle: React.CSSProperties = {
    backgroundColor: '#16213e',
    padding: '20px',
    borderRadius: '12px',
    marginBottom: '16px',
    border: '1px solid #3a3a5c',
  };

  const buttonStyle: React.CSSProperties = {
    padding: '10px 20px',
    fontSize: '14px',
    cursor: 'pointer',
    color: 'white',
    border: 'none',
    borderRadius: '6px',
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 12px',
    fontSize: '14px',
    backgroundColor: '#1a1a2e',
    color: '#e4e4e4',
    border: '1px solid #3a3a5c',
    borderRadius: '6px',
    fontFamily: 'monospace',
    boxSizing: 'border-box',
  };

  return (
    <div style={containerStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <h1 style={{ color: '#e4e4e4', margin: 0 }}>Asset Pack Manager</h1>
        <button
          onClick={onBack}
          style={{ ...buttonStyle, backgroundColor: '#3a3a5c' }}
        >
          Back
        </button>
      </div>

      {/* IPFS Import */}
      <div style={cardStyle}>
        <h3 style={{ color: '#e4e4e4', marginTop: 0, marginBottom: '12px' }}>Import by IPFS Hash</h3>
        <div style={{ display: 'flex', gap: '8px' }}>
          <input
            style={{ ...inputStyle, flex: 1 }}
            placeholder="Enter IPFS CID (e.g. Qm...)"
            value={ipfsCid}
            onChange={(e) => {
              setIpfsCid(e.target.value);
              setImportError(null);
            }}
            disabled={isImporting}
          />
          <button
            onClick={handleImportIpfs}
            disabled={!ipfsCid.trim() || isImporting}
            style={{
              ...buttonStyle,
              backgroundColor: '#7c4dff',
              opacity: !ipfsCid.trim() || isImporting ? 0.5 : 1,
              cursor: !ipfsCid.trim() || isImporting ? 'not-allowed' : 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {isImporting ? 'Importing...' : 'Import'}
          </button>
        </div>
        {importError && (
          <div style={{ color: '#ff6b6b', fontSize: '12px', marginTop: '6px' }}>{importError}</div>
        )}
        {importSuccess && (
          <div style={{ color: '#6fcf6f', fontSize: '12px', marginTop: '6px' }}>{importSuccess}</div>
        )}
      </div>

      {/* Pack list */}
      <div style={cardStyle}>
        <h3 style={{ color: '#e4e4e4', marginTop: 0, marginBottom: '12px' }}>
          Stored Packs ({storedPacks.length})
        </h3>

        {isLoading ? (
          <div style={{ color: '#a0a0a0', textAlign: 'center', padding: '20px' }}>Loading...</div>
        ) : storedPacks.length === 0 ? (
          <div style={{ color: '#a0a0a0', textAlign: 'center', padding: '20px' }}>
            No asset packs stored. Import one via IPFS hash or upload in the Deck Builder.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {storedPacks.map((pack) => {
              const cid = getPackCid(pack);
              const isLoaded = loadedPacks.some((lp) => lp.id === pack.id);

              return (
                <div
                  key={pack.id}
                  style={{
                    backgroundColor: '#1a1a2e',
                    padding: '12px 16px',
                    borderRadius: '8px',
                    border: '1px solid #3a3a5c',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ color: '#e4e4e4', fontWeight: 600 }}>{pack.name}</div>
                      <div style={{ color: '#a0a0a0', fontSize: '12px', marginTop: '2px' }}>
                        {pack.cardCount} cards
                        {pack.game && pack.game !== 'unknown' && ` | ${pack.game}`}
                        {pack.loadedAt && ` | Stored ${formatDate(pack.loadedAt)}`}
                      </div>

                      {/* Source info */}
                      <div style={{ fontSize: '11px', color: '#666', marginTop: '4px' }}>
                        ID: <span style={{ fontFamily: 'monospace' }}>{pack.id.length > 40 ? pack.id.slice(0, 40) + '...' : pack.id}</span>
                      </div>

                      {cid && (
                        <div style={{
                          fontSize: '11px',
                          color: '#7c4dff',
                          marginTop: '2px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '6px',
                        }}>
                          IPFS: <span style={{ fontFamily: 'monospace' }}>{cid.slice(0, 16)}...{cid.slice(-6)}</span>
                          <button
                            onClick={() => copyToClipboard(cid)}
                            style={{
                              padding: '1px 6px',
                              fontSize: '10px',
                              backgroundColor: '#3a3a5c',
                              color: '#a0a0a0',
                              border: 'none',
                              borderRadius: '3px',
                              cursor: 'pointer',
                            }}
                          >
                            Copy
                          </button>
                        </div>
                      )}
                    </div>

                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                      {isLoaded && (
                        <span style={{
                          fontSize: '10px',
                          padding: '2px 6px',
                          backgroundColor: '#1a4a3a',
                          color: '#6fcf6f',
                          borderRadius: '4px',
                        }}>
                          Loaded
                        </span>
                      )}

                      {deleteConfirm === pack.id ? (
                        <>
                          <button
                            onClick={() => handleDeletePack(pack.id)}
                            style={{ ...buttonStyle, backgroundColor: '#d32f2f', padding: '4px 10px', fontSize: '12px' }}
                          >
                            Confirm
                          </button>
                          <button
                            onClick={() => setDeleteConfirm(null)}
                            style={{ ...buttonStyle, backgroundColor: '#3a3a5c', padding: '4px 10px', fontSize: '12px' }}
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => setDeleteConfirm(pack.id)}
                          style={{ ...buttonStyle, backgroundColor: '#4a1a1a', padding: '4px 10px', fontSize: '12px' }}
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
