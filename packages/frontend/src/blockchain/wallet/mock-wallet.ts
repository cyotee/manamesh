/**
 * Mock Wallet Provider
 *
 * Simulates wallet connection and signing for demo purposes.
 * Proves the P2P + secure encryption flow without real blockchain integration.
 */

import type {
  WalletProvider,
  WalletStatus,
  ConnectedWallet,
  DerivedGameKeys,
} from './types';

/**
 * Generate a deterministic mock address from a seed
 */
function generateMockAddress(seed: string): string {
  // Simple hash to create pseudo-random but deterministic address
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
  }

  // Generate 20 bytes (40 hex chars) for address
  const addressBytes: string[] = [];
  for (let i = 0; i < 20; i++) {
    hash = ((hash * 1103515245 + 12345) | 0) >>> 0;
    addressBytes.push((hash & 0xff).toString(16).padStart(2, '0'));
  }

  return '0x' + addressBytes.join('');
}

/**
 * Generate a deterministic signature from message and private key
 */
function generateMockSignature(message: string, privateKey: string): string {
  // Combine message and key for deterministic signature
  const combined = message + privateKey;
  let hash = 0;
  for (let i = 0; i < combined.length; i++) {
    hash = ((hash << 5) - hash + combined.charCodeAt(i)) | 0;
  }

  // Generate 65 bytes (130 hex chars) for signature (r, s, v)
  const sigBytes: string[] = [];
  for (let i = 0; i < 65; i++) {
    hash = ((hash * 1103515245 + 12345) | 0) >>> 0;
    sigBytes.push((hash & 0xff).toString(16).padStart(2, '0'));
  }

  return '0x' + sigBytes.join('');
}

/**
 * Mock wallet provider for demo/testing
 */
export class MockWalletProvider implements WalletProvider {
  private status: WalletStatus = 'disconnected';
  private wallet: ConnectedWallet | null = null;
  private privateKey: string;
  private accountChangeCallbacks: ((address: string | null) => void)[] = [];
  private chainChangeCallbacks: ((chainId: number) => void)[] = [];

  constructor(
    private playerName: string = 'Player',
    private chainId: number = 1
  ) {
    // Generate deterministic private key from player name
    this.privateKey = this.generatePrivateKey(playerName);
  }

  private generatePrivateKey(seed: string): string {
    let hash = 0;
    for (let i = 0; i < seed.length; i++) {
      hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0;
    }

    const keyBytes: string[] = [];
    for (let i = 0; i < 32; i++) {
      hash = ((hash * 1103515245 + 12345) | 0) >>> 0;
      keyBytes.push((hash & 0xff).toString(16).padStart(2, '0'));
    }

    return keyBytes.join('');
  }

  async connect(): Promise<ConnectedWallet> {
    this.status = 'connecting';

    // Simulate connection delay
    await new Promise((resolve) => setTimeout(resolve, 100));

    const address = generateMockAddress(this.playerName);

    this.wallet = {
      address,
      chainId: this.chainId,
      providerName: 'MockWallet',
    };

    this.status = 'connected';

    console.log(`[MockWallet] Connected: ${address} (${this.playerName})`);

    return this.wallet;
  }

  async disconnect(): Promise<void> {
    const wasConnected = this.wallet !== null;
    this.wallet = null;
    this.status = 'disconnected';

    if (wasConnected) {
      this.accountChangeCallbacks.forEach((cb) => cb(null));
    }

    console.log('[MockWallet] Disconnected');
  }

  async signMessage(message: string): Promise<string> {
    if (!this.wallet) {
      throw new Error('Wallet not connected');
    }

    // Simulate signing delay
    await new Promise((resolve) => setTimeout(resolve, 50));

    const signature = generateMockSignature(message, this.privateKey);

    console.log(`[MockWallet] Signed message: "${message.slice(0, 50)}..."`);

    return signature;
  }

  getStatus(): WalletStatus {
    return this.status;
  }

  getWallet(): ConnectedWallet | null {
    return this.wallet;
  }

  onAccountChange(callback: (address: string | null) => void): () => void {
    this.accountChangeCallbacks.push(callback);
    return () => {
      const idx = this.accountChangeCallbacks.indexOf(callback);
      if (idx >= 0) this.accountChangeCallbacks.splice(idx, 1);
    };
  }

  onChainChange(callback: (chainId: number) => void): () => void {
    this.chainChangeCallbacks.push(callback);
    return () => {
      const idx = this.chainChangeCallbacks.indexOf(callback);
      if (idx >= 0) this.chainChangeCallbacks.splice(idx, 1);
    };
  }

  /**
   * Simulate account change (for testing)
   */
  simulateAccountChange(newName: string): void {
    this.playerName = newName;
    this.privateKey = this.generatePrivateKey(newName);

    if (this.wallet) {
      const newAddress = generateMockAddress(newName);
      this.wallet = { ...this.wallet, address: newAddress };
      this.accountChangeCallbacks.forEach((cb) => cb(newAddress));
    }
  }

  /**
   * Simulate chain change (for testing)
   */
  simulateChainChange(newChainId: number): void {
    this.chainId = newChainId;
    if (this.wallet) {
      this.wallet = { ...this.wallet, chainId: newChainId };
      this.chainChangeCallbacks.forEach((cb) => cb(newChainId));
    }
  }
}

/**
 * Key derivation message format
 */
const KEY_DERIVATION_MESSAGE = `ManaMesh Poker Game Key
Game ID: {gameId}
Version: 1`;

/**
 * Derive game keys from wallet signature.
 * Same wallet + gameId always produces same keys (deterministic).
 *
 * @param provider - Wallet provider
 * @param gameId - Unique game identifier
 * @returns Derived game keys
 */
export async function deriveGameKeys(
  provider: WalletProvider,
  gameId: string
): Promise<DerivedGameKeys> {
  const wallet = provider.getWallet();
  if (!wallet) {
    throw new Error('Wallet not connected');
  }

  // Create the signing message
  const message = KEY_DERIVATION_MESSAGE.replace('{gameId}', gameId);

  // Get signature from wallet
  const signature = await provider.signMessage(message);

  // Derive seed from signature (keccak256 equivalent for mock)
  const seed = deriveKeyFromSignature(signature);

  // Import the SRA key generation (uses elliptic secp256k1)
  const { generateKeyPair } = await import('../../crypto/mental-poker/sra');

  // Generate deterministic key pair from seed
  const keyPair = generateKeyPair(seed);

  console.log(
    `[deriveGameKeys] Derived keys for game ${gameId} from ${wallet.address}`
  );

  return {
    privateKey: keyPair.privateKey,
    publicKey: keyPair.publicKey,
    gameId,
    walletAddress: wallet.address,
  };
}

/**
 * Derive a 32-byte seed from signature
 */
function deriveKeyFromSignature(signature: string): Uint8Array {
  // Remove 0x prefix if present
  const sigHex = signature.startsWith('0x') ? signature.slice(2) : signature;

  // Use first 64 bytes of signature as seed material
  const seedHex = sigHex.slice(0, 64);

  // Convert to Uint8Array
  const seed = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    seed[i] = parseInt(seedHex.slice(i * 2, i * 2 + 2), 16);
  }

  return seed;
}

/**
 * Create a mock wallet provider for a player
 */
export function createMockWallet(
  playerName: string,
  chainId = 1
): MockWalletProvider {
  return new MockWalletProvider(playerName, chainId);
}
