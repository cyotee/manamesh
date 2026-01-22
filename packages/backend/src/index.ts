import express from 'express';
import { createServer } from 'http';
import { createLibp2p } from 'libp2p';
import { webRTC } from '@libp2p/webrtc';
import { attachSignaling, getSignalingStats } from './signaling.js';

const app = express();
app.use(express.json());

app.get('/health', (req, res) => res.send('OK'));

app.get('/stats', (_req, res) => {
    const signalingStats = getSignalingStats();
    res.json({
        status: 'healthy',
        signaling: signalingStats
    });
});

// Mock libp2p node for testing
async function startNode() {
    const node = await createLibp2p({ transports: [webRTC()] });
    console.log('libp2p node started');
    return node;
}

startNode();

const server = createServer(app);
attachSignaling(server);

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`Server on port ${PORT}`));