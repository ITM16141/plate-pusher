import { useState, useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, GeoJSON, useMapEvents, CircleMarker } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { LatLng } from 'leaflet';
import { io, Socket } from 'socket.io-client';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3000';
let socket: Socket;

interface Player { id: string; name: string; score: number; lives: number; isAlive: boolean; isHost: boolean; isReady: boolean; }

function MapClickHandler({ onClick, disabled }: { onClick: (latlng: LatLng) => void; disabled: boolean }) {
    useMapEvents({
        click(e) {
            if (disabled) return;
            onClick(e.latlng);
        },
    });
    return null;
}

function App() {
    const [name, setName] = useState<string>('');
    const [mode, setMode] = useState<'single' | 'random' | 'create_private' | 'join_private' | null>(null);

    const [isPlaying, setIsPlaying] = useState<boolean>(false);
    const [isGameStarted, setIsGameStarted] = useState<boolean>(false);
    const [isHost, setIsHost] = useState<boolean>(false);
    const [isConnected, setIsConnected] = useState<boolean>(false);

    const [inputRoomCode, setInputRoomCode] = useState<string>('');
    const [activeRoomCode, setActiveRoomCode] = useState<string>('');

    const [location, setLocation] = useState<LatLng | null>(null);
    const [score, setScore] = useState<number>(0);
    const [myLives, setMyLives] = useState<number>(3);
    const [dangerLevel, setDangerLevel] = useState<number>(0);
    const [triggeredZone, setTriggeredZone] = useState<string>('');
    const [isGameOver, setIsGameOver] = useState<boolean>(false);
    const [message, setMessage] = useState<string>('');
    const [players, setPlayers] = useState<Player[]>([]);
    const [systemLogs, setSystemLogs] = useState<string[]>([]);

    const [currentTurnPlayerId, setCurrentTurnPlayerId] = useState<string>('');
    const [countdownSeconds, setCountdownSeconds] = useState<number>(0);

    // ★ 新規追加: 断面図モーダル用のステート
    const [showModal, setShowModal] = useState<boolean>(false);
    const [subductionDepth, setSubductionDepth] = useState<number>(0); // 0 〜 100%
    const [isDragging, setIsDragging] = useState<boolean>(false);
    const [pendingLocation, setPendingLocation] = useState<LatLng | null>(null);

    const [plateData, setPlateData] = useState(null);

    useEffect(() => {
        fetch('/plates.json')
            .then((res) => res.json())
            .then((data) => setPlateData(data));
    }, []);

    const plateLayer = useMemo(() => {
        if (!plateData) return null;
        return (
            <GeoJSON
                data={plateData}
                style={{ color: '#ffeb3b', weight: 2, opacity: 0.7 }}
            />
        );
    }, [plateData]);

    useEffect(() => {
        if (!isPlaying || !mode) return;

        socket = io(SERVER_URL);

        socket.on('connect', () => {
            setIsConnected(true);
            socket.emit('join_game', { mode, name, roomCode: inputRoomCode });
        });

        socket.on('init_room', (data: { roomCode: string; isHost: boolean }) => {
            setActiveRoomCode(data.roomCode);
            setIsHost(data.isHost);
        });

        socket.on('room_players_updated', (data: { players: Player[]; turnPlayerId: string; gameStarted: boolean; countdownSeconds: number }) => {
            setPlayers(data.players);
            setCurrentTurnPlayerId(data.turnPlayerId);
            setCountdownSeconds(data.countdownSeconds);
            if (data.gameStarted) setIsGameStarted(true);

            const myData = data.players.find(p => p.id === socket.id);
            if (myData) {
                setScore(myData.score);
                setMyLives(myData.lives);
                setIsHost(myData.isHost);
                if (!myData.isAlive) setIsGameOver(true);
            }
        });

        socket.on('game_start_confirmed', (data: { turnPlayerId: string }) => {
            setIsGameStarted(true);
            setCurrentTurnPlayerId(data.turnPlayerId);
            setMessage('ゲームスタート！プレートの沈み込みを開始してください。');
        });

        socket.on('system_message', (log: string) => {
            setSystemLogs(prev => [log, ...prev].slice(0, 5));
        });

        socket.on('error_message', (err: string) => {
            alert(err);
            // eslint-disable-next-line react-hooks/immutability
            handleLeaveTitle();
        });

        socket.on('earthquake_result', (data: {
            targetPlayerId: string; isEarthquake: boolean; dangerLevel: number; triggeredZone: string; gainedScore: number; message: string; clickLocation: { lat: number; lng: number }; nextTurnPlayerId: string
        }) => {
            setDangerLevel(data.dangerLevel);
            setTriggeredZone(data.triggeredZone);
            setMessage(data.message);
            setLocation(new LatLng(data.clickLocation.lat, data.clickLocation.lng));
            setCurrentTurnPlayerId(data.nextTurnPlayerId);
        });

        return () => { socket.disconnect(); };
    }, [inputRoomCode, isPlaying, mode, name]);

    // ★ 修正: 地図クリック時はすぐに送信せず、モーダルを開く
    const handleMapClick = (latlng: LatLng) => {
        setPendingLocation(latlng);
        setSubductionDepth(0);
        setShowModal(true);
    };

    // ★ 追加: ドラッグ中の深さ計算ロジック
    const calculateDepth = (clientY: number, currentTarget: SVGSVGElement) => {
        if (!isDragging) return;
        const rect = currentTarget.getBoundingClientRect();
        const y = clientY - rect.top;
        // Y座標 100px を 0%、250px を 100% として計算
        let percentage = ((y - 100) / 150) * 100;
        if (percentage < 0) percentage = 0;
        if (percentage > 100) percentage = 100;
        setSubductionDepth(Math.round(percentage));
    };

    // ★ 追加: サーバーに沈み込み度を送信してターンを進める
    const submitSubduction = () => {
        setShowModal(false);
        setMessage('プレート変動を同期中...');
        if (pendingLocation) {
            socket.emit('plate_subduct', {
                lat: pendingLocation.lat,
                lng: pendingLocation.lng,
                intensity: subductionDepth
            });
        }
    };

    const handleToggleReady = () => { socket.emit('toggle_ready'); };
    const handleStartGame = () => { socket.emit('start_game'); };
    const handleReset = () => {
        setIsGameOver(false); setLocation(null); setDangerLevel(0); setTriggeredZone('');
        socket.emit('retry_game'); setMessage('戦線に復帰しました！自分のターンを待ちましょう。');
    };

    const handleLeaveTitle = () => {
        if (socket) { socket.emit('leave_game'); socket.disconnect(); }
        setIsPlaying(false); setIsGameStarted(false); setMode(null); setIsGameOver(false);
        setLocation(null); setScore(0); setMyLives(3); setDangerLevel(0); setTriggeredZone('');
        setPlayers([]); setSystemLogs([]); setActiveRoomCode(''); setCurrentTurnPlayerId('');
        setCountdownSeconds(0); setIsConnected(false); setShowModal(false);
    };

    const isMyTurn = socket && socket.id === currentTurnPlayerId;
    const currentTurnPlayerName = players.find(p => p.id === currentTurnPlayerId)?.name || '対戦相手';
    const isRoomFull = players.length >= 16;
    const amIReady = players.find(p => p.id === socket?.id)?.isReady || false;

    // 1. タイトル画面
    if (!isPlaying) {
        return (
            <div style={{ textAlign: 'center', fontFamily: 'sans-serif', padding: '50px', backgroundColor: '#f5f5f5', minHeight: '100vh' }}>
                <h1 style={{ fontSize: '2.5rem', color: '#333' }}>🌋 チキチキプレート沈み込みゲーム 🌊</h1>
                <p style={{ color: '#666' }}>世界のプレートを交互に刺激し合う、最大16人の地殻変動バトルロイヤル</p>
                <div style={{ margin: '30px' }}>
                    <input type="text" placeholder="プレイヤー名を入力" value={name} onChange={(e) => setName(e.target.value)} style={{ padding: '12px', fontSize: '1.1rem', width: '280px', borderRadius: '6px', border: '2px solid #ccc' }} />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '15px', maxWidth: '400px', margin: '0 auto' }}>
                    <button onClick={() => { setMode('single'); setIsPlaying(true); }} disabled={!name} style={{ width: '100%', padding: '12px', fontSize: '1.1rem', backgroundColor: '#4caf50', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>シングルプレイ</button>
                    <button onClick={() => { setMode('random'); setIsPlaying(true); }} disabled={!name} style={{ width: '100%', padding: '12px', fontSize: '1.1rem', backgroundColor: '#2196f3', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>ランダムマッチ</button>
                    <div style={{ width: '100%', height: '2px', backgroundColor: '#ddd', margin: '10px 0' }}></div>
                    <button onClick={() => { setMode('create_private'); setIsPlaying(true); }} disabled={!name} style={{ width: '100%', padding: '12px', fontSize: '1.1rem', backgroundColor: '#9c27b0', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>プライベート部屋を作る</button>
                    <div style={{ display: 'flex', width: '100%', gap: '10px' }}>
                        <input type="text" placeholder="4桁のルームコード" value={inputRoomCode} onChange={(e) => setInputRoomCode(e.target.value.toUpperCase())} style={{ flex: 1, padding: '10px', fontSize: '1rem', borderRadius: '6px', border: '1px solid #ccc' }} />
                        <button onClick={() => { setMode('join_private'); setIsPlaying(true); }} disabled={!name || !inputRoomCode} style={{ padding: '10px 20px', fontSize: '1rem', backgroundColor: '#ff9800', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer' }}>部屋に入る</button>
                    </div>
                </div>
            </div>
        );
    }

    // 1.5 サーバー接続待ち画面
    if (isPlaying && !isConnected) {
        return (
            <div style={{ fontFamily: 'sans-serif', padding: '50px', backgroundColor: '#eef2f5', minHeight: '100vh', textAlign: 'center' }}>
                <h2 style={{ fontSize: '2rem', color: '#1976d2' }}>📡 サーバーに接続しています...</h2>
                <p style={{ color: '#666', fontSize: '1.1rem', marginTop: '20px', lineHeight: '1.6' }}>しばらくそのままお待ちください！</p>
            </div>
        );
    }

    // 2. 待機ロビー画面（マルチプレイ時、ゲーム開始前）
    if (isPlaying && !isGameStarted) {
        return (
            <div style={{ fontFamily: 'sans-serif', padding: '30px', backgroundColor: '#eef2f5', minHeight: '100vh', textAlign: 'center' }}>
                <h2>🎮 対戦待機ロビー ({players.length} / 16人)</h2>
                {activeRoomCode && activeRoomCode !== 'SINGLE' && (
                    <div style={{ margin: '15px 0' }}>
            <span style={{ backgroundColor: '#333', color: 'white', padding: '10px 20px', borderRadius: '6px', fontFamily: 'monospace', fontSize: '1.4rem', fontWeight: 'bold' }}>
              ROOM CODE: {activeRoomCode}
            </span>
                    </div>
                )}

                {/* 16人満員時のカウントダウン表示 */}
                {countdownSeconds > 0 && (
                    <div style={{ backgroundColor: '#ffeb3b', padding: '15px', borderRadius: '6px', fontWeight: 'bold', fontSize: '1.3rem', border: '2px solid #f57f17', color: '#b71c1c', maxWidth: '500px', margin: '15px auto' }}>
                        🔥 ルームが満員になりました！あと {countdownSeconds} 秒で自動開始します！
                    </div>
                )}

                <div style={{ maxWidth: '600px', margin: '30px auto', backgroundColor: 'white', padding: '20px', borderRadius: '8px', boxShadow: '0 4px 6px rgba(0,0,0,0.05)' }}>
                    <h3>参加プレイヤー一覧</h3>
                    <ul style={{ listStyle: 'none', padding: 0, textAlign: 'left' }}>
                        {players.map((p) => (
                            <li key={p.id} style={{ padding: '12px', borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontWeight: p.id === socket.id ? 'bold' : 'normal', color: p.id === socket.id ? '#1976d2' : '#333' }}>
                  {p.name} {p.id === socket.id && ' (あなた)'}
                </span>
                                <div>
                                    {p.isHost && <span style={{ backgroundColor: '#e91e63', color: 'white', padding: '3px 8px', borderRadius: '4px', fontSize: '0.8rem', marginRight: '5px', fontWeight: 'bold' }}>👑 ホスト</span>}
                                    {p.isReady ? (
                                        <span style={{ color: '#2e7d32', fontWeight: 'bold' }}>✅ 準備完了</span>
                                    ) : (
                                        <span style={{ color: '#ef6c00', fontWeight: 'bold' }}>⏳ 待機中</span>
                                    )}
                                </div>
                            </li>
                        ))}
                    </ul>
                </div>

                {/* アクションボタン */}
                <div style={{ display: 'flex', justifyContent: 'center', gap: '20px', marginTop: '20px' }}>
                    <button onClick={handleLeaveTitle} style={{ padding: '12px 24px', fontSize: '1rem', backgroundColor: '#e0e0e0', color: '#333', border: '1px solid #aaa', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold' }}>
                        🚪 タイトルに戻る
                    </button>

                    {isHost ? (
                        <button
                            onClick={handleStartGame}
                            disabled={isRoomFull}
                            style={{ padding: '12px 30px', fontSize: '1.1rem', backgroundColor: isRoomFull ? '#999' : '#4caf50', color: 'white', border: 'none', borderRadius: '6px', cursor: isRoomFull ? 'not-allowed' : 'pointer', fontWeight: 'bold' }}
                        >
                            🚀 ゲームを開始する（ホスト権限）
                        </button>
                    ) : (
                        <button
                            onClick={handleToggleReady}
                            disabled={isRoomFull}
                            style={{ padding: '12px 30px', fontSize: '1.1rem', backgroundColor: isRoomFull ? '#999' : amIReady ? '#ff5722' : '#ff9800', color: 'white', border: 'none', borderRadius: '6px', cursor: isRoomFull ? 'not-allowed' : 'pointer', fontWeight: 'bold' }}
                        >
                            {amIReady ? '❌ 準備完了を取り消す' : '👍 準備完了！'}
                        </button>
                    )}
                </div>
            </div>
        );
    }

    // 3. メインゲーム画面
    return (
        <div style={{ fontFamily: 'sans-serif', padding: '20px', backgroundColor: '#f5f5f5', minHeight: '100vh', position: 'relative' }}>

            {/* ★ 追加: 断面図モーダル UI */}
            {showModal && (
                <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', backgroundColor: 'rgba(0,0,0,0.6)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 9999 }}>
                    <div style={{ backgroundColor: 'white', padding: '30px', borderRadius: '12px', textAlign: 'center', width: '90%', maxWidth: '500px', boxShadow: '0 10px 25px rgba(0,0,0,0.3)' }}>
                        <h3 style={{ margin: '0 0 10px 0', color: '#333' }}>🌋 プレート沈み込みシミュレーター</h3>
                        <p style={{ color: '#666', marginBottom: '20px' }}>オレンジの点を<strong>下へドラッグ</strong>してエネルギーを蓄積！</p>

                        <svg
                            width="100%" height="280" viewBox="0 0 400 280"
                            style={{ border: '2px solid #ccc', backgroundColor: '#eef2f5', cursor: isDragging ? 'grabbing' : 'ns-resize', touchAction: 'none', borderRadius: '8px' }}
                            onMouseMove={(e) => calculateDepth(e.clientY, e.currentTarget)}
                            onTouchMove={(e) => calculateDepth(e.touches[0].clientY, e.currentTarget)}
                            onMouseUp={() => setIsDragging(false)}
                            onMouseLeave={() => setIsDragging(false)}
                            onTouchEnd={() => setIsDragging(false)}
                        >
                            {/* 大陸プレート（固定） */}
                            <path d="M 200,100 L 400,100 L 400,280 L 200,280 Z" fill="#8d6e63" />
                            <text x="250" y="150" fill="white" fontWeight="bold" fontSize="18">大陸プレート</text>

                            {/* 海洋プレート（ドラッグで動く） */}
                            <line
                                x1="0" y1="100"
                                x2="200" y2={100 + (subductionDepth * 1.5)}
                                stroke="#546e7a" strokeWidth="25" strokeLinecap="round"
                            />
                            <text x="30" y={80 + (subductionDepth * 0.7)} fill="#333" fontWeight="bold" fontSize="18">海洋プレート</text>

                            {/* つまみ */}
                            <circle
                                cx="200" cy={100 + (subductionDepth * 1.5)} r="18" fill={isDragging ? '#d84315' : '#ff5722'}
                                onMouseDown={() => setIsDragging(true)}
                                onTouchStart={() => setIsDragging(true)}
                                style={{ cursor: 'grab' }}
                            />
                        </svg>

                        <div style={{ margin: '20px 0', fontSize: '1.4rem', fontWeight: 'bold', color: subductionDepth > 80 ? 'red' : '#ff5722' }}>
                            ひずみエネルギー: {subductionDepth} %
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'center', gap: '15px' }}>
                            <button onClick={() => setShowModal(false)} style={{ padding: '12px 24px', backgroundColor: '#ccc', color: '#333', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer' }}>やめる</button>
                            <button
                                onClick={submitSubduction}
                                style={{ padding: '12px 24px', backgroundColor: '#d32f2f', color: 'white', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer', boxShadow: '0 4px 6px rgba(211, 47, 47, 0.3)' }}
                            >
                                ここで断層破壊！（決定）
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* 以下は既存のレイアウト構造 */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px', borderBottom: '2px solid #ddd', paddingBottom: '10px' }}>
                <div>
                    <span style={{ fontSize: '1.2rem', fontWeight: 'bold', marginRight: '15px' }}>モード: {mode === 'single' ? 'シングル' : mode === 'random' ? 'ランダム' : 'プライベート'}</span>
                </div>
                <button onClick={handleLeaveTitle} style={{ padding: '8px 16px', backgroundColor: '#e0e0e0', color: '#333', border: '1px solid #999', borderRadius: '4px', cursor: 'pointer' }}>🚪 退出</button>
            </div>

            <div style={{ display: 'flex', justifyContent: 'center', gap: '30px' }}>
                <div style={{ width: '75%', textAlign: 'center' }}>
                    <div style={{ padding: '10px', borderRadius: '6px', marginBottom: '15px', fontSize: '1.3rem', fontWeight: 'bold', backgroundColor: isGameOver ? '#ffebee' : isMyTurn ? '#e8f5e9' : '#fff3e0', color: isGameOver ? 'red' : isMyTurn ? '#2e7d32' : '#ef6c00', border: `2px solid ${isGameOver ? 'red' : isMyTurn ? '#4caf50' : '#ff9800'}` }}>
                        {isGameOver ? '💀 あなたは脱落しています' : isMyTurn ? '👉 あなたのターンです！地図をクリックしてください。' : `⏳ ${currentTurnPlayerName} さんのターンを待っています...`}
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'center', gap: '40px', alignItems: 'center' }}>
                        <p style={{ fontSize: '1.2rem' }}>スコア: <strong style={{ color: '#00c853', fontSize: '1.5rem' }}>{score}</strong> 点</p>
                        <p style={{ fontSize: '1.2rem' }}>ライフ: <span style={{ fontSize: '1.5rem' }}>{'❤️'.repeat(Math.max(0, myLives))}{'🖤'.repeat(Math.max(0, 3 - myLives))}</span></p>
                    </div>

                    <p style={{ color: '#d50000', fontWeight: 'bold' }}>直前のリスク: {dangerLevel}% {dangerLevel > 0 && `(${triggeredZone})`}</p>
                    <p style={{ fontSize: '1.1rem', margin: '10px 0', color: '#333', minHeight: '1.5em' }}>{message}</p>

                    {isGameOver && <button onClick={handleReset} style={{ padding: '10px 20px', fontSize: '1rem', backgroundColor: '#007bff', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer', marginBottom: '10px' }}>復活する</button>}

                    <div style={{ height: '480px', border: '2px solid #333', borderRadius: '8px', overflow: 'hidden' }}>
                        <MapContainer
                            center={[20, 0]}
                            zoom={2}
                            style={{ height: '100%' }}
                            maxBounds={[[-90, -180], [90, 180]]}
                            maxBoundsViscosity={1.0}
                            minZoom={2}
                            worldCopyJump={false}
                            preferCanvas={true}
                        >
                            <TileLayer
                                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                                noWrap={true}
                            />

                            {plateLayer}

                            <MapClickHandler onClick={handleMapClick} disabled={!isMyTurn || isGameOver} />
                            {location && <CircleMarker center={location} radius={12} pathOptions={{ color: isGameOver && myLives <= 0 ? 'red' : '#00c853', fillColor: isGameOver && myLives <= 0 ? 'red' : '#00c853', fillOpacity: 0.5 }} />}
                        </MapContainer>
                    </div>
                </div>

                {mode !== 'single' && (
                    <div style={{ width: '20%', backgroundColor: 'white', padding: '15px', borderRadius: '8px', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
                        <h3>順位</h3>
                        <ul style={{ listStyle: 'none', padding: 0 }}>
                            {players.sort((a,b) => b.score - a.score).map((p, idx) => (
                                <li key={p.id} style={{ padding: '8px 10px', borderBottom: '1px solid #eee', fontWeight: p.id === socket?.id ? 'bold' : 'normal', color: p.isAlive ? '#333' : '#999', textDecoration: p.isAlive ? 'none' : 'line-through', backgroundColor: p.id === currentTurnPlayerId ? '#fff9c4' : 'transparent', borderRadius: '4px' }}>
                                    {p.id === currentTurnPlayerId && '▶ '} {idx + 1}位: {p.name} ({p.score}点) <br />
                                    <small style={{ color: p.isAlive ? 'red' : '#999' }}>{'❤️'.repeat(p.lives)}</small>
                                </li>
                            ))}
                        </ul>
                        <h4 style={{ marginTop: '20px' }}>ログ</h4>
                        <div style={{ fontSize: '0.85rem', color: '#666', textAlign: 'left', maxHeight: '150px', overflowY: 'auto' }}>
                            {systemLogs.map((log, i) => <div key={i} style={{ marginBottom: '4px' }}>{log}</div>)}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

export default App;