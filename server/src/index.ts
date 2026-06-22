import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';

const app = express();
app.use(cors({origin: "*"}));

const PORT = process.env.PORT || 3000;
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        // 修正前：origin: [process.env.FRONTEND_URL || "http://localhost:5173"],
        origin: "*", // ★ ここを "*" に書き換えて、環境変数に頼らずすべて許可する
        methods: ["GET", "POST"]
    }
});

interface DangerZone {
    name: string; lat: number; lng: number; influenceRange: number;
}
const DANGER_ZONES: DangerZone[] = [
    { name: '日本海溝・南海トラフ（日本近海）', lat: 34.0, lng: 138.0, influenceRange: 8.0 },
    { name: 'サンアンドレアス断層（北米西海岸）', lat: 36.0, lng: -120.0, influenceRange: 8.0 },
    { name: 'チリ海溝（南米西海岸）', lat: -30.0, lng: -72.0, influenceRange: 12.0 },
    { name: 'スマトラ海溝（インドネシア付近）', lat: -2.0, lng: 101.0, influenceRange: 10.0 },
];

interface Player {
    id: string;
    name: string;
    score: number;
    lives: number;
    isAlive: boolean;
    isHost: boolean;
    isReady: boolean;
}

interface Room {
    players: Player[];
    currentTurnIdx: number;
    gameStarted: boolean;
    countdownTimer: NodeJS.Timeout | null;
    countdownSeconds: number;
}
const rooms: { [key: string]: Room } = {};

function generateRoomCode(): string {
    return Math.random().toString(36).substring(2, 6).toUpperCase();
}

// 部屋の状態を全員に一括同期する
function sendRoomUpdate(roomCode: string) {
    const room = rooms[roomCode];
    if (!room) return;
    const turnPlayerId = room.players[room.currentTurnIdx]?.id || '';
    io.to(roomCode).emit('room_players_updated', {
        players: room.players,
        turnPlayerId,
        gameStarted: room.gameStarted,
        countdownSeconds: room.countdownSeconds
    });
}

// 16人満員時の自動開始カウントダウン
function startRoomCountdown(roomCode: string) {
    const room = rooms[roomCode];
    if (!room || room.countdownTimer) return;

    room.countdownSeconds = 10;
    io.to(roomCode).emit('system_message', '⚠️ ルームが満員（16人）に達しました！10秒後に自動的にゲームを開始します。');

    room.countdownTimer = setInterval(() => {
        if (!rooms[roomCode]) {
            clearInterval(room.countdownTimer!);
            return;
        }
        rooms[roomCode].countdownSeconds--;
        sendRoomUpdate(roomCode);

        if (rooms[roomCode].countdownSeconds <= 0) {
            clearInterval(rooms[roomCode].countdownTimer!);
            rooms[roomCode].countdownTimer = null;

            // ゲーム強制開始
            rooms[roomCode].gameStarted = true;
            rooms[roomCode].currentTurnIdx = 0;
            io.to(roomCode).emit('game_start_confirmed', {
                turnPlayerId: rooms[roomCode].players[0].id
            });
            sendRoomUpdate(roomCode);
        }
    }, 1000);
}

// 次の生存者にターンを回す
function advanceTurn(roomCode: string) {
    const room = rooms[roomCode];
    if (!room) return;
    const alivePlayers = room.players.filter(p => p.isAlive);
    if (alivePlayers.length <= 1) return;

    let safetyCounter = 0;
    do {
        room.currentTurnIdx = (room.currentTurnIdx + 1) % room.players.length;
        safetyCounter++;
    } while (!room.players[room.currentTurnIdx].isAlive && safetyCounter < room.players.length);
}

io.on('connection', (socket) => {
    console.log(`ユーザー接続: ${socket.id}`);
    let currentRoom = '';
    let playerName = '';

    socket.on('join_game', (data: { mode: 'single' | 'random' | 'create_private' | 'join_private'; name: string; roomCode?: string }) => {
        playerName = data.name || '名無しプレイヤー';

        if (data.mode === 'single') {
            currentRoom = socket.id;
            rooms[currentRoom] = {
                players: [{ id: socket.id, name: playerName, score: 0, lives: 3, isAlive: true, isHost: true, isReady: true }],
                currentTurnIdx: 0,
                gameStarted: true,
                countdownTimer: null,
                countdownSeconds: 0
            };
            socket.emit('init_room', { roomCode: 'SINGLE', isHost: true });
            socket.emit('game_start_confirmed', { turnPlayerId: socket.id });
        } else {
            if (data.mode === 'random') {
                currentRoom = 'RANDOM-ROOM';
            } else if (data.mode === 'create_private') {
                currentRoom = generateRoomCode();
            } else if (data.mode === 'join_private') {
                currentRoom = data.roomCode ? data.roomCode.toUpperCase() : '';
            }

            if (!currentRoom) {
                socket.emit('error_message', 'ルームコードが無効です。');
                return;
            }

            if (rooms[currentRoom]) {
                if (rooms[currentRoom].players.length >= 16) {
                    socket.emit('error_message', 'ルームが満員（上限16人）のため入室できません。');
                    return;
                }
                if (rooms[currentRoom].gameStarted) {
                    socket.emit('error_message', 'このルームのゲームは既に開始されています。');
                    return;
                }
            } else {
                rooms[currentRoom] = { players: [], currentTurnIdx: 0, gameStarted: false, countdownTimer: null, countdownSeconds: 0 };
            }

            const isHost = rooms[currentRoom].players.length === 0;
            rooms[currentRoom].players.push({
                id: socket.id,
                name: playerName,
                score: 0,
                lives: 3,
                isAlive: true,
                isHost,
                isReady: isHost
            });

            socket.join(currentRoom);
            socket.emit('init_room', { roomCode: currentRoom, isHost });

            io.to(currentRoom).emit('system_message', `${playerName} さんが入室しました。`);
            sendRoomUpdate(currentRoom);

            if (rooms[currentRoom].players.length === 16) {
                startRoomCountdown(currentRoom);
            }
        }
    });

    socket.on('toggle_ready', () => {
        const room = rooms[currentRoom];
        if (!room || room.gameStarted || room.players.length === 16) return;

        room.players = room.players.map(p =>
            p.id === socket.id ? { ...p, isReady: !p.isReady } : p
        );
        sendRoomUpdate(currentRoom);
    });

    socket.on('start_game', () => {
        const room = rooms[currentRoom];
        if (!room || room.gameStarted || room.players.length === 16) return;

        const player = room.players.find(p => p.id === socket.id);
        if (!player || !player.isHost) return;

        room.gameStarted = true;
        room.currentTurnIdx = 0;
        io.to(currentRoom).emit('game_start_confirmed', { turnPlayerId: room.players[0].id });
        sendRoomUpdate(currentRoom);
    });

    socket.on('plate_subduct', (data: { lat: number; lng: number }) => {
        const room = rooms[currentRoom];
        if (!room || !room.gameStarted) return;

        const currentTurnPlayer = room.players[room.currentTurnIdx];
        if (currentTurnPlayer.id !== socket.id) return;

        let maxCalculatedDanger = 0;
        let activeZoneName = '平穏なプレート中央';

        DANGER_ZONES.forEach((zone) => {
            const distance = Math.sqrt(Math.pow(data.lat - zone.lat, 2) + Math.pow(data.lng - zone.lng, 2));
            const danger = Math.max(0, 1 - distance / zone.influenceRange);
            if (danger > maxCalculatedDanger) {
                maxCalculatedDanger = danger;
                activeZoneName = zone.name;
            }
        });

        const dangerPercentage = Math.round(maxCalculatedDanger * 100);
        const isEarthquake = Math.random() < maxCalculatedDanger;
        const gainedScore = dangerPercentage > 0 ? dangerPercentage * 10 : 10;

        if (isEarthquake) {
            room.players = room.players.map(p => {
                if (p.id === socket.id) {
                    const nextLives = p.lives - 1;
                    return { ...p, lives: nextLives, isAlive: nextLives > 0 };
                }
                return p;
            });

            const pState = room.players.find(p => p.id === socket.id);
            const isDead = pState ? !pState.isAlive : true;

            advanceTurn(currentRoom);
            const nextTurnPlayerId = room.players[room.currentTurnIdx]?.id || '';

            io.to(currentRoom).emit('earthquake_result', {
                targetPlayerId: socket.id,
                isEarthquake: true,
                dangerLevel: dangerPercentage,
                triggeredZone: activeZoneName,
                message: isDead
                    ? `【脱落】${playerName} さんが ${activeZoneName} で大地震を起こし、ライフが尽きて脱落しました！`
                    : `【地震発生】${playerName} さんが ${activeZoneName} で地震を誘発！ライフ残り: ${pState?.lives}`,
                clickLocation: data,
                nextTurnPlayerId
            });
        } else {
            room.players = room.players.map(p =>
                p.id === socket.id ? { ...p, score: p.score + gainedScore } : p
            );

            advanceTurn(currentRoom);
            const nextTurnPlayerId = room.players[room.currentTurnIdx]?.id || '';

            io.to(currentRoom).emit('earthquake_result', {
                targetPlayerId: socket.id,
                isEarthquake: false,
                dangerLevel: dangerPercentage,
                triggeredZone: activeZoneName,
                gainedScore,
                message: `${playerName} さんが沈み込みに成功！ (+${gainedScore} 点)`,
                clickLocation: data,
                nextTurnPlayerId
            });
        }

        sendRoomUpdate(currentRoom);
    });

    socket.on('retry_game', () => {
        const room = rooms[currentRoom];
        if (room && room.gameStarted) {
            room.players = room.players.map(p =>
                p.id === socket.id ? { ...p, score: 0, lives: 3, isAlive: true } : p
            );
            sendRoomUpdate(currentRoom);
            io.to(currentRoom).emit('system_message', `${playerName} さんが復活しました！`);
        }
    });

    const leaveActiveRoom = () => {
        const room = rooms[currentRoom];
        if (room) {
            const wasMyTurn = room.players[room.currentTurnIdx]?.id === socket.id;
            const wasHost = room.players.find(p => p.id === socket.id)?.isHost;

            room.players = room.players.filter(p => p.id !== socket.id);

            if (room.players.length === 0) {
                if (room.countdownTimer) clearInterval(room.countdownTimer);
                delete rooms[currentRoom];
            } else {
                if (wasHost && room.players.length > 0) {
                    room.players[0].isHost = true;
                    room.players[0].isReady = true;
                }

                if (room.players.length < 16 && room.countdownTimer) {
                    clearInterval(room.countdownTimer);
                    room.countdownTimer = null;
                    room.countdownSeconds = 0;
                    io.to(currentRoom).emit('system_message', '👥 人数が16人未満になったため、自動開始カウントダウンを停止しました。');
                }

                if (room.gameStarted && wasMyTurn) {
                    room.currentTurnIdx = room.currentTurnIdx % room.players.length;
                }

                sendRoomUpdate(currentRoom);
                io.to(currentRoom).emit('system_message', `${playerName} さんが退室しました。`);
            }
            socket.leave(currentRoom);
        }
        currentRoom = '';
    };

    socket.on('leave_game', () => { leaveActiveRoom(); });
    socket.on('disconnect', () => { leaveActiveRoom(); console.log(`ユーザー切断: ${socket.id}`); });
});

httpServer.listen(PORT, () => { console.log(`サーバー起動: ポート ${PORT}`); });
