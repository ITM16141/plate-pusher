import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet.vectorgrid';

interface Props {
    data: any;
}

export function VectorGridLayer({ data }: Props) {
    const map = useMap();

    useEffect(() => {
        if (!data) return;

        // GeoJSONを切り分けてCanvasタイルとして高速描画
        const vectorGrid = (L as any).vectorGrid.slicer(data, {
            rendererFactory: (L as any).canvas.tile,
            vectorTileLayerStyles: {
                sliced: {
                    color: '#ffeb3b',
                    weight: 2,
                    opacity: 0.6,
                }
            },
            interactive: false,
        });

        vectorGrid.addTo(map);

        return () => {
            map.removeLayer(vectorGrid);
        };
    }, [map, data]);

    return null;
}