import { hexToBytes, toHex } from 'viem';
import type { VerifiedPokerHistory, PokerApprovalKind } from '@manamesh/poker/verified-history';
import type { PokerHistoryChannel } from '../poker-history-channel';
import type { ExperimentalPokerShuffleAdmission } from './poker-shuffle-admission';

/** Shuffle and decryption proofs only; no plaintext card values or secret keys. The native worker enforces the
 * admitted roster, local phase, author, position and previous deck. No wire field
 * authorizes signing, a private reveal or a new local checkpoint.
 */
export function bindPokerShuffleProofs(channel: PokerHistoryChannel, history: VerifiedPokerHistory, admission: ExperimentalPokerShuffleAdmission) {
  const validSeat = (seat: number) => Number.isInteger(seat) && seat >= 0 && seat < history.seatCount;
  const validPosition = (position: number) => Number.isInteger(position) && position >= 0 && position < 52;
  channel.setArtifactVerifier(async wire => {
    const packet = JSON.parse(wire);
    if (!packet || typeof packet !== 'object' || Array.isArray(packet)) throw new Error('poker_shuffle_wire:packet');
    if (packet.type === 'announcement-v1') {
      const keys = ['type', 'sessionId', 'checkpoint', 'seat', 'announcement'];
      if (Object.keys(packet).length !== keys.length || !Object.keys(packet).every(key => keys.includes(key))
        || packet.sessionId !== history.sessionId || packet.checkpoint !== history.checkpoint.head
        || !validSeat(packet.seat) || typeof packet.announcement !== 'string' || !/^0x[0-9a-f]{196}$/.test(packet.announcement)) throw new Error('poker_shuffle_wire:packet');
      await admission.receiveAnnouncement(packet.seat, packet.announcement);
      return;
    }
    if (packet.type === 'approval-v1') {
      const keys = ['type', 'sessionId', 'checkpoint', 'kind', 'seat', 'signature'];
      if (Object.keys(packet).length !== keys.length || !Object.keys(packet).every(key => keys.includes(key))
        || packet.sessionId !== history.sessionId || packet.checkpoint !== history.checkpoint.head
        || !['roster', 'deck', 'deal'].includes(packet.kind) || !validSeat(packet.seat)
        || typeof packet.signature !== 'string' || !/^0x[0-9a-f]{130}$/.test(packet.signature)) throw new Error('poker_shuffle_wire:packet');
      await admission.receiveApproval(packet.kind, packet.seat, packet.signature);
      return;
    }
    const shuffle = packet.type === 'shuffle-proof-v1';
    const keys = shuffle ? ['type', 'sessionId', 'checkpoint', 'step', 'proof'] : ['type', 'sessionId', 'checkpoint', 'seat', 'position', 'proof'];
    if (Object.keys(packet).length !== keys.length || !Object.keys(packet).every(key => keys.includes(key))
      || packet.sessionId !== history.sessionId || packet.checkpoint !== history.checkpoint.head
      || typeof packet.proof !== 'string') throw new Error('poker_shuffle_wire:packet');
    if (shuffle) {
      if (!validSeat(packet.step) || !/^0x[0-9a-f]{17958}$/.test(packet.proof)) throw new Error('poker_shuffle_wire:packet');
      await admission.receiveShuffle(packet.step, hexToBytes(packet.proof));
    } else {
      if (!['public-contribution-v1', 'private-contribution-v1'].includes(packet.type) || !validSeat(packet.seat) || !validPosition(packet.position)
        || !/^0x[0-9a-f]{262}$/.test(packet.proof)) throw new Error('poker_shuffle_wire:packet');
      if (packet.type === 'private-contribution-v1') {
        if (packet.position >= 2 * history.seatCount) throw new Error('poker_shuffle_wire:packet');
        await admission.acceptPrivateContribution(packet.position, packet.seat, hexToBytes(packet.proof));
      }
      else await admission.receivePublicContribution(packet.position, packet.seat, hexToBytes(packet.proof));
    }
  });
  const send = (fields: object) => channel.sendArtifact(JSON.stringify({ ...fields, sessionId: history.sessionId, checkpoint: history.checkpoint.head }));
  return {
    sendAnnouncement(seat: number, announcement: `0x${string}`) {
      if (!validSeat(seat) || !/^0x[0-9a-f]{196}$/.test(announcement)) throw new Error('poker_shuffle_wire:input');
      return send({ type: 'announcement-v1', seat, announcement });
    },
    sendApproval(kind: PokerApprovalKind, seat: number, signature: `0x${string}`) {
      if (!['roster', 'deck', 'deal'].includes(kind) || !validSeat(seat) || !/^0x[0-9a-f]{130}$/.test(signature)) throw new Error('poker_shuffle_wire:input');
      return send({ type: 'approval-v1', kind, seat, signature });
    },
    send(step: number, proof: Uint8Array) {
      if (!validSeat(step) || !(proof instanceof Uint8Array) || proof.length !== 8979) throw new Error('poker_shuffle_wire:input');
      return send({ type: 'shuffle-proof-v1', step, proof: toHex(proof) });
    },
    sendPrivateContribution(position: number, seat: number, proof: Uint8Array) {
      if (!validSeat(seat) || !validPosition(position) || position >= 2 * history.seatCount || !(proof instanceof Uint8Array) || proof.length !== 131) throw new Error('poker_shuffle_wire:input');
      return send({ type: 'private-contribution-v1', position, seat, proof: toHex(proof) });
    },
    sendPublicContribution(position: number, seat: number, proof: Uint8Array) {
      if (!validSeat(seat) || !validPosition(position) || !(proof instanceof Uint8Array) || proof.length !== 131) throw new Error('poker_shuffle_wire:input');
      return send({ type: 'public-contribution-v1', position, seat, proof: toHex(proof) });
    },
  };
}
