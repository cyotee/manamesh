import { DHT_NAMESPACE } from '../../libp2p-config';

const encoder = new TextEncoder();

export function getTableKey(gameType: string, roomCode: string): Uint8Array {
  return encoder.encode(`${DHT_NAMESPACE}/tables/${gameType}/${roomCode.toUpperCase()}`);
}

export function getTableIndexKey(gameType: string): Uint8Array {
  return encoder.encode(`${DHT_NAMESPACE}/tables/${gameType}/index`);
}

export function getLobbyTopic(roomCode: string): string {
  return `${DHT_NAMESPACE}/lobby/${roomCode.toUpperCase()}`;
}
