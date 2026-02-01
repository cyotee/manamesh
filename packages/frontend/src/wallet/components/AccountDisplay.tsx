/**
 * AccountDisplay Component
 *
 * Shows connected wallet address, ENS name, and avatar.
 */

import React from 'react';
import { useAccount, useEnsName, useEnsAvatar } from 'wagmi';
import { mainnet } from 'wagmi/chains';

/**
 * Props for AccountDisplay
 */
interface AccountDisplayProps {
  /** Show full address (default: truncated) */
  fullAddress?: boolean;
  /** Show avatar */
  showAvatar?: boolean;
  /** Show ENS name if available */
  showEns?: boolean;
  /** Custom styles */
  style?: React.CSSProperties;
  /** Custom class name */
  className?: string;
}

/**
 * Format an address for display (0x1234...5678)
 */
function formatAddress(address: string, full = false): string {
  if (full) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * Default avatar placeholder (gradient based on address)
 */
function getDefaultAvatar(address: string): string {
  // Generate a simple gradient background based on address
  const hue1 = parseInt(address.slice(2, 8), 16) % 360;
  const hue2 = parseInt(address.slice(8, 14), 16) % 360;
  return `linear-gradient(135deg, hsl(${hue1}, 70%, 50%), hsl(${hue2}, 70%, 50%))`;
}

/**
 * AccountDisplay component showing wallet info.
 *
 * Usage:
 * ```tsx
 * <AccountDisplay />
 * <AccountDisplay showAvatar showEns />
 * <AccountDisplay fullAddress />
 * ```
 */
export const AccountDisplay: React.FC<AccountDisplayProps> = ({
  fullAddress = false,
  showAvatar = true,
  showEns = true,
  style,
  className,
}) => {
  const { address, isConnected } = useAccount();

  // Fetch ENS name from mainnet
  const { data: ensName } = useEnsName({
    address,
    chainId: mainnet.id,
    query: { enabled: showEns && !!address },
  });

  // Fetch ENS avatar
  const { data: ensAvatar } = useEnsAvatar({
    name: ensName ?? undefined,
    chainId: mainnet.id,
    query: { enabled: showAvatar && !!ensName },
  });

  if (!isConnected || !address) {
    return null;
  }

  const displayName = ensName ?? formatAddress(address, fullAddress);

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        ...style,
      }}
      className={className}
    >
      {showAvatar && (
        <div
          style={{
            width: '24px',
            height: '24px',
            borderRadius: '50%',
            background: ensAvatar ? undefined : getDefaultAvatar(address),
            overflow: 'hidden',
            flexShrink: 0,
          }}
        >
          {ensAvatar && (
            <img
              src={ensAvatar}
              alt=""
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          )}
        </div>
      )}
      <span
        style={{
          fontFamily: 'monospace',
          fontSize: '14px',
          color: '#e4e4e4',
        }}
        title={address}
      >
        {displayName}
      </span>
    </div>
  );
};

/**
 * Minimal address display (just the formatted address)
 */
export const AddressDisplay: React.FC<{
  address: string;
  full?: boolean;
  style?: React.CSSProperties;
}> = ({ address, full = false, style }) => {
  return (
    <span
      style={{
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#e4e4e4',
        ...style,
      }}
      title={address}
    >
      {formatAddress(address, full)}
    </span>
  );
};

export default AccountDisplay;
