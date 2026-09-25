import { expect, it, vi } from 'vitest';
import type { VerifiedPokerHistory } from '@manamesh/poker/verified-history';
import type { PokerHistoryChannel } from '../poker-history-channel';
import type { ExperimentalPokerShuffleAdmission } from './poker-shuffle-admission';
import { bindPokerShuffleProofs } from './poker-shuffle-proof-channel';
function fixture() {
  let verify!: (wire: string) => Promise<void>;
  const sendArtifact = vi.fn(); const receiveShuffle = vi.fn().mockResolvedValue(new Uint8Array());
  const receiveAnnouncement = vi.fn().mockResolvedValue(undefined);
  const receiveApproval = vi.fn().mockResolvedValue(undefined);
  const acceptPrivateContribution = vi.fn().mockResolvedValue(new Uint8Array());
  const receivePublicContribution = vi.fn().mockResolvedValue(new Uint8Array());
  const channel = { setArtifactVerifier: (handler: typeof verify) => { verify = handler; }, sendArtifact };
  const history = { sessionId: `0x${'a'.repeat(64)}`, checkpoint: { head: `0x${'b'.repeat(64)}` }, seatCount: 2 };
  const exchange = bindPokerShuffleProofs(channel as unknown as PokerHistoryChannel, history as unknown as VerifiedPokerHistory, { receiveShuffle, receivePublicContribution, acceptPrivateContribution, receiveApproval, receiveAnnouncement } as unknown as ExperimentalPokerShuffleAdmission);
  const packet = { type: 'shuffle-proof-v1', sessionId: history.sessionId, checkpoint: history.checkpoint.head, step: 0, proof: `0x${'00'.repeat(8979)}` };
  return { exchange, packet, sendArtifact, receiveShuffle, receivePublicContribution, acceptPrivateContribution, receiveApproval, receiveAnnouncement, verify: (wire: string) => verify(wire) };
}
it('passes only the bounded step/proof to native verification and propagates refusal', async () => {
  const f = fixture(); await f.verify(JSON.stringify(f.packet));
  expect(f.receiveShuffle).toHaveBeenCalledWith(0, new Uint8Array(8979));
  f.receiveShuffle.mockRejectedValueOnce(new Error('native_invalid_proof'));
  await expect(f.verify(JSON.stringify(f.packet))).rejects.toThrow('native_invalid_proof');
});
it.each(['sessionId', 'checkpoint', 'step', 'proof', 'type', 'privateKey'])('rejects invalid %s before native work', async field => {
  const f = fixture(); await expect(f.verify(JSON.stringify({ ...f.packet, [field]: 'invalid' }))).rejects.toThrow('packet');
  expect(f.receiveShuffle).not.toHaveBeenCalled();
});
it('encodes the local binding and rejects incorrectly sized outgoing proofs', () => {
  const f = fixture(); f.exchange.send(0, new Uint8Array(8979));
  expect(JSON.parse(f.sendArtifact.mock.calls[0][0])).toEqual(f.packet);
  expect(() => f.exchange.send(2, new Uint8Array(8979))).toThrow('input');
  expect(() => f.exchange.send(0, new Uint8Array(1))).toThrow('input');
});

function publicPacket() {
  const f = fixture();
  const packet = { type: 'public-contribution-v1', sessionId: f.packet.sessionId, checkpoint: f.packet.checkpoint, seat: 1, position: 5, proof: `0x${'00'.repeat(131)}` };
  return { ...f, publicPacket: packet };
}
it('routes public contributions to the local permission/proof verifier without invoking shuffle', async () => {
  const f = publicPacket(); await f.verify(JSON.stringify(f.publicPacket));
  expect(f.receivePublicContribution).toHaveBeenCalledWith(5, 1, new Uint8Array(131));
  expect(f.receiveShuffle).not.toHaveBeenCalled();
  f.receivePublicContribution.mockRejectedValueOnce(new Error('public_unauthorized'));
  await expect(f.verify(JSON.stringify(f.publicPacket))).rejects.toThrow('public_unauthorized');
});
it.each([
  { type: 'unknown-contribution-v1' }, { position: 52 }, { position: -1 }, { seat: 2 },
  { proof: '0x00' }, { checkpoint: 'old' }, { sessionId: 'other' }, { privateKey: 'forbidden' },
])('rejects invalid public contribution fields %j before native work', async change => {
  const f = publicPacket(); await expect(f.verify(JSON.stringify({ ...f.publicPacket, ...change }))).rejects.toThrow('packet');
  expect(f.receivePublicContribution).not.toHaveBeenCalled(); expect(f.receiveShuffle).not.toHaveBeenCalled();
});
it('encodes public contributions with the current local binding and exact proof size', () => {
  const f = publicPacket(); f.exchange.sendPublicContribution(5, 1, new Uint8Array(131));
  expect(JSON.parse(f.sendArtifact.mock.calls[0][0])).toEqual(f.publicPacket);
  expect(() => f.exchange.sendPublicContribution(52, 1, new Uint8Array(131))).toThrow('input');
  expect(() => f.exchange.sendPublicContribution(5, 2, new Uint8Array(131))).toThrow('input');
  expect(() => f.exchange.sendPublicContribution(5, 1, new Uint8Array(130))).toThrow('input');
});

it('routes private contributions to owner-aware native admission, never the public cache', async () => {
  const f = publicPacket(); const packet = { ...f.publicPacket, type: 'private-contribution-v1', position: 0 };
  await f.verify(JSON.stringify(packet));
  expect(f.acceptPrivateContribution).toHaveBeenCalledWith(0, 1, new Uint8Array(131));
  expect(f.receivePublicContribution).not.toHaveBeenCalled();
  f.acceptPrivateContribution.mockRejectedValueOnce(new Error('deck_unauthorized'));
  await expect(f.verify(JSON.stringify(packet))).rejects.toThrow('deck_unauthorized');
});
it('refuses non-hole private positions and encodes the current private binding', async () => {
  const f = publicPacket(); const packet = { ...f.publicPacket, type: 'private-contribution-v1', position: 0 };
  f.exchange.sendPrivateContribution(0, 1, new Uint8Array(131));
  expect(JSON.parse(f.sendArtifact.mock.calls[0][0])).toEqual(packet);
  await expect(f.verify(JSON.stringify({ ...packet, position: 4 }))).rejects.toThrow('packet');
  expect(f.acceptPrivateContribution).not.toHaveBeenCalled();
  expect(() => f.exchange.sendPrivateContribution(4, 1, new Uint8Array(131))).toThrow('input');
});

it('routes canonical approval packets to local signature collection, without treating them as proofs', async () => {
  const f = fixture(); const packet = { type: 'approval-v1', kind: 'roster', seat: 1, signature: `0x${'00'.repeat(65)}`, sessionId: f.packet.sessionId, checkpoint: f.packet.checkpoint };
  await f.verify(JSON.stringify(packet));
  expect(f.receiveApproval).toHaveBeenCalledWith('roster', 1, packet.signature);
  expect(f.receiveShuffle).not.toHaveBeenCalled(); expect(f.acceptPrivateContribution).not.toHaveBeenCalled();
  f.receiveApproval.mockRejectedValueOnce(new Error('wrong_signer'));
  await expect(f.verify(JSON.stringify(packet))).rejects.toThrow('wrong_signer');
  f.exchange.sendApproval('roster', 1, packet.signature as `0x${string}`);
  expect(JSON.parse(f.sendArtifact.mock.calls[0][0])).toEqual(packet);
});
it.each([{ kind: 'settlement' }, { seat: 2 }, { signature: '0x00' }, { checkpoint: 'old' }, { deckHead: 'remote' }])('refuses malformed approval fields %j before collection', async patch => {
  const f = fixture();
  const packet = { type: 'approval-v1', kind: 'deck', seat: 1, signature: `0x${'00'.repeat(65)}`, sessionId: f.packet.sessionId, checkpoint: f.packet.checkpoint };
  await expect(f.verify(JSON.stringify({ ...packet, ...patch }))).rejects.toThrow('packet');
  expect(f.receiveApproval).not.toHaveBeenCalled();
});

it('routes bounded key announcements to native admission without signing', async () => {
  const f = fixture();
  const packet = { type: 'announcement-v1', sessionId: f.packet.sessionId, checkpoint: f.packet.checkpoint, seat: 1, announcement: `0x${'ab'.repeat(98)}` as const };
  await f.verify(JSON.stringify(packet));
  expect(f.receiveAnnouncement).toHaveBeenCalledWith(1, packet.announcement);
  expect(f.receiveApproval).not.toHaveBeenCalled();
  f.exchange.sendAnnouncement(1, packet.announcement);
  expect(JSON.parse(f.sendArtifact.mock.calls[0][0])).toEqual(packet);
  f.receiveAnnouncement.mockRejectedValueOnce(new Error('native_ownership_failure'));
  await expect(f.verify(JSON.stringify(packet))).rejects.toThrow('native_ownership_failure');
});
it.each([{ seat: 2 }, { announcement: '0x' }, { privateKey: 'forbidden' }, { sessionId: 'wrong' }, { checkpoint: 'stale' }])('rejects malformed announcement %j before native work', async patch => {
  const f = fixture();
  await expect(f.verify(JSON.stringify({ type: 'announcement-v1', sessionId: f.packet.sessionId, checkpoint: f.packet.checkpoint, seat: 1, announcement: `0x${'ab'.repeat(98)}`, ...patch }))).rejects.toThrow('packet');
  expect(f.receiveAnnouncement).not.toHaveBeenCalled();
});
