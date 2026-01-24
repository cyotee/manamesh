/**
 * Tests for game module type interfaces
 *
 * These tests validate that the interface contracts are correct and usable.
 * Since interfaces are compile-time only, we test by creating valid implementations.
 */

import { describe, it, expect } from 'vitest';
import type { Game } from 'boardgame.io';
import type {
  GameModule,
  ZoneDefinition,
  CoreCard,
  CardSchema,
  GameModuleAssetRequirements,
  ZoneLayoutConfig,
  GameConfig,
  BaseGameState,
  MoveValidation,
  StandardCard,
  MTGCard,
  LorcanaCard,
  OnePieceCard,
  Visibility,
  ZoneFeature,
  AssetType,
  CardArrangement,
} from './types';

describe('GameModule Interface', () => {
  describe('ZoneDefinition', () => {
    it('should define a valid zone with required properties', () => {
      const zone: ZoneDefinition = {
        id: 'hand',
        name: 'Hand',
        visibility: 'owner-only',
        shared: false,
        ordered: false,
        features: ['play', 'reveal'],
      };

      expect(zone.id).toBe('hand');
      expect(zone.visibility).toBe('owner-only');
      expect(zone.shared).toBe(false);
      expect(zone.features).toContain('play');
    });

    it('should allow optional maxCards', () => {
      const handZone: ZoneDefinition = {
        id: 'hand',
        name: 'Hand',
        visibility: 'owner-only',
        shared: false,
        ordered: false,
        features: [],
        maxCards: 7, // Hand limit
      };

      expect(handZone.maxCards).toBe(7);
    });

    it('should support all visibility types', () => {
      const visibilities: Visibility[] = ['public', 'private', 'owner-only', 'hidden'];

      visibilities.forEach((visibility) => {
        const zone: ZoneDefinition = {
          id: `zone-${visibility}`,
          name: `Zone ${visibility}`,
          visibility,
          shared: false,
          ordered: false,
          features: [],
        };
        expect(zone.visibility).toBe(visibility);
      });
    });

    it('should support all zone features', () => {
      const features: ZoneFeature[] = [
        'search',
        'peek',
        'shuffle',
        'reorder',
        'reveal',
        'draw',
        'play',
        'tap',
        'counter',
        'stack',
      ];

      const zone: ZoneDefinition = {
        id: 'test',
        name: 'Test Zone',
        visibility: 'public',
        shared: false,
        ordered: false,
        features,
      };

      expect(zone.features).toHaveLength(10);
      expect(zone.features).toEqual(features);
    });
  });

  describe('CoreCard', () => {
    it('should define a basic card with required fields', () => {
      const card: CoreCard = {
        id: 'card-1',
        name: 'Test Card',
      };

      expect(card.id).toBe('card-1');
      expect(card.name).toBe('Test Card');
    });

    it('should allow optional image CIDs', () => {
      const card: CoreCard = {
        id: 'card-1',
        name: 'Test Card',
        imageCid: 'bafybeig...',
        backImageCid: 'bafybeih...',
      };

      expect(card.imageCid).toBe('bafybeig...');
      expect(card.backImageCid).toBe('bafybeih...');
    });
  });

  describe('StandardCard', () => {
    it('should extend CoreCard with suit and rank', () => {
      const card: StandardCard = {
        id: 'hearts-A',
        name: 'Ace of Hearts',
        suit: 'hearts',
        rank: 'A',
      };

      expect(card.suit).toBe('hearts');
      expect(card.rank).toBe('A');
    });

    it('should support all suits', () => {
      const suits: StandardCard['suit'][] = ['hearts', 'diamonds', 'clubs', 'spades'];

      suits.forEach((suit) => {
        const card: StandardCard = {
          id: `${suit}-A`,
          name: `Ace of ${suit}`,
          suit,
          rank: 'A',
        };
        expect(card.suit).toBe(suit);
      });
    });

    it('should support all ranks', () => {
      const ranks: StandardCard['rank'][] = [
        'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K',
      ];

      ranks.forEach((rank) => {
        const card: StandardCard = {
          id: `hearts-${rank}`,
          name: `${rank} of Hearts`,
          suit: 'hearts',
          rank,
        };
        expect(card.rank).toBe(rank);
      });
    });
  });

  describe('MTGCard', () => {
    it('should extend CoreCard with MTG-specific fields', () => {
      const card: MTGCard = {
        id: '12345-abcd',
        name: 'Lightning Bolt',
        types: ['Instant'],
        manaCost: '{R}',
        oracleText: 'Lightning Bolt deals 3 damage to any target.',
        set: 'LEA',
        collectorNumber: '161',
      };

      expect(card.types).toContain('Instant');
      expect(card.manaCost).toBe('{R}');
      expect(card.set).toBe('LEA');
    });

    it('should support creature-specific fields', () => {
      const creature: MTGCard = {
        id: '67890-efgh',
        name: 'Llanowar Elves',
        types: ['Creature'],
        subtypes: ['Elf', 'Druid'],
        manaCost: '{G}',
        power: 1,
        toughness: 1,
        oracleText: '{T}: Add {G}.',
        set: 'LEA',
        collectorNumber: '210',
      };

      expect(creature.power).toBe(1);
      expect(creature.toughness).toBe(1);
      expect(creature.subtypes).toContain('Elf');
    });

    it('should support planeswalker loyalty', () => {
      const planeswalker: MTGCard = {
        id: 'pw-123',
        name: 'Jace, the Mind Sculptor',
        types: ['Legendary', 'Planeswalker'],
        subtypes: ['Jace'],
        manaCost: '{2}{U}{U}',
        loyalty: 3,
        set: 'WWK',
        collectorNumber: '31',
      };

      expect(planeswalker.loyalty).toBe(3);
    });
  });

  describe('LorcanaCard', () => {
    it('should extend CoreCard with Lorcana-specific fields', () => {
      const card: LorcanaCard = {
        id: 'lorcana-001',
        name: 'Mickey Mouse - Brave Little Tailor',
        inkCost: 3,
        inkable: true,
        strength: 2,
        willpower: 3,
        lore: 2,
        abilities: ['Bodyguard', 'Challenger +2'],
      };

      expect(card.inkCost).toBe(3);
      expect(card.inkable).toBe(true);
      expect(card.lore).toBe(2);
      expect(card.abilities).toHaveLength(2);
    });
  });

  describe('OnePieceCard', () => {
    it('should extend CoreCard with One Piece-specific fields', () => {
      const card: OnePieceCard = {
        id: 'op-001',
        name: 'Monkey D. Luffy',
        cost: 5,
        power: 6000,
        color: 'red',
        cardType: 'character',
        attributes: ['Straw Hat Crew', 'Supernovas'],
        effect: 'When this character attacks, draw 1 card.',
      };

      expect(card.cost).toBe(5);
      expect(card.power).toBe(6000);
      expect(card.color).toBe('red');
      expect(card.cardType).toBe('character');
    });

    it('should support leader cards', () => {
      const leader: OnePieceCard = {
        id: 'op-L01',
        name: 'Monkey D. Luffy',
        cost: 0,
        power: 5000,
        color: 'red',
        cardType: 'leader',
      };

      expect(leader.cardType).toBe('leader');
    });
  });

  describe('GameModuleAssetRequirements', () => {
    it('should define required and optional asset types', () => {
      const requirements: GameModuleAssetRequirements = {
        required: ['card_face'],
        optional: ['token', 'card_back'],
        idFormat: 'scryfall_uuid',
      };

      expect(requirements.required).toContain('card_face');
      expect(requirements.optional).toContain('token');
      expect(requirements.idFormat).toBe('scryfall_uuid');
    });

    it('should support all asset types', () => {
      const assetTypes: AssetType[] = [
        'card_face',
        'card_back',
        'token',
        'counter',
        'playmat',
        'icon',
      ];

      const requirements: GameModuleAssetRequirements = {
        required: assetTypes,
        optional: [],
        idFormat: 'custom',
      };

      expect(requirements.required).toHaveLength(6);
    });
  });

  describe('ZoneLayoutConfig', () => {
    it('should define zone positions and arrangements', () => {
      const layout: ZoneLayoutConfig = {
        zones: {
          hand: {
            x: 50,
            y: 90,
            width: 80,
            height: 15,
            cardArrangement: 'fan',
          },
          battlefield: {
            x: 50,
            y: 50,
            width: 90,
            height: 40,
            cardArrangement: 'grid',
          },
        },
      };

      expect(layout.zones.hand.cardArrangement).toBe('fan');
      expect(layout.zones.battlefield.x).toBe(50);
    });

    it('should support all card arrangements', () => {
      const arrangements: CardArrangement[] = ['stack', 'fan', 'grid', 'row', 'column'];

      arrangements.forEach((arrangement) => {
        const layout: ZoneLayoutConfig = {
          zones: {
            test: {
              x: 0,
              y: 0,
              width: 100,
              height: 100,
              cardArrangement: arrangement,
            },
          },
        };
        expect(layout.zones.test.cardArrangement).toBe(arrangement);
      });
    });

    it('should allow optional zone properties', () => {
      const layout: ZoneLayoutConfig = {
        zones: {
          rotatedZone: {
            x: 10,
            y: 10,
            width: 20,
            height: 30,
            cardArrangement: 'stack',
            rotation: 90,
            zIndex: 5,
          },
        },
        defaultCardSize: {
          width: 63,
          height: 88,
        },
      };

      expect(layout.zones.rotatedZone.rotation).toBe(90);
      expect(layout.zones.rotatedZone.zIndex).toBe(5);
      expect(layout.defaultCardSize?.width).toBe(63);
    });
  });

  describe('CardSchema', () => {
    it('should provide validation and creation functions', () => {
      const schema: CardSchema<StandardCard> = {
        validate: (card): card is StandardCard => {
          return (
            typeof card === 'object' &&
            card !== null &&
            'id' in card &&
            'name' in card &&
            'suit' in card &&
            'rank' in card
          );
        },
        create: (data) => ({
          id: data.id,
          name: data.name,
          suit: data.suit ?? 'hearts',
          rank: data.rank ?? 'A',
        }),
        getAssetKey: (card) => `${card.suit}-${card.rank}`,
      };

      const validCard = { id: '1', name: 'Ace', suit: 'hearts', rank: 'A' };
      const invalidCard = { id: '1', name: 'Test' };

      expect(schema.validate(validCard)).toBe(true);
      expect(schema.validate(invalidCard)).toBe(false);

      const created = schema.create({ id: '2', name: 'King', suit: 'spades', rank: 'K' });
      expect(created.suit).toBe('spades');

      const key = schema.getAssetKey(created);
      expect(key).toBe('spades-K');
    });
  });

  describe('Complete GameModule', () => {
    it('should implement a minimal valid game module', () => {
      // Define a minimal game state
      interface TestState extends BaseGameState<CoreCard> {
        turnCount: number;
      }

      // Create a minimal game module
      const testModule: GameModule<CoreCard, TestState> = {
        id: 'test-game',
        name: 'Test Game',
        version: '1.0.0',
        description: 'A minimal test game module',

        cardSchema: {
          validate: (card): card is CoreCard => {
            return (
              typeof card === 'object' &&
              card !== null &&
              'id' in card &&
              'name' in card
            );
          },
          create: (data) => ({
            id: data.id,
            name: data.name,
            imageCid: data.imageCid,
            backImageCid: data.backImageCid,
          }),
          getAssetKey: (card) => card.id,
        },

        zones: [
          {
            id: 'deck',
            name: 'Deck',
            visibility: 'hidden',
            shared: true,
            ordered: true,
            features: ['shuffle', 'draw'],
          },
          {
            id: 'hand',
            name: 'Hand',
            visibility: 'owner-only',
            shared: false,
            ordered: false,
            features: ['play'],
            maxCards: 5,
          },
        ],

        assetRequirements: {
          required: ['card_face'],
          optional: ['card_back'],
          idFormat: 'custom',
        },

        initialState: (config: GameConfig): TestState => ({
          zones: {
            deck: { shared: [] },
            hand: Object.fromEntries(config.playerIDs.map((id) => [id, []])),
          },
          turnCount: 0,
        }),

        validateMove: (
          _state: TestState,
          move: string,
          _playerID: string,
        ): MoveValidation => {
          if (move === 'draw' || move === 'play') {
            return { valid: true };
          }
          return { valid: false, error: `Unknown move: ${move}` };
        },

        getBoardgameIOGame: (): Game<TestState> => ({
          name: 'test-game',
          setup: (): TestState => ({
            zones: { deck: { shared: [] }, hand: {} },
            turnCount: 0,
          }),
          moves: {
            draw: ({ G }) => G,
          },
        }),

        zoneLayout: {
          zones: {
            deck: { x: 50, y: 50, width: 10, height: 15, cardArrangement: 'stack' },
            hand: { x: 50, y: 90, width: 60, height: 15, cardArrangement: 'fan' },
          },
        },
      };

      // Verify the module is properly typed
      expect(testModule.id).toBe('test-game');
      expect(testModule.version).toBe('1.0.0');
      expect(testModule.zones).toHaveLength(2);
      expect(testModule.assetRequirements.required).toContain('card_face');

      // Test initialState
      const state = testModule.initialState({
        numPlayers: 2,
        playerIDs: ['0', '1'],
      });
      expect(state.turnCount).toBe(0);
      expect(state.zones.hand['0']).toEqual([]);

      // Test validateMove
      expect(testModule.validateMove(state, 'draw', '0').valid).toBe(true);
      expect(testModule.validateMove(state, 'invalid', '0').valid).toBe(false);

      // Test getBoardgameIOGame
      const bgioGame = testModule.getBoardgameIOGame();
      expect(bgioGame.name).toBe('test-game');
    });
  });

  describe('War Zone Definitions (from PRD)', () => {
    it('should match PRD War zone specifications', () => {
      const warZones: ZoneDefinition[] = [
        {
          id: 'deck',
          name: 'Deck',
          shared: false,
          visibility: 'hidden',
          ordered: true,
          features: ['draw', 'shuffle'],
        },
        {
          id: 'played',
          name: 'Played Card',
          shared: false,
          visibility: 'public',
          ordered: false,
          features: ['reveal'],
        },
        {
          id: 'won',
          name: 'Won Cards',
          shared: false,
          visibility: 'public',
          ordered: false,
          features: ['stack'],
        },
      ];

      expect(warZones).toHaveLength(3);
      expect(warZones.find((z) => z.id === 'deck')?.shared).toBe(false);
      expect(warZones.find((z) => z.id === 'played')?.visibility).toBe('public');
    });
  });

  describe('Poker Zone Definitions (from PRD)', () => {
    it('should match PRD Poker zone specifications', () => {
      const pokerZones: ZoneDefinition[] = [
        {
          id: 'deck',
          name: 'Deck',
          shared: true,
          visibility: 'hidden',
          ordered: true,
          features: ['shuffle', 'draw'],
        },
        {
          id: 'hand',
          name: 'Hand',
          shared: false,
          visibility: 'owner-only',
          ordered: false,
          features: ['reveal'],
          maxCards: 5,
        },
        {
          id: 'community',
          name: 'Community Cards',
          shared: true,
          visibility: 'public',
          ordered: false,
          features: ['reveal'],
        },
        {
          id: 'discard',
          name: 'Discard',
          shared: true,
          visibility: 'public',
          ordered: false,
          features: [],
        },
      ];

      expect(pokerZones).toHaveLength(4);
      expect(pokerZones.find((z) => z.id === 'deck')?.shared).toBe(true);
      expect(pokerZones.find((z) => z.id === 'hand')?.visibility).toBe('owner-only');
      expect(pokerZones.find((z) => z.id === 'community')?.shared).toBe(true);
    });
  });

  describe('MTG Zone Definitions (from PRD)', () => {
    it('should match PRD MTG zone specifications', () => {
      const mtgZones: ZoneDefinition[] = [
        {
          id: 'library',
          name: 'Library',
          shared: false,
          visibility: 'hidden',
          ordered: true,
          features: ['search', 'shuffle', 'peek', 'draw'],
        },
        {
          id: 'hand',
          name: 'Hand',
          shared: false,
          visibility: 'owner-only',
          ordered: false,
          features: ['play', 'reveal'],
        },
        {
          id: 'battlefield',
          name: 'Battlefield',
          shared: false,
          visibility: 'public',
          ordered: false,
          features: ['tap', 'counter'],
        },
        {
          id: 'graveyard',
          name: 'Graveyard',
          shared: false,
          visibility: 'public',
          ordered: true,
          features: ['search'],
        },
        {
          id: 'exile',
          name: 'Exile',
          shared: false,
          visibility: 'public',
          ordered: false,
          features: [],
        },
        {
          id: 'command',
          name: 'Command Zone',
          shared: false,
          visibility: 'public',
          ordered: false,
          features: [],
        },
      ];

      expect(mtgZones).toHaveLength(6);
      expect(mtgZones.find((z) => z.id === 'library')?.features).toContain('search');
      expect(mtgZones.find((z) => z.id === 'library')?.features).toContain('shuffle');
      expect(mtgZones.find((z) => z.id === 'battlefield')?.features).toContain('tap');
      expect(mtgZones.find((z) => z.id === 'graveyard')?.ordered).toBe(true);
    });
  });
});
