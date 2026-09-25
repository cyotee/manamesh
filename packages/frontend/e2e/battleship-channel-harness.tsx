// Test-only local signaling; exercises production board, engine and channel adapter.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { Client } from 'boardgame.io/react';
import { MerkleBattleshipGame, MerkleBattleshipBoard } from '@manamesh/game-battleship-merkle';
import type { P2PChannel } from '@cyotee/boardgameio-p2p/channel';
import { P2PMultiplayer } from '../src/p2p/transport';
import { createBattleshipChannel } from '../src/p2p/battleship-channel';
let rtc: RTCPeerConnection;
let data: RTCDataChannel;
let channel: ReturnType<typeof createBattleshipChannel>;
const signals: string[] = [];
let currentPlayer: string;
export const activeSeat = () => currentPlayer;
function attach(raw: RTCDataChannel) {
  data = raw;
  const peer: P2PChannel = {
    send: wire => data.send(wire),
    isConnected: () => data.readyState === 'open',
    events: { onMessage: () => {}, onConnectionStateChange: () => {} },
  };
  data.onmessage = event => peer.events.onMessage(event.data);
  data.onopen = () => peer.events.onConnectionStateChange('connected');
  data.onclose = () => peer.events.onConnectionStateChange('disconnected');
  channel = createBattleshipChannel(peer);
  channel.activate();
  channel.onSignal(payload => signals.push((payload as { type: string }).type));
}
async function gathered() {
  if (rtc.iceGatheringState !== 'complete') await new Promise<void>((resolve, reject) => {
    const done = () => { if (rtc.iceGatheringState === 'complete') { cleanup(); resolve(); } };
    const timer = setTimeout(() => { cleanup(); reject(new Error('ICE timeout')); }, 10_000);
    const cleanup = () => { clearTimeout(timer); rtc.removeEventListener('icegatheringstatechange', done); };
    rtc.addEventListener('icegatheringstatechange', done); done();
  });
  return rtc.localDescription!.toJSON();
}
export async function offer() {
  rtc = new RTCPeerConnection({ iceServers: [] });
  attach(rtc.createDataChannel('battleship-test'));
  await rtc.setLocalDescription(await rtc.createOffer());
  return gathered();
}
export async function answer(offer: RTCSessionDescriptionInit) {
  rtc = new RTCPeerConnection({ iceServers: [] });
  rtc.ondatachannel = event => attach(event.channel);
  await rtc.setRemoteDescription(offer);
  await rtc.setLocalDescription(await rtc.createAnswer());
  return gathered();
}
export const finish = (answer: RTCSessionDescriptionInit) => rtc.setRemoteDescription(answer);
export const isOpen = () => data?.readyState === 'open';
export const receivedSignals = () => signals;
export function start(role: 'host' | 'guest') {
  const playerID = role === 'host' ? '0' : '1';
  const Board = (props: React.ComponentProps<typeof MerkleBattleshipBoard>) => {
    currentPlayer = props.ctx.currentPlayer;
    return <MerkleBattleshipBoard {...props} p2pConnection={channel} />;
  };
  const Game = Client({ game: MerkleBattleshipGame, board: Board, numPlayers: 2, debug: false,
    multiplayer: P2PMultiplayer({ role, playerID, matchID: 'rtc-battleship', numPlayers: 2,
      connection: channel, hostConnections: role === 'host' ? new Map([['1', channel]]) : undefined }) });
  createRoot(document.getElementById('root')!).render(<Game playerID={playerID} matchID="rtc-battleship" />);
}
