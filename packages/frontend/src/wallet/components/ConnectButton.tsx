/**
 * ConnectButton Component
 *
 * RainbowKit-powered wallet connect button with ManaMesh styling.
 */

import React from 'react';
import { ConnectButton as RainbowConnectButton } from '@rainbow-me/rainbowkit';

/**
 * Props for ConnectButton
 */
interface ConnectButtonProps {
  /** Show balance with address */
  showBalance?: boolean;
  /** Compact mode (address only, no chain) */
  compact?: boolean;
  /** Override styles */
  style?: React.CSSProperties;
  /** Custom class name */
  className?: string;
}

/**
 * Wallet connect button using RainbowKit with ManaMesh theming.
 *
 * Usage:
 * ```tsx
 * <ConnectButton />
 * <ConnectButton compact />
 * <ConnectButton showBalance />
 * ```
 */
export const ConnectButton: React.FC<ConnectButtonProps> = ({
  showBalance = false,
  compact = false,
  style,
  className,
}) => {
  return (
    <div style={style} className={className}>
      <RainbowConnectButton
        accountStatus={compact ? 'avatar' : 'full'}
        chainStatus={compact ? 'none' : 'icon'}
        showBalance={showBalance}
      />
    </div>
  );
};

/**
 * Custom connect button with full control over rendering.
 * Use this when you need to customize the button appearance beyond RainbowKit theming.
 *
 * Usage:
 * ```tsx
 * <CustomConnectButton>
 *   {({ isConnected, address, openConnectModal, openAccountModal }) =>
 *     isConnected ? (
 *       <button onClick={openAccountModal}>{address}</button>
 *     ) : (
 *       <button onClick={openConnectModal}>Connect</button>
 *     )
 *   }
 * </CustomConnectButton>
 * ```
 */
export const CustomConnectButton: React.FC<{
  children: (props: {
    isConnected: boolean;
    address: string | undefined;
    displayName: string | undefined;
    displayBalance: string | undefined;
    chain: { name: string; iconUrl?: string } | undefined;
    openConnectModal: () => void;
    openAccountModal: () => void;
    openChainModal: () => void;
  }) => React.ReactNode;
}> = ({ children }) => {
  return (
    <RainbowConnectButton.Custom>
      {({
        account,
        chain,
        openAccountModal,
        openChainModal,
        openConnectModal,
        mounted,
      }) => {
        const connected = mounted && account && chain;

        return (
          <>
            {(() => {
              if (!mounted) {
                return null;
              }

              return children({
                isConnected: !!connected,
                address: account?.address,
                displayName: account?.displayName,
                displayBalance: account?.displayBalance,
                chain: chain
                  ? { name: chain.name, iconUrl: chain.iconUrl }
                  : undefined,
                openConnectModal,
                openAccountModal,
                openChainModal,
              });
            })()}
          </>
        );
      }}
    </RainbowConnectButton.Custom>
  );
};

export default ConnectButton;
