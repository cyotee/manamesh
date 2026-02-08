/**
 * AssetPackUpload — Local file/directory upload UI
 *
 * Allows users to upload a local zip archive or select a directory
 * to load as an asset pack for the deck builder.
 */

import React, { useState, useRef, useCallback } from 'react';
import { loadLocalZip, loadLocalDirectory } from '../../assets/loader/local-loader';
import { loadPack } from '../../assets/loader';
import type { LoadedAssetPack, IPFSZipSource } from '../../assets/loader/types';

interface AssetPackUploadProps {
  onPackLoaded: (pack: LoadedAssetPack) => void;
}

export const AssetPackUpload: React.FC<AssetPackUploadProps> = ({ onPackLoaded }) => {
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [ipfsCid, setIpfsCid] = useState('');
  const [isLoadingIpfs, setIsLoadingIpfs] = useState(false);
  const zipInputRef = useRef<HTMLInputElement>(null);
  const dirInputRef = useRef<HTMLInputElement>(null);

  const handleProgress = useCallback((loaded: number, total: number) => {
    setProgress(Math.round((loaded / total) * 100));
  }, []);

  const handleZipUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setIsLoading(true);
      setError(null);
      setProgress(0);

      try {
        const pack = await loadLocalZip(file, handleProgress);
        onPackLoaded(pack);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setIsLoading(false);
        // Reset input so the same file can be re-selected
        if (zipInputRef.current) zipInputRef.current.value = '';
      }
    },
    [onPackLoaded, handleProgress],
  );

  const handleDirectoryUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;

      setIsLoading(true);
      setError(null);
      setProgress(0);

      try {
        const pack = await loadLocalDirectory(files, handleProgress);
        onPackLoaded(pack);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setIsLoading(false);
        if (dirInputRef.current) dirInputRef.current.value = '';
      }
    },
    [onPackLoaded, handleProgress],
  );

  const handleIpfsImport = useCallback(async () => {
    const cid = ipfsCid.trim();
    if (!cid) return;

    // Basic CID format validation (CIDv0: Qm..., CIDv1: bafy...)
    if (!/^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{58,})$/i.test(cid)) {
      setError('Invalid IPFS CID format. Expected CIDv0 (Qm...) or CIDv1 (bafy...)');
      return;
    }

    setIsLoadingIpfs(true);
    setError(null);
    try {
      const source: IPFSZipSource = { type: 'ipfs-zip', cid };
      const pack = await loadPack(source, { preferGateway: true });
      onPackLoaded(pack);
      setIpfsCid('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoadingIpfs(false);
    }
  }, [ipfsCid, onPackLoaded]);

  return (
    <div style={{
      padding: 16,
      backgroundColor: '#1a1a2e',
      borderRadius: 8,
      border: '1px solid #3a3a5c',
    }}>
      <h3 style={{ margin: '0 0 12px', color: '#e4e4e4', fontSize: 14 }}>
        Load Asset Pack
      </h3>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {/* Zip upload */}
        <label
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 16px',
            backgroundColor: '#2196F3',
            color: '#fff',
            borderRadius: 6,
            cursor: isLoading ? 'not-allowed' : 'pointer',
            opacity: isLoading ? 0.6 : 1,
            fontSize: 13,
          }}
        >
          Upload Zip
          <input
            ref={zipInputRef}
            type="file"
            accept=".zip"
            onChange={handleZipUpload}
            disabled={isLoading}
            style={{ display: 'none' }}
          />
        </label>

        {/* Directory upload */}
        <label
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 16px',
            backgroundColor: '#4CAF50',
            color: '#fff',
            borderRadius: 6,
            cursor: isLoading ? 'not-allowed' : 'pointer',
            opacity: isLoading ? 0.6 : 1,
            fontSize: 13,
          }}
        >
          Select Directory
          <input
            ref={dirInputRef}
            type="file"
            {...({ webkitdirectory: '', directory: '' } as any)}
            onChange={handleDirectoryUpload}
            disabled={isLoading}
            style={{ display: 'none' }}
          />
        </label>
      </div>

      {/* IPFS hash import */}
      <div style={{ marginTop: 12 }}>
        <div style={{ fontSize: 12, color: '#8888aa', marginBottom: 4 }}>
          Import by IPFS Hash
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="text"
            value={ipfsCid}
            onChange={(e) => setIpfsCid(e.target.value)}
            placeholder="Qm... or bafy..."
            disabled={isLoadingIpfs}
            style={{
              flex: 1,
              padding: '8px 10px',
              backgroundColor: '#0f172a',
              color: '#e4e4e4',
              border: '1px solid #3a3a5c',
              borderRadius: 6,
              fontSize: 12,
              fontFamily: 'monospace',
            }}
            onKeyDown={(e) => { if (e.key === 'Enter') handleIpfsImport(); }}
          />
          <button
            onClick={handleIpfsImport}
            disabled={isLoadingIpfs || !ipfsCid.trim()}
            style={{
              padding: '8px 16px',
              backgroundColor: isLoadingIpfs || !ipfsCid.trim() ? '#333' : '#9C27B0',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              cursor: isLoadingIpfs || !ipfsCid.trim() ? 'not-allowed' : 'pointer',
              fontSize: 12,
              whiteSpace: 'nowrap',
            }}
          >
            {isLoadingIpfs ? 'Loading...' : 'Import'}
          </button>
        </div>
      </div>

      {/* Progress bar */}
      {isLoading && (
        <div style={{ marginTop: 12 }}>
          <div style={{
            height: 6,
            backgroundColor: '#2a2a4a',
            borderRadius: 3,
            overflow: 'hidden',
          }}>
            <div style={{
              width: `${progress}%`,
              height: '100%',
              backgroundColor: '#4CAF50',
              transition: 'width 200ms',
            }} />
          </div>
          <div style={{ fontSize: 11, color: '#8888aa', marginTop: 4 }}>
            Loading... {progress}%
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{
          marginTop: 12,
          padding: 8,
          backgroundColor: 'rgba(244, 67, 54, 0.15)',
          border: '1px solid #f44336',
          borderRadius: 4,
          fontSize: 12,
          color: '#ff6b6b',
        }}>
          {error}
        </div>
      )}
    </div>
  );
};
