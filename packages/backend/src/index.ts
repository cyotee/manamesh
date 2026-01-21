import express from 'express';
import { createLibp2p } from 'libp2p';
import { webRTC } from '@libp2p/webrtc';

const app = express();
app.use(express.json());

app.get('/health', (req, res) => res.send('OK'));

// Mock libp2p node for testing
async function startNode() {
    const node = await createLibp2p({ transports: [webRTC()] });
    console.log('libp2p node started');
    return node;
}

startNode();

app.listen(4000, () => console.log('Server on port 4000'));