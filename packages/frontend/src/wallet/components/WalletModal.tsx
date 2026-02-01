/**
 * WalletModal Component
 *
 * Full wallet management modal with connection, chain, and account info.
 */

import React, { useState } from 'react';
import { useWallet } from '../hooks/useWallet';
import { useChain } from '../hooks/useChain';
import { AccountDisplay } from './AccountDisplay';
import { ChainSelector, ChainBadge } from './ChainSelector';
import { ConnectButton, CustomConnectButton } from './ConnectButton';

/**
 * Props for WalletModal
 */
interface WalletModalProps {
  /** Whether the modal is open */
  isOpen: boolean;
  /** Close modal callback */
  onClose: () => void;
  /** Show chain selector */
  showChainSelector?: boolean;
}

/**
 * Full wallet management modal.
 *
 * Usage:
 * ```tsx
 * const [showModal, setShowModal] = useState(false);
 *
 * <button onClick={() => setShowModal(true)}>Wallet</button>
 * <WalletModal isOpen={showModal} onClose={() => setShowModal(false)} />
 * ```
 */
export const WalletModal: React.FC<WalletModalProps> = ({
  isOpen,
  onClose,
  showChainSelector = true,
}) => {
  const { isConnected, wallet, disconnect } = useWallet();
  const { chain } = useChain();

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.7)',
          zIndex: 1000,
        }}
      />

      {/* Modal */}
      <div
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          backgroundColor: '#16213e',
          border: '1px solid #3a3a5c',
          borderRadius: '12px',
          padding: '24px',
          minWidth: '320px',
          maxWidth: '400px',
          zIndex: 1001,
          color: '#e4e4e4',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '24px',
          }}
        >
          <h2 style={{ margin: 0, fontSize: '20px' }}>Wallet</h2>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: '#a0a0a0',
              fontSize: '24px',
              cursor: 'pointer',
              padding: '4px',
              lineHeight: 1,
            }}
          >
            &times;
          </button>
        </div>

        {/* Content */}
        {isConnected && wallet ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {/* Account */}
            <div
              style={{
                backgroundColor: '#0f3460',
                padding: '16px',
                borderRadius: '8px',
              }}
            >
              <div style={{ marginBottom: '8px', fontSize: '12px', color: '#a0a0a0' }}>
                Connected Account
              </div>
              <AccountDisplay showAvatar showEns />
            </div>

            {/* Chain */}
            {showChainSelector && (
              <div
                style={{
                  backgroundColor: '#0f3460',
                  padding: '16px',
                  borderRadius: '8px',
                }}
              >
                <div style={{ marginBottom: '8px', fontSize: '12px', color: '#a0a0a0' }}>
                  Network
                </div>
                <ChainSelector />
              </div>
            )}

            {/* Provider */}
            <div style={{ fontSize: '12px', color: '#a0a0a0' }}>
              Connected via {wallet.connectorName}
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: '12px' }}>
              <button
                onClick={() => {
                  // Copy address to clipboard
                  navigator.clipboard.writeText(wallet.address);
                }}
                style={{
                  flex: 1,
                  padding: '12px',
                  backgroundColor: '#3a3a5c',
                  border: 'none',
                  borderRadius: '8px',
                  color: '#e4e4e4',
                  cursor: 'pointer',
                  fontSize: '14px',
                }}
              >
                Copy Address
              </button>
              <button
                onClick={() => {
                  disconnect();
                  onClose();
                }}
                style={{
                  flex: 1,
                  padding: '12px',
                  backgroundColor: '#dc3545',
                  border: 'none',
                  borderRadius: '8px',
                  color: 'white',
                  cursor: 'pointer',
                  fontSize: '14px',
                }}
              >
                Disconnect
              </button>
            </div>
          </div>
        ) : (
          <div style={{ textAlign: 'center' }}>
            <p style={{ marginBottom: '20px', color: '#a0a0a0' }}>
              Connect your wallet to play
            </p>
            <ConnectButton />
          </div>
        )}
      </div>
    </>
  );
};

/**
 * Compact wallet button that opens the modal.
 */
export const WalletButton: React.FC<{
  style?: React.CSSProperties;
}> = ({ style }) => {
  const [isOpen, setIsOpen] = useState(false);
  const { isConnected, wallet } = useWallet();
  const { chain } = useChain();

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '8px 16px',
          backgroundColor: isConnected ? '#0f3460' : '#4CAF50',
          border: '1px solid #3a3a5c',
          borderRadius: '8px',
          color: '#e4e4e4',
          cursor: 'pointer',
          fontSize: '14px',
          ...style,
        }}
      >
        {isConnected && wallet ? (
          <>
            {chain && <ChainBadge chainId={chain.id} showName={false} />}
            <span style={{ fontFamily: 'monospace' }}>
              {wallet.address.slice(0, 6)}...{wallet.address.slice(-4)}
            </span>
          </>
        ) : (
          'Connect Wallet'
        )}
      </button>
      <WalletModal isOpen={isOpen} onClose={() => setIsOpen(false)} />
    </>
  );
};

export default WalletModal;
