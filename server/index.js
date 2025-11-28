import { WebSocketServer, WebSocket } from 'ws';

const wss = new WebSocketServer({ port: 8081, host: '0.0.0.0' });

// Store clients: { "room_id": [ws1, ws2, ...] }
const rooms = {};

console.log("📡 Signaling Server listening on port 8081");

wss.on('connection', (ws) => {
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            const { type, roomId, payload } = data;

            if (type === 'join') {
                if (!rooms[roomId]) {
                    rooms[roomId] = new Set();
                }
                rooms[roomId].add(ws);
                ws.roomId = roomId; // Tag socket with room
                console.log(`Client joined room: ${roomId}. Total: ${rooms[roomId].size}`);

                // Notify others in room
                broadcastToRoom(ws, roomId, { type: 'peer-joined' });
            }
            else if (type === 'offer' || type === 'answer' || type === 'ice-candidate') {
                // Relay WebRTC signaling data to others in the room
                broadcastToRoom(ws, roomId, data);
            }
            else if (type === 'leave') {
                leaveRoom(ws);
            }
        } catch (e) {
            console.error("Error parsing message:", e);
        }
    });

    ws.on('close', () => {
        leaveRoom(ws);
    });
});

function broadcastToRoom(senderWs, roomId, data) {
    if (rooms[roomId]) {
        rooms[roomId].forEach(client => {
            if (client !== senderWs && client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify(data));
            }
        });
    }
}

function leaveRoom(ws) {
    if (ws.roomId && rooms[ws.roomId]) {
        rooms[ws.roomId].delete(ws);
        console.log(`Client left room: ${ws.roomId}. Total: ${rooms[ws.roomId].size}`);
        if (rooms[ws.roomId].size === 0) {
            delete rooms[ws.roomId];
        } else {
            // Notify others
            broadcastToRoom(ws, ws.roomId, { type: 'peer-left' });
        }
    }
}
