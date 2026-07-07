import type { MatchmakingConfig, MatchmakingEvents } from '../MatchmakingService';

export type HomeEraAssignment = 'selectable' | 'random';

export interface TimestreamsMatchmakingConfig extends MatchmakingConfig {
  gameType: 'timestreams';
  homeEraAssignment: HomeEraAssignment;
  maxPlayers: number;
}

export function createTimestreamsMatchmakingConfig(
  displayName: string,
  options: {
    isHost?: boolean;
    roomCode?: string;
    homeEraAssignment?: HomeEraAssignment;
    maxPlayers?: number;
  } = {},
): TimestreamsMatchmakingConfig {
  return {
    gameType: 'timestreams',
    displayName,
    isHost: options.isHost ?? false,
    roomCode: options.roomCode,
    homeEraAssignment: options.homeEraAssignment ?? 'selectable',
    maxPlayers: options.maxPlayers ?? 4,
  };
}

export interface TimestreamsLobbyEvents extends MatchmakingEvents {
  onHomeEraAssignmentChange?: (mode: HomeEraAssignment) => void;
  onEraClaimed?: (playerId: string, era: string) => void;
}

export function isTimestreamsConfig(config: MatchmakingConfig): config is TimestreamsMatchmakingConfig {
  return config.gameType === 'timestreams';
}
