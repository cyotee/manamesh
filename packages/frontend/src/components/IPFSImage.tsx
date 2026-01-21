/**
 * React component for displaying images loaded from IPFS
 * Shows loading state, handles errors with retry, caches for offline use
 */

import React, { useState, useEffect, useCallback } from 'react';
import { loadAssetUrl, preloadAssets, type LoadResult } from '../assets';

export interface IPFSImageProps {
  /** IPFS CID of the image */
  cid: string;
  /** Alt text for the image */
  alt: string;
  /** Optional CSS class name */
  className?: string;
  /** Optional inline styles */
  style?: React.CSSProperties;
  /** Width of the image */
  width?: number | string;
  /** Height of the image */
  height?: number | string;
  /** Placeholder to show while loading */
  placeholder?: React.ReactNode;
  /** Error fallback to show on failure */
  errorFallback?: React.ReactNode;
  /** Callback when image loads successfully */
  onLoad?: (source: LoadResult['source']) => void;
  /** Callback when image fails to load */
  onError?: (error: Error) => void;
  /** Prefer gateway over helia */
  preferGateway?: boolean;
  /** Custom timeout in ms */
  timeout?: number;
}

type LoadState = 'idle' | 'loading' | 'loaded' | 'error';

export const IPFSImage: React.FC<IPFSImageProps> = ({
  cid,
  alt,
  className,
  style,
  width,
  height,
  placeholder,
  errorFallback,
  onLoad,
  onError,
  preferGateway = false,
  timeout,
}) => {
  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [source, setSource] = useState<LoadResult['source'] | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  const loadImage = useCallback(async () => {
    if (!cid) return;

    setLoadState('loading');
    setError(null);

    try {
      // Clean up previous URL if exists
      if (imageUrl) {
        URL.revokeObjectURL(imageUrl);
      }

      const result = await loadAssetUrl(cid, {
        preferGateway,
        timeout,
      });

      setImageUrl(result.url);
      setSource(result.source);
      setLoadState('loaded');
      onLoad?.(result.source);
    } catch (err) {
      const loadError = err instanceof Error ? err : new Error(String(err));
      setError(loadError);
      setLoadState('error');
      onError?.(loadError);
    }
  }, [cid, preferGateway, timeout, onLoad, onError]);

  // Load image when CID changes
  useEffect(() => {
    loadImage();

    // Cleanup object URL on unmount
    return () => {
      if (imageUrl) {
        URL.revokeObjectURL(imageUrl);
      }
    };
  }, [cid, retryCount]); // loadImage excluded to avoid infinite loop

  const handleRetry = useCallback(() => {
    setRetryCount(prev => prev + 1);
  }, []);

  // Default placeholder
  const defaultPlaceholder = (
    <div
      style={{
        width: width || 100,
        height: height || 100,
        backgroundColor: '#2a2a4a',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: '4px',
        ...style,
      }}
      className={className}
    >
      <div
        style={{
          width: '30%',
          height: '30%',
          border: '2px solid #6a6a8a',
          borderTopColor: '#4a9eff',
          borderRadius: '50%',
          animation: 'spin 1s linear infinite',
        }}
      />
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );

  // Default error fallback
  const defaultErrorFallback = (
    <div
      style={{
        width: width || 100,
        height: height || 100,
        backgroundColor: '#3a2a2a',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: '4px',
        color: '#ff6b6b',
        fontSize: '12px',
        padding: '8px',
        textAlign: 'center',
        ...style,
      }}
      className={className}
    >
      <span style={{ marginBottom: '4px' }}>⚠️</span>
      <span style={{ marginBottom: '8px' }}>Failed to load</span>
      <button
        onClick={handleRetry}
        style={{
          padding: '4px 8px',
          fontSize: '10px',
          backgroundColor: '#4a4a6a',
          color: '#e4e4e4',
          border: 'none',
          borderRadius: '4px',
          cursor: 'pointer',
        }}
      >
        Retry
      </button>
    </div>
  );

  if (loadState === 'loading' || loadState === 'idle') {
    return <>{placeholder || defaultPlaceholder}</>;
  }

  if (loadState === 'error') {
    return <>{errorFallback || defaultErrorFallback}</>;
  }

  return (
    <img
      src={imageUrl!}
      alt={alt}
      className={className}
      style={style}
      width={width}
      height={height}
      data-cid={cid}
      data-source={source}
    />
  );
};

/**
 * Hook for preloading deck images with progress tracking
 */
export function usePreloadImages(cids: string[]) {
  const [loaded, setLoaded] = useState(0);
  const [total, setTotal] = useState(0);
  const [currentCid, setCurrentCid] = useState<string | null>(null);
  const [isComplete, setIsComplete] = useState(false);
  const [errors, setErrors] = useState<Map<string, Error>>(new Map());

  const preload = useCallback(async () => {
    if (cids.length === 0) {
      setIsComplete(true);
      return;
    }

    setLoaded(0);
    setTotal(cids.length);
    setIsComplete(false);
    setErrors(new Map());

    const results = await preloadAssets(
      cids,
      {},
      (loadedCount, totalCount, current) => {
        setLoaded(loadedCount);
        setTotal(totalCount);
        setCurrentCid(current);
      }
    );

    // Collect errors
    const errorMap = new Map<string, Error>();
    results.forEach((result, cid) => {
      if (result instanceof Error) {
        errorMap.set(cid, result);
      }
    });
    setErrors(errorMap);
    setIsComplete(true);
    setCurrentCid(null);
  }, [cids]);

  // Start preloading when cids change
  useEffect(() => {
    preload();
  }, [preload]);

  return {
    loaded,
    total,
    currentCid,
    isComplete,
    errors,
    progress: total > 0 ? (loaded / total) * 100 : 0,
    retry: preload,
  };
}

/**
 * Preload progress indicator component
 */
export interface PreloadProgressProps {
  cids: string[];
  onComplete?: () => void;
  showDetails?: boolean;
}

export const PreloadProgress: React.FC<PreloadProgressProps> = ({
  cids,
  onComplete,
  showDetails = false,
}) => {
  const { loaded, total, progress, isComplete, errors } = usePreloadImages(cids);

  useEffect(() => {
    if (isComplete) {
      onComplete?.();
    }
  }, [isComplete, onComplete]);

  if (isComplete && errors.size === 0) {
    return null;
  }

  return (
    <div
      style={{
        padding: '16px',
        backgroundColor: '#16213e',
        borderRadius: '8px',
        marginBottom: '16px',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          marginBottom: '8px',
          color: '#e4e4e4',
        }}
      >
        <span>Loading assets...</span>
        <span>
          {loaded}/{total}
        </span>
      </div>
      <div
        style={{
          height: '8px',
          backgroundColor: '#2a2a4a',
          borderRadius: '4px',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${progress}%`,
            backgroundColor: errors.size > 0 ? '#ff9800' : '#4CAF50',
            transition: 'width 0.3s ease',
          }}
        />
      </div>
      {showDetails && errors.size > 0 && (
        <div
          style={{
            marginTop: '8px',
            fontSize: '12px',
            color: '#ff6b6b',
          }}
        >
          {errors.size} asset(s) failed to load
        </div>
      )}
    </div>
  );
};

export default IPFSImage;
