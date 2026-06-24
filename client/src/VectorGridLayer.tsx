import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet.vectorgrid'; // プラグインをインポート

interface Props {
    data: never; // GeoJSONデータ
}

export function VectorGridLayer({ data }: Props) {
    const map = useMap();

    useEffect(() => {
        if (!data) return;

        // VectorGrid.slicer で GeoJSON をタイル状に分割して描画
        const vectorGrid = L.vectorGrid.slicer(data, {
            rendererFactory: L.canvas.tile, // キャンバスレンダラーを使用
            vectorTileLayerStyles: {
                sliced: {
                    color: '#ffeb3b', // 境界線の色
                    weight: 2,        // 線の太さ
                    opacity: 0.7,
                }
            },
            interactive: true, // クリック判定を有効にする場合
        });

        vectorGrid.addTo(map);

        // クリーンアップ処理（アンマウント時にレイヤーを削除）
        return () => {
            map.removeLayer(vectorGrid);
        };
    }, [map, data]);

    return null;
}
