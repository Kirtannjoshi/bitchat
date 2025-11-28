import { WebSocketServer } from 'ws';

export default function handler(req, res) {
    if (req.method === 'GET') {
        res.status(200).json({
            message: 'WebSocket server endpoint',
            note: 'Vercel does not support WebSocket servers. Please use a dedicated WebSocket service like Pusher, Ably, or deploy the signaling server separately on Railway/Render.'
        });
    } else {
        res.status(405).json({ error: 'Method not allowed' });
    }
}
