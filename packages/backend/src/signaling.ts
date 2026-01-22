/**
 * Minimal WebSocket Signaling Server
 *
 * Provides a fallback for P2P discovery when DHT/mDNS/join codes fail.
 * Room-based message routing for SDP offer/answer exchange.
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';

interface SignalingMessage {
  type: 'join' | 'leave' | 'offer' | 'answer' | 'ice-candidate';
  roomId: string;
  peerId?: string;
  payload?: unknown;
}

interface Room {
  peers: Map<string, WebSocket>;
}

const rooms = new Map<string, Room>();

function generatePeerId(): string {
  return Math.random().toString(36).substring(2, 10);
}

function getOrCreateRoom(roomId: string): Room {
  let room = rooms.get(roomId);
  if (!room) {
    room = { peers: new Map() };
    rooms.set(roomId, room);
  }
  return room;
}

function cleanupRoom(roomId: string): void {
  const room = rooms.get(roomId);
  if (room && room.peers.size === 0) {
    rooms.delete(roomId);
    console.log(`[Signaling] Room ${roomId} deleted (empty)`);
  }
}

function broadcast(room: Room, message: unknown, excludePeerId?: string): void {
  const data = JSON.stringify(message);
  for (const [peerId, ws] of room.peers) {
    if (peerId !== excludePeerId && ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  }
}

export function attachSignaling(server: Server): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/signaling' });

  wss.on('connection', (ws) => {
    let currentRoom: string | null = null;
    let peerId: string | null = null;

    console.log('[Signaling] New connection');

    ws.on('message', (data) => {
      try {
        const message: SignalingMessage = JSON.parse(data.toString());

        switch (message.type) {
          case 'join': {
            if (currentRoom) {
              // Leave current room first
              const oldRoom = rooms.get(currentRoom);
              if (oldRoom && peerId) {
                oldRoom.peers.delete(peerId);
                broadcast(oldRoom, { type: 'peer-left', peerId }, peerId);
                cleanupRoom(currentRoom);
              }
            }

            currentRoom = message.roomId;
            peerId = generatePeerId();
            const room = getOrCreateRoom(currentRoom);

            // Notify existing peers
            broadcast(room, { type: 'peer-joined', peerId });

            // Add to room
            room.peers.set(peerId, ws);

            // Send peer list to new joiner
            const peerList = Array.from(room.peers.keys()).filter(id => id !== peerId);
            ws.send(JSON.stringify({
              type: 'joined',
              peerId,
              roomId: currentRoom,
              peers: peerList
            }));

            console.log(`[Signaling] Peer ${peerId} joined room ${currentRoom} (${room.peers.size} peers)`);
            break;
          }

          case 'offer':
          case 'answer':
          case 'ice-candidate': {
            if (!currentRoom || !peerId) {
              ws.send(JSON.stringify({ type: 'error', message: 'Not in a room' }));
              return;
            }

            const room = rooms.get(currentRoom);
            if (!room) return;

            // Forward to target peer or broadcast
            const targetPeerId = message.peerId;
            if (targetPeerId) {
              const targetWs = room.peers.get(targetPeerId);
              if (targetWs && targetWs.readyState === WebSocket.OPEN) {
                targetWs.send(JSON.stringify({
                  type: message.type,
                  peerId: peerId,
                  payload: message.payload
                }));
              }
            } else {
              // Broadcast to all other peers
              broadcast(room, {
                type: message.type,
                peerId: peerId,
                payload: message.payload
              }, peerId);
            }
            break;
          }

          case 'leave': {
            if (currentRoom && peerId) {
              const room = rooms.get(currentRoom);
              if (room) {
                room.peers.delete(peerId);
                broadcast(room, { type: 'peer-left', peerId }, peerId);
                cleanupRoom(currentRoom);
              }
            }
            currentRoom = null;
            peerId = null;
            break;
          }
        }
      } catch (err) {
        console.error('[Signaling] Error parsing message:', err);
        ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format' }));
      }
    });

    ws.on('close', () => {
      if (currentRoom && peerId) {
        const room = rooms.get(currentRoom);
        if (room) {
          room.peers.delete(peerId);
          broadcast(room, { type: 'peer-left', peerId }, peerId);
          cleanupRoom(currentRoom);
          console.log(`[Signaling] Peer ${peerId} disconnected from room ${currentRoom}`);
        }
      }
    });

    ws.on('error', (err) => {
      console.error('[Signaling] WebSocket error:', err);
    });
  });

  console.log('[Signaling] WebSocket server attached at /signaling');
  return wss;
}

// Stats endpoint helper
export function getSignalingStats(): { rooms: number; peers: number } {
  let totalPeers = 0;
  for (const room of rooms.values()) {
    totalPeers += room.peers.size;
  }
  return { rooms: rooms.size, peers: totalPeers };
}
