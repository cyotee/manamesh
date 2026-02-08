import { describe, it, expect } from 'vitest';
import {
  PeerBlockList,
  AssetSharingSession,
  findMissingCards,
  isAssetSharingMessage,
} from './asset-sharing';

describe('PeerBlockList', () => {
  it('blocks and unblocks a peer', () => {
    const list = new PeerBlockList();
    expect(list.isBlocked('peer-1')).toBe(false);

    list.block('peer-1');
    expect(list.isBlocked('peer-1')).toBe(true);
    expect(list.getBlocked()).toEqual(['peer-1']);

    list.unblock('peer-1');
    expect(list.isBlocked('peer-1')).toBe(false);
    expect(list.getBlocked()).toEqual([]);
  });

  it('auto-blocks after max requests', () => {
    const list = new PeerBlockList(3);

    expect(list.recordRequest('peer-1')).toBe(false); // 1
    expect(list.recordRequest('peer-1')).toBe(false); // 2
    expect(list.recordRequest('peer-1')).toBe(true);  // 3 → auto-block
    expect(list.isBlocked('peer-1')).toBe(true);
  });

  it('does not auto-block different peers', () => {
    const list = new PeerBlockList(3);

    list.recordRequest('peer-1');
    list.recordRequest('peer-2');
    list.recordRequest('peer-1');

    expect(list.isBlocked('peer-1')).toBe(false);
    expect(list.isBlocked('peer-2')).toBe(false);
  });

  it('resets request count', () => {
    const list = new PeerBlockList(3);
    list.recordRequest('peer-1');
    list.recordRequest('peer-1');
    list.resetRequestCount('peer-1');
    list.recordRequest('peer-1'); // should be 1 again, not 3
    expect(list.isBlocked('peer-1')).toBe(false);
  });

  it('clears all state', () => {
    const list = new PeerBlockList();
    list.block('peer-1');
    list.block('peer-2');
    list.clear();
    expect(list.getBlocked()).toEqual([]);
  });
});

describe('AssetSharingSession', () => {
  it('tracks outgoing request transfer', () => {
    const session = new AssetSharingSession();
    const transfer = session.startRequest('pack-1', 'peer-1', 'cards-only', ['card-a']);

    expect(transfer.packId).toBe('pack-1');
    expect(transfer.direction).toBe('receiving');
    expect(transfer.status).toBe('pending-remote');
    expect(transfer.cardIds).toEqual(['card-a']);
  });

  it('tracks incoming request transfer', () => {
    const session = new AssetSharingSession();
    const transfer = session.startIncomingRequest('pack-1', 'peer-1', 'full-pack');

    expect(transfer.direction).toBe('sending');
    expect(transfer.status).toBe('pending-consent');
  });

  it('updates transfer state', () => {
    const session = new AssetSharingSession();
    session.startRequest('pack-1', 'peer-1', 'cards-only');

    const updated = session.updateTransfer('pack-1', {
      status: 'transferring',
      totalChunks: 10,
      chunksCompleted: 3,
    });

    expect(updated?.status).toBe('transferring');
    expect(updated?.totalChunks).toBe(10);
    expect(updated?.chunksCompleted).toBe(3);
  });

  it('returns undefined when updating non-existent transfer', () => {
    const session = new AssetSharingSession();
    expect(session.updateTransfer('nope', { status: 'complete' })).toBeUndefined();
  });

  it('removes transfer', () => {
    const session = new AssetSharingSession();
    session.startRequest('pack-1', 'peer-1', 'cards-only');
    session.removeTransfer('pack-1');
    expect(session.getTransfer('pack-1')).toBeUndefined();
  });

  it('lists all transfers', () => {
    const session = new AssetSharingSession();
    session.startRequest('pack-1', 'peer-1', 'cards-only');
    session.startIncomingRequest('pack-2', 'peer-2', 'full-pack');

    const transfers = session.getTransfers();
    expect(transfers).toHaveLength(2);
  });

  it('resets all state', () => {
    const session = new AssetSharingSession();
    session.startRequest('pack-1', 'peer-1', 'cards-only');
    session.blockList.block('peer-2');
    session.reset();

    expect(session.getTransfers()).toHaveLength(0);
    expect(session.blockList.getBlocked()).toEqual([]);
  });
});

describe('AssetSharingSession message factories', () => {
  it('creates deck-list-share message', () => {
    const msg = AssetSharingSession.createDeckListShare(
      { name: 'My Deck', game: 'onepiece', pack: 'OP01', leader: 'OP01-001', cards: { 'OP01-002': 4 } },
      { id: 'pack-1', name: 'OP01', game: 'onepiece', cardCount: 100 },
    );
    expect(msg.type).toBe('deck-list-share');
    expect(msg.deckList.name).toBe('My Deck');
    expect(msg.packMeta.cardCount).toBe(100);
  });

  it('creates deck-list-ack message', () => {
    const msg = AssetSharingSession.createDeckListAck(false, ['Too many cards'], ['OP01-099']);
    expect(msg.type).toBe('deck-list-ack');
    expect(msg.valid).toBe(false);
    expect(msg.errors).toEqual(['Too many cards']);
    expect(msg.missingCardIds).toEqual(['OP01-099']);
  });

  it('creates request message', () => {
    const msg = AssetSharingSession.createRequest('pack-1', 'cards-only', ['c1', 'c2']);
    expect(msg.type).toBe('asset-pack-request');
    expect(msg.mode).toBe('cards-only');
    expect(msg.cardIds).toEqual(['c1', 'c2']);
  });

  it('creates offer message', () => {
    const msg = AssetSharingSession.createOffer('pack-1', 'full-pack', 1024000, 22, 50);
    expect(msg.type).toBe('asset-pack-offer');
    expect(msg.totalSize).toBe(1024000);
  });

  it('creates chunk message', () => {
    const msg = AssetSharingSession.createChunkMessage('pack-1', {
      chunkIndex: 3,
      totalChunks: 10,
      data: 'base64data',
    });
    expect(msg.type).toBe('asset-pack-chunk');
    expect(msg.chunkIndex).toBe(3);
    expect(msg.packId).toBe('pack-1');
  });

  it('creates complete message', () => {
    const msg = AssetSharingSession.createComplete('pack-1', true);
    expect(msg.type).toBe('asset-pack-complete');
    expect(msg.success).toBe(true);
  });

  it('creates denied message', () => {
    const msg = AssetSharingSession.createDenied('pack-1', 'blocked');
    expect(msg.type).toBe('asset-pack-denied');
    expect(msg.reason).toBe('blocked');
  });

  it('creates cancel message', () => {
    const msg = AssetSharingSession.createCancel('pack-1');
    expect(msg.type).toBe('asset-pack-cancel');
  });
});

describe('findMissingCards', () => {
  it('returns missing card IDs', () => {
    const known = new Set(['c1', 'c2', 'c3']);
    const missing = findMissingCards(['c1', 'c4', 'c5'], known);
    expect(missing).toEqual(['c4', 'c5']);
  });

  it('returns empty when all present', () => {
    const known = new Set(['c1', 'c2']);
    expect(findMissingCards(['c1', 'c2'], known)).toEqual([]);
  });

  it('returns all when none known', () => {
    const known = new Set<string>();
    expect(findMissingCards(['c1', 'c2'], known)).toEqual(['c1', 'c2']);
  });
});

describe('isAssetSharingMessage', () => {
  it('recognizes valid message types', () => {
    expect(isAssetSharingMessage('deck-list-share')).toBe(true);
    expect(isAssetSharingMessage('asset-pack-chunk')).toBe(true);
    expect(isAssetSharingMessage('asset-pack-denied')).toBe(true);
  });

  it('rejects invalid types', () => {
    expect(isAssetSharingMessage('action')).toBe(false);
    expect(isAssetSharingMessage('sync')).toBe(false);
    expect(isAssetSharingMessage('unknown')).toBe(false);
  });
});
