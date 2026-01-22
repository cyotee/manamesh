# ManaMesh Frontend

P2P card game platform with libp2p-based networking.

## Requirements

### Development

- **Node.js**: >= 20.0.0 (Node 22+ recommended for full libp2p compatibility)
- **Yarn**: Berry (v4+)

### Browser Support

- **Chrome**: 119+
- **Firefox**: 121+
- **Safari**: 17.2+
- **Edge**: 119+

Modern browser features required:
- WebRTC
- WebSocket
- Crypto API (SubtleCrypto)
- IndexedDB

## Getting Started

```bash
# Install dependencies
yarn install

# Start development server
yarn dev

# Run tests
yarn test

# Build for production
yarn build
```

## Architecture

This package contains:
- React UI components
- boardgame.io game logic
- libp2p P2P networking layer
- IPFS asset loading (via Helia)
