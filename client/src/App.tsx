import { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Circle, Polyline, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { io, Socket } from 'socket.io-client';

const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'http://localhost:3000';
let socket: Socket;

const DANGER_ZONES = [
    { lat: 34.0, lng: 138.0, radius: 800000 },
    { lat: 36.0, lng: -120.0, radius: 800000 },
    { lat: -30.0, lng: -72.0, radius: 1200000 },
    { lat: -2.0, lng: 101.0, radius: 1000000 },
];

const BOUNDARIES = [
    [[45, 145], [35, 140], [30, 130]],
    [[50, -130], [35, -120], [25, -110]],
    [[0, -80], [-20, -75], [-40, -70]]
];

function MapClickHandler({ onClick }: { onClick: (latlng: any) => void }) {
    useMapEvents({ click: (e) => onClick(e.latlng) });
    return null;
}

export default function App() {
    const [showModal, setShowModal] = useState(false);
    const [subDepth, setSubDepth] = useState(0);
    const [pendingLoc, setPendingLoc] = useState<any>(null);
    const [isDragging, setIsDragging] = useState(false);

    useEffect(() => {
        socket = io(SERVER_URL);
        return () => { socket.disconnect(); };
    }, []);

    const handleSubmit = () => {
        socket.emit('plate_subduct', { lat: pendingLoc.lat, lng: pendingLoc.lng, intensity: subDepth });
        setShowModal(false);
    };

    return (
        <div style={{ height: '100vh', position: 'relative' }}>
            <MapContainer center={[20, 0]} zoom={2} style={{ height: '100%' }}>
                <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />

                {/* 危険区域（円） */}
                {DANGER_ZONES.map((z, i) => (
                    <Circle key={`zone-${i}`} center={[z.lat, z.lng]} radius={z.radius} pathOptions={{ color: 'red', fillOpacity: 0.2 }} />
                ))}

                {/* プレート境界線 */}
                {BOUNDARIES.map((line, i) => (
                    <Polyline key={`line-${i}`} positions={line as any} pathOptions={{ color: '#ffeb3b', weight: 4, dashArray: '10, 10' }} />
                ))}

                <MapClickHandler onClick={(latlng) => { setPendingLoc(latlng); setShowModal(true); }} />
            </MapContainer>

            {/* 断面図モーダル */}
            {showModal && (
                <div style={{ position: 'absolute', top: '10%', left: '10%', zIndex: 1000, background: 'white', padding: '20px', borderRadius: '12px', boxShadow: '0 4px 10px rgba(0,0,0,0.3)', textAlign: 'center' }}>
                    <h3>プレート沈み込み</h3>
                    <p>ドラッグして沈み込ませてください</p>
                    <svg width="300" height="200" style={{ border: '1px solid #ccc', cursor: 'ns-resize' }}
                         onMouseMove={(e) => { if (isDragging) setSubDepth(Math.min(100, Math.max(0, (e.clientY / 300) * 100))); }}
                         onMouseDown={() => setIsDragging(true)}
                         onMouseUp={() => setIsDragging(false)}
                         onMouseLeave={() => setIsDragging(false)}
                    >
                        <rect x="0" y="0" width="300" height="50" fill="#8d6e63" />
                        <line x1="0" y1="50" x2="150" y2={50 + subDepth} stroke="#546e7a" strokeWidth="20" />
                        <circle cx="150" cy={50 + subDepth} r="15" fill="#ff5722" />
                    </svg>
                    <div style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>エネルギー: {Math.round(subDepth)}%</div>
                    <button onClick={handleSubmit} style={{ marginTop: '10px', padding: '10px 20px', background: '#d32f2f', color: 'white', border: 'none', borderRadius: '5px' }}>
                        断層破壊！
                    </button>
                </div>
            )}
        </div>
    );
}