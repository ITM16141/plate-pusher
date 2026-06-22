import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

const app = express();
// 環境変数 FRONTEND_URL を読み込み、なければローカル開発用URLをフォールバック
const allowedOrigins = [process.env.FRONTEND_URL || "http://localhost:5173"];

app.use(cors({
    origin: allowedOrigins,
    credentials: true
}));

const PORT = process.env.PORT || 3000;
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: allowedOrigins,
        methods: ["GET", "POST"]
    }
});

// ゲームデータ型定義
interface DangerZone { name: string; lat: number; lng: number; influenceRange: number; }
interface Player { id: string; name: string; score: number; lives: number; isAlive: boolean; isHost: boolean; isReady: boolean; }
interface Room { players: Player[]; currentTurnIdx: number; gameStarted: boolean; countdownTimer: NodeJS.Timeout | null; countdownSeconds: number; }

const DANGER_ZONES: DangerZone[] = [
    { name: '日本海溝・南海トラフ', lat: 34.0, lng: 138.0, influenceRange: 8.0 },
    { name: 'サンアンドレアス断層', lat: 36.0, lng: -120.0, influenceRange: 8.0 },
    { name: 'チリ海溝', lat: -30.0, lng: -72.0, influenceRange: 12.0 },
    { name: 'スマトラ海溝', lat: -2.0, lng: 101.0, influenceRange: 10.0 },
];

const rooms: { [key: string]: Room } = {};

function sendRoomUpdate(roomCode: string) {
    const room = rooms[roomCode];
    if (!room) return;
    io.to(roomCode).emit('room_players_updated', {
        players: room.players,
        turnPlayerId: room.players[room.currentTurnIdx]?.id || '',
        gameStarted: room.gameStarted,
        countdownSeconds: room.countdownSeconds
    });
}

function advanceTurn(roomCode: string) {
    const room = rooms[roomCode];
    if (!room) return;
    let safetyCounter = 0;
    do {
        room.currentTurnIdx = (room.currentTurnIdx + 1) % room.players.length;
        safetyCounter++;
    } while (!room.players[room.currentTurnIdx].isAlive && safetyCounter < room.players.length);
}

io.on('connection', (socket) => {
    let currentRoom = '';
    let playerName = '';

    socket.on('join_game', (data: { mode: 'single' | 'random' | 'create_private' | 'join_private'; name: string; roomCode?: string }) => {
        playerName = data.name || '名無し';
        currentRoom = data.mode === 'single' ? socket.id : (data.roomCode || 'RANDOM-ROOM');

        if (!rooms[currentRoom]) {
            rooms[currentRoom] = { players: [], currentTurnIdx: 0, gameStarted: false, countdownTimer: null, countdownSeconds: 0 };
        }

        rooms[currentRoom].players.push({
            id: socket.id, name: playerName, score: 0, lives: 3, isAlive: true,
            isHost: rooms[currentRoom].players.length === 0, isReady: false
        });

        socket.join(currentRoom);
        socket.emit('init_room', { roomCode: currentRoom, isHost: rooms[currentRoom].players.length === 1 });
        sendRoomUpdate(currentRoom);
    });

    socket.on('plate_subduct', (data: { lat: number; lng: number; intensity: number }) => {
        const room = rooms[currentRoom];
        if (!room || !room.gameStarted || room.players[room.currentTurnIdx].id !== socket.id) return;

        let maxDanger = 0;
        DANGER_ZONES.forEach(z => {
            const dist = Math.sqrt(Math.pow(data.lat - z.lat, 2) + Math.pow(data.lng - z.lng, 2));
            const danger = Math.max(0, 1 - dist / z.influenceRange);
            maxDanger = Math.max(maxDanger, danger);
        });

        const isEarthquake = Math.random() < (maxDanger * (data.intensity / 100) * 2.0);

        if (isEarthquake) {
            room.players = room.players.map(p => p.id === socket.id ? { ...p, lives: p.lives - 1, isAlive: p.lives > 1 } : p);
        } else {
            room.players = room.players.map(p => p.id === socket.id ? { ...p, score: p.score + Math.round(data.intensity * (1 + maxDanger * 2)) } : p);
        }

        advanceTurn(currentRoom);
        io.to(currentRoom).emit('earthquake_result', {
            isEarthquake,
            message: isEarthquake ? "地震発生！" : "沈み込み成功！",
            clickLocation: data,
            nextTurnPlayerId: room.players[room.currentTurnIdx].id
        });
        sendRoomUpdate(currentRoom);
    });

    socket.on('disconnect', () => {
        const room = rooms[currentRoom];
        if (room) {
            room.players = room.players.filter(p => p.id !== socket.id);
            if (room.players.length === 0) delete rooms[currentRoom];
            else sendRoomUpdate(currentRoom);
        }
    });
});

httpServer.listen(PORT, () => console.log(`Server running on port ${PORT}`));