import type { MatchmakingConfig, MatchmakingEvents } from '../MatchmakingService';

export interface PokerMatchmakingConfig extends MatchmakingConfig {
  gameType: 'poker';
  minBuyIn: number;
  smallBlind: number;
  bigBlind: number;
}

export function createPokerMatchmakingConfig(
  displayName: string,
  options: {
    isHost?: boolean;
    roomCode?: string;
    minBuyIn?: number;
    smallBlind?: number;
    bigBlind?: number;
    maxPlayers?: number;
  } = {},
): PokerMatchmakingConfig {
  return {
    gameType: 'poker',
    displayName,
    isHost: options.isHost ?? false,
    roomCode: options.roomCode,
    minBuyIn: options.minBuyIn ?? 1000,
    smallBlind: options.smallBlind ?? 5,
    bigBlind: options.bigBlind ?? 10,
    maxPlayers: options.maxPlayers ?? 6,
  };
}

export interface PokerLobbyEvents extends MatchmakingEvents {
  onBuyInRequired: (amount: number) => void;
  onBlindsPosted: (smallBlind: number, bigBlind: number) => void;
}

export function isPokerConfig(config: MatchmakingConfig): config is PokerMatchmakingConfig {
  return config.gameType === 'poker';
}
