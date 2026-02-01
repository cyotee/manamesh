/**
 * ChainSelector Component
 *
 * Dropdown for switching between supported chains.
 */

import React from 'react';
import { useChain } from '../hooks/useChain';
import { CHAIN_METADATA } from '../config';

/**
 * Props for ChainSelector
 */
interface ChainSelectorProps {
  /** Callback when chain changes */
  onChainChange?: (chainId: number) => void;
  /** Disable chain switching */
  disabled?: boolean;
  /** Custom styles */
  style?: React.CSSProperties;
  /** Custom class name */
  className?: string;
}

/**
 * Chain selector dropdown.
 *
 * Usage:
 * ```tsx
 * <ChainSelector />
 * <ChainSelector onChainChange={(id) => console.log('Switched to', id)} />
 * ```
 */
export const ChainSelector: React.FC<ChainSelectorProps> = ({
  onChainChange,
  disabled = false,
  style,
  className,
}) => {
  const { chainId, chain, supportedChains, switchChain, isSwitching } = useChain();

  const handleChange = async (event: React.ChangeEvent<HTMLSelectElement>) => {
    const newChainId = parseInt(event.target.value, 10);
    if (newChainId === chainId) return;

    try {
      await switchChain(newChainId);
      onChainChange?.(newChainId);
    } catch (err) {
      console.error('Failed to switch chain:', err);
    }
  };

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '8px',
        ...style,
      }}
      className={className}
    >
      {chain && (
        <span style={{ fontSize: '18px' }}>{CHAIN_METADATA[chain.id]?.icon ?? '⟠'}</span>
      )}
      <select
        value={chainId ?? ''}
        onChange={handleChange}
        disabled={disabled || isSwitching}
        style={{
          padding: '8px 12px',
          fontSize: '14px',
          borderRadius: '4px',
          border: '1px solid #3a3a5c',
          backgroundColor: '#16213e',
          color: '#e4e4e4',
          cursor: disabled || isSwitching ? 'not-allowed' : 'pointer',
          opacity: disabled || isSwitching ? 0.6 : 1,
          minWidth: '140px',
        }}
      >
        {supportedChains.map((c) => (
          <option key={c.id} value={c.id}>
            {c.icon} {c.name}
            {c.isTestnet && ' (Testnet)'}
          </option>
        ))}
      </select>
      {isSwitching && (
        <span style={{ fontSize: '12px', color: '#a0a0a0' }}>Switching...</span>
      )}
    </div>
  );
};

/**
 * Chain badge showing current chain (non-interactive).
 */
export const ChainBadge: React.FC<{
  chainId: number;
  showName?: boolean;
  style?: React.CSSProperties;
}> = ({ chainId, showName = true, style }) => {
  const metadata = CHAIN_METADATA[chainId];

  if (!metadata) {
    return (
      <span
        style={{
          padding: '4px 8px',
          borderRadius: '4px',
          backgroundColor: '#627EEA',
          color: 'white',
          fontSize: '12px',
          ...style,
        }}
      >
        Chain {chainId}
      </span>
    );
  }

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        padding: '4px 8px',
        borderRadius: '4px',
        backgroundColor: metadata.color,
        color: 'white',
        fontSize: '12px',
        fontWeight: 500,
        ...style,
      }}
    >
      <span>{metadata.icon}</span>
      {showName && <span>{metadata.shortName}</span>}
    </span>
  );
};

export default ChainSelector;
