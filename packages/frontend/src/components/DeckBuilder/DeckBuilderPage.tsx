/**
 * DeckBuilderPage — Main deck builder layout
 *
 * Split-panel layout: card browser on left, deck list + tools on right.
 * Supports loading multiple asset packs simultaneously — cards from all
 * loaded packs are combined into a single browsable collection.
 */

import React, { useState, useMemo, useCallback, useEffect, type CSSProperties } from 'react';
import type { LoadedAssetPack } from '../../assets/loader/types';
import { getStoredPacks, getLoadedPack, loadPack, clearCache } from '../../assets/loader';
import type { StoredPackMetadata } from '../../assets/loader/types';
import type { EnrichedCard, DeckList } from '../../deck/types';
import { enrichCard, createEmptyDeck } from '../../deck';
import { useDeckBuilder } from '../../hooks/useDeckBuilder';
import { useDeckStorage } from '../../hooks/useDeckStorage';
import { useDeckValidation } from '../../hooks/useDeckValidation';
import { AssetPackUpload } from './AssetPackUpload';
import { CardBrowser } from './CardBrowser';
import { DeckListPanel } from './DeckListPanel';
import { DeckStats } from './DeckStats';
import { DeckValidation } from './DeckValidation';
import { DeckManager } from './DeckManager';
import { ImportExportPanel } from './ImportExportPanel';

type RightTab = 'deck' | 'stats' | 'import' | 'saved' | 'packs';

interface DeckBuilderPageProps {
  onBack?: () => void;
}

export const DeckBuilderPage: React.FC<DeckBuilderPageProps> = ({ onBack }) => {
  // Multiple loaded packs
  const [loadedPacks, setLoadedPacks] = useState<LoadedAssetPack[]>([]);
  const [storedPacks, setStoredPacks] = useState<StoredPackMetadata[]>([]);
  const [rightTab, setRightTab] = useState<RightTab>('packs');
  const [loadingPackId, setLoadingPackId] = useState<string | null>(null);

  // Load stored pack metadata on mount
  useEffect(() => {
    getStoredPacks().then(setStoredPacks);
  }, []);

  // Deck storage
  const storage = useDeckStorage();

  // Initial empty deck
  const [initialDeck] = useState(() => createEmptyDeck('multi'));

  // Deck builder state
  const builder = useDeckBuilder(initialDeck);

  // Build combined card list + lookup from ALL loaded packs
  const { cards, cardLookup, cardPackMap } = useMemo(() => {
    const allCards: EnrichedCard[] = [];
    const lookup = new Map<string, EnrichedCard>();
    const packMap = new Map<string, string>(); // cardId → packId

    for (const pack of loadedPacks) {
      for (const entry of pack.cards) {
        // Skip duplicates (same card ID from different packs)
        if (lookup.has(entry.id)) continue;

        const enriched = enrichCard(entry);
        allCards.push(enriched);
        lookup.set(entry.id, enriched);
        packMap.set(entry.id, pack.id);
      }
    }

    return { cards: allCards, cardLookup: lookup, cardPackMap: packMap };
  }, [loadedPacks]);

  // Keep leader card reference in sync
  useEffect(() => {
    if (builder.deck.leaderId && cardLookup.has(builder.deck.leaderId)) {
      builder.setLeaderCard(cardLookup.get(builder.deck.leaderId)!);
    }
  }, [builder.deck.leaderId, cardLookup]);

  // Validation
  const validation = useDeckValidation(builder.deck, cardLookup);

  // Handle pack loaded (add to list, don't replace)
  const handlePackLoaded = useCallback(
    (pack: LoadedAssetPack) => {
      setLoadedPacks((prev) => {
        // Don't add duplicates
        if (prev.some((p) => p.id === pack.id)) return prev;
        return [...prev, pack];
      });
      // Switch to deck tab once we have at least one pack
      setRightTab('deck');
      // Refresh stored packs list
      getStoredPacks().then(setStoredPacks);
    },
    [],
  );

  // Handle selecting a stored pack (load it and add)
  const handleSelectStoredPack = useCallback(
    async (meta: StoredPackMetadata) => {
      // Already loaded?
      if (loadedPacks.some((p) => p.id === meta.id)) return;

      setLoadingPackId(meta.id);
      try {
        let pack = getLoadedPack(meta.id);
        if (!pack) {
          pack = await loadPack(meta.source);
        }
        if (pack) {
          handlePackLoaded(pack);
        }
      } catch (err) {
        console.warn('Failed to reload pack:', err);
      } finally {
        setLoadingPackId(null);
      }
    },
    [loadedPacks, handlePackLoaded],
  );

  // Remove a loaded pack
  const handleRemovePack = useCallback(
    (packId: string) => {
      setLoadedPacks((prev) => prev.filter((p) => p.id !== packId));
    },
    [],
  );

  // Clear all stored packs from IndexedDB
  const handleClearStoredPacks = useCallback(async () => {
    await clearCache();
    setStoredPacks([]);
  }, []);

  // Card browser callbacks
  const handleAddCard = useCallback(
    (cardId: string, card: EnrichedCard) => {
      return builder.addCard(cardId, card);
    },
    [builder],
  );

  const handleSetLeader = useCallback(
    (cardId: string, card: EnrichedCard) => {
      builder.setLeader(cardId);
      builder.setLeaderCard(card);
    },
    [builder],
  );

  // Save current deck
  const handleSave = useCallback(async () => {
    await storage.save(builder.deck);
  }, [storage, builder.deck]);

  // Load a saved deck
  const handleLoadDeck = useCallback(
    (deck: DeckList) => {
      builder.setDeck(deck);
      setRightTab('deck');
    },
    [builder],
  );

  // Import deck
  const handleImport = useCallback(
    (deck: DeckList) => {
      builder.setDeck(deck);
      setRightTab('deck');
    },
    [builder],
  );

  // New deck
  const handleNewDeck = useCallback(() => {
    const newDeck = createEmptyDeck('multi');
    builder.setDeck(newDeck);
    setRightTab('deck');
  }, [builder]);

  const hasPacks = loadedPacks.length > 0;
  const totalCards = cards.length;

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      backgroundColor: '#0f172a',
      color: '#e4e4e4',
    }}>
      {/* Top bar */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '8px 16px',
        backgroundColor: '#16213e',
        borderBottom: '1px solid #3a3a5c',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {onBack && (
            <button onClick={onBack} style={toolBtn}>
              Back
            </button>
          )}
          <h1 style={{ margin: 0, fontSize: 16 }}>Deck Builder</h1>
          {hasPacks && (
            <span style={{ fontSize: 12, color: '#8888aa' }}>
              {loadedPacks.length} pack{loadedPacks.length !== 1 ? 's' : ''} | {totalCards} cards
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => builder.undo()}
            disabled={!builder.canUndo}
            style={toolBtn}
          >
            Undo
          </button>
          <button
            onClick={() => builder.redo()}
            disabled={!builder.canRedo}
            style={toolBtn}
          >
            Redo
          </button>
          <button
            onClick={handleSave}
            disabled={!hasPacks}
            style={{ ...toolBtn, backgroundColor: hasPacks ? '#4CAF50' : '#333' }}
          >
            Save
          </button>
        </div>
      </div>

      {/* Validation bar */}
      {hasPacks && (
        <div style={{ padding: '4px 16px' }}>
          <DeckValidation validation={validation} />
        </div>
      )}

      {/* Main content */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Left panel */}
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          padding: 8,
          minHeight: 0,
          overflow: 'hidden',
        }}>
          {hasPacks ? (
            <CardBrowser
              cards={cards}
              cardPackMap={cardPackMap}
              onAddCard={handleAddCard}
              onSetLeader={handleSetLeader}
              deckCards={builder.deck.cards}
              leaderId={builder.deck.leaderId}
            />
          ) : (
            <div style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#555',
              fontSize: 14,
            }}>
              Load one or more asset packs from the Packs tab to start building
            </div>
          )}
        </div>

        {/* Right panel */}
        <div style={{
          width: 320,
          display: 'flex',
          flexDirection: 'column',
          borderLeft: '1px solid #3a3a5c',
          overflow: 'hidden',
        }}>
          {/* Tab bar */}
          <div style={{
            display: 'flex',
            borderBottom: '1px solid #3a3a5c',
            backgroundColor: '#16213e',
          }}>
            {([
              ['packs', 'Packs'],
              ['deck', 'Deck'],
              ['stats', 'Stats'],
              ['import', 'I/O'],
              ['saved', 'Saved'],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setRightTab(key)}
                style={{
                  flex: 1,
                  padding: '8px 4px',
                  backgroundColor: rightTab === key ? '#2a2a5a' : 'transparent',
                  color: rightTab === key ? '#e4e4e4' : '#8888aa',
                  border: 'none',
                  borderBottom: rightTab === key ? '2px solid #4a6fa5' : '2px solid transparent',
                  cursor: 'pointer',
                  fontSize: 11,
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div style={{ flex: 1, overflow: 'auto', padding: 8 }}>
            {rightTab === 'packs' && (
              <PacksPanel
                loadedPacks={loadedPacks}
                storedPacks={storedPacks}
                loadingPackId={loadingPackId}
                onPackLoaded={handlePackLoaded}
                onSelectStoredPack={handleSelectStoredPack}
                onRemovePack={handleRemovePack}
                onClearStored={handleClearStoredPacks}
              />
            )}
            {rightTab === 'deck' && (
              <DeckListPanel
                deck={builder.deck}
                cardLookup={cardLookup}
                cardPackMap={cardPackMap}
                onRemoveCard={builder.removeCard}
                onClearLeader={builder.clearLeader}
                onNameChange={builder.setName}
              />
            )}
            {rightTab === 'stats' && (
              <DeckStats deck={builder.deck} cardLookup={cardLookup} />
            )}
            {rightTab === 'import' && (
              <ImportExportPanel
                deck={builder.deck}
                packId="multi"
                onImport={handleImport}
              />
            )}
            {rightTab === 'saved' && (
              <DeckManager
                decks={storage.decks}
                currentDeckId={builder.deck.id}
                cardLookup={cardLookup}
                onLoadDeck={handleLoadDeck}
                onDuplicate={(id) => storage.duplicate(id)}
                onDelete={(id) => storage.remove(id)}
                onNewDeck={handleNewDeck}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

// --- Packs management panel ---

const PacksPanel: React.FC<{
  loadedPacks: LoadedAssetPack[];
  storedPacks: StoredPackMetadata[];
  loadingPackId: string | null;
  onPackLoaded: (pack: LoadedAssetPack) => void;
  onSelectStoredPack: (meta: StoredPackMetadata) => void;
  onRemovePack: (packId: string) => void;
  onClearStored: () => void;
}> = ({
  loadedPacks,
  storedPacks,
  loadingPackId,
  onPackLoaded,
  onSelectStoredPack,
  onRemovePack,
  onClearStored,
}) => {
  const loadedIds = new Set(loadedPacks.map((p) => p.id));
  const [copiedCid, setCopiedCid] = useState<string | null>(null);

  const copyIpfsHash = useCallback(async (cid: string) => {
    try {
      await navigator.clipboard.writeText(cid);
      setCopiedCid(cid);
      setTimeout(() => setCopiedCid(null), 2000);
    } catch { /* ignore */ }
  }, []);

  const getPackCid = (pack: LoadedAssetPack): string | null => {
    if (pack.source.type === 'ipfs') return pack.source.cid;
    if (pack.source.type === 'ipfs-zip') return pack.source.cid;
    return null;
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Upload new */}
      <AssetPackUpload onPackLoaded={onPackLoaded} />

      {/* Currently loaded */}
      {loadedPacks.length > 0 && (
        <div>
          <h4 style={{ margin: '0 0 6px', fontSize: 12, color: '#8888aa', textTransform: 'uppercase' }}>
            Loaded ({loadedPacks.length})
          </h4>
          {loadedPacks.map((pack) => (
            <div
              key={pack.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 10px',
                backgroundColor: '#1e3a5f',
                borderRadius: 6,
                border: '1px solid #4a6fa5',
                marginBottom: 4,
                fontSize: 12,
              }}
            >
              <div style={{ flex: 1 }}>
                <div style={{ color: '#e4e4e4' }}>{pack.manifest.name}</div>
                <div style={{ fontSize: 10, color: '#8888aa' }}>
                  {pack.cards.length} cards
                </div>
                {(() => {
                  const cid = getPackCid(pack);
                  if (!cid) return null;
                  return (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
                      <span style={{ fontSize: 9, color: '#6a6aaa', fontFamily: 'monospace' }}>
                        IPFS: {cid.slice(0, 8)}...{cid.slice(-6)}
                      </span>
                      <button
                        onClick={(e) => { e.stopPropagation(); copyIpfsHash(cid); }}
                        style={{
                          background: 'none',
                          border: '1px solid #3a3a5c',
                          color: copiedCid === cid ? '#6fcf6f' : '#8888aa',
                          cursor: 'pointer',
                          fontSize: 9,
                          padding: '0 4px',
                          borderRadius: 3,
                        }}
                      >
                        {copiedCid === cid ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                  );
                })()}
              </div>
              <button
                onClick={() => onRemovePack(pack.id)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#888',
                  cursor: 'pointer',
                  fontSize: 14,
                  padding: '0 4px',
                }}
                title="Unload pack"
              >
                x
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Available stored packs (exclude already-loaded ones) */}
      {storedPacks.filter((p) => !loadedIds.has(p.id)).length > 0 && (
        <div>
          <h4 style={{ margin: '0 0 6px', fontSize: 12, color: '#8888aa', textTransform: 'uppercase' }}>
            Available Packs
          </h4>
          {storedPacks
            .filter((meta) => !loadedIds.has(meta.id))
            .map((meta) => {
              const isLoading = loadingPackId === meta.id;

              return (
                <div
                  key={meta.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '6px 10px',
                    backgroundColor: '#1a1a2e',
                    borderRadius: 6,
                    border: '1px solid #2a2a4a',
                    marginBottom: 4,
                    fontSize: 12,
                  }}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ color: '#e4e4e4' }}>{meta.name}</div>
                    <div style={{ fontSize: 10, color: '#8888aa' }}>
                      {meta.cardCount} cards | {meta.game}
                    </div>
                  </div>
                  <button
                    onClick={() => onSelectStoredPack(meta)}
                    disabled={isLoading}
                    style={{
                      padding: '3px 10px',
                      backgroundColor: isLoading ? '#333' : '#4CAF50',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 4,
                      cursor: isLoading ? 'not-allowed' : 'pointer',
                      fontSize: 11,
                    }}
                  >
                    {isLoading ? '...' : 'Load'}
                  </button>
                </div>
              );
            })}
          <button
            onClick={onClearStored}
            style={{
              marginTop: 8,
              padding: '4px 10px',
              backgroundColor: 'transparent',
              color: '#f44336',
              border: '1px solid #f44336',
              borderRadius: 4,
              cursor: 'pointer',
              fontSize: 11,
              width: '100%',
            }}
          >
            Clear All Stored Packs
          </button>
        </div>
      )}
    </div>
  );
};

const toolBtn: React.CSSProperties = {
  padding: '6px 12px',
  backgroundColor: '#3a3a5c',
  color: '#e4e4e4',
  border: 'none',
  borderRadius: 4,
  cursor: 'pointer',
  fontSize: 12,
};
