import type { Feature } from "geojson";
import { createTileSchemeFromBBoxAndScale, createVectorTile, createTile, getTileChildren, type Tile, type VTEditParams } from "../../src";
import { bboxDetail } from "../../src/bbox";
import type { InputFeature, VFeature, VPolygon, VPolyline } from "../../src/interface";
import { expandFactor, type Extent } from "../extent";
import { resolveFeaturesExtent } from "../utils";
import './style.scss';

const canvas = document.createElement('canvas');
document.body.querySelector('#content').appendChild(canvas);
const ctx = canvas.getContext('2d');


const features = [
    {
        id: 0,
        type: 'Feature',
        properties: { lineColor: 'red' },
        geometry: {
            type: 'LineString',
            coordinates: [[0, 0], [50, 50], [200, 0]]
        }
    },
    {
        id: 1,
        type: 'Feature',
        properties: { lineColor: "darkgreen" },
        geometry: {
            type: 'LineString',
            coordinates: [[0, 50], [50, 0], [200, 50]]
        }
    },
    {
        id: 2,
        type: 'Feature',
        properties: { lineColor: 'blue' },
        geometry: {
            type: 'LineString',
            coordinates: [[0, 200], [80, 200]]
        }
    }
] as Feature[];
const fullExtent = resolveFeaturesExtent(features);
const tileScheme = createTileSchemeFromBBoxAndScale([
    fullExtent.xmin, fullExtent.ymin, fullExtent.xmax, fullExtent.ymax
], 1000);
console.log('tileScheme', tileScheme);


document.addEventListener('keyup', e => {
    if (e.key !== 'Escape') return;
    const { z, x, y } = tileData.tile;
    if (z === 0) return;
    draw({ z: z - 1, x: x >> 1, y: y >> 1 });
});

canvas.addEventListener('click', e => {
    const { z, x, y } = tileData.tile;
    if (z === vt.options.tileScheme.maxZoom) return;
    const offsetx = e.offsetX >= canvas.width / 2 ? 1 : 0;
    const offsety = e.offsetY >= canvas.height / 2 ? 1 : 0;
    draw({ z: z + 1, x: x * 2 + offsetx, y: y * 2 + offsety });
});

const vt = createVectorTile({
    tileScheme,
    source: features as InputFeature[],
    static: false,
    buffer: 0.05,
    debug: true,
});
console.group();
console.log('tileScheme:');
console.log(tileScheme);
console.log('fs:');
console.log(features);
console.log('vt:');
console.log(vt);
console.groupEnd();

const renderBuffer = 0.1;
canvas.width = canvas.height = 512 * (1 + 2 * renderBuffer);

function worldToCanvas([x, y]: number[], canvasExtent: Extent) {
    return [
        (x - canvasExtent.xmin) / canvasExtent.width * canvas.width,
        (1 - (y - canvasExtent.ymin) / canvasExtent.height) * canvas.height
    ] as const;
}

let canvasExtent: Extent;
let tileData: {
    features: VFeature[];
    tile: Tile;
}

function draw({ x, y, z }: { z: number, y: number, x: number }) {
    tileData = vt.getTileData({ z, x, y });

    if (!tileData) {
        tileData = {
            tile: createTile(tileScheme, { x, y, z, wx: 0, wy: 0 }),
            features: [],
        }
    }
    const { tile, features } = tileData;
    canvasExtent = expandFactor(bboxDetail(tile.bbox), 1 + renderBuffer * 2);


    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.font = '16px system-ui';
    ctx.fillStyle = 'purple';
    ctx.fillText(tile.key, 20, 20);
    ctx.restore()


    drawTile(tile, tile.z === vt.options.tileScheme.maxZoom);
    if (tile.z < vt.options.tileScheme.maxZoom) {
        const childrens = getTileChildren(tile, vt.options.tileScheme);
        childrens.forEach(t => drawTile(t, true))
    }


    for (let vf of features) {
        switch (vf.type) {
            case "point":
                continue;
            case "polygon":
                drawPolygon(vf as VPolygon); break;
            case "polyline":
                drawLine(vf as VPolyline);
        }
    }

    function drawTile({ bbox, key }: Tile, showLabel = false) {
        ctx.save();
        const extent = bboxDetail(bbox);
        const points = [
            [extent.xmin, extent.ymin],
            [extent.xmax, extent.ymin],
            [extent.xmax, extent.ymax],
            [extent.xmin, extent.ymax],
        ].map(p => worldToCanvas(p, canvasExtent));

        ctx.strokeStyle = 'black';

        ctx.beginPath();
        ctx.moveTo(...points[0])
        ctx.lineTo(...points[1])
        ctx.lineTo(...points[2])
        ctx.lineTo(...points[3])
        ctx.closePath();
        ctx.stroke();

        if (showLabel) {
            ctx.font = '16px system-ui';
            ctx.fillText(key, points[3][0] + 5, points[3][1] + 16)
        }

        ctx.restore();
    }
    function drawPolygon({ coordinates, properties }: VPolygon) {
        ctx.save();
        ctx.strokeStyle = properties?.['lineColor'] || 'black';
        ctx.fillStyle = properties?.['color'] || 'transparent';
        ctx.lineWidth = 1;
        ctx.beginPath();
        const path = coordinates[0];
        ctx.moveTo(...worldToCanvas(path[0], canvasExtent));
        for (let i = 1; i < path.length; i++) {
            ctx.lineTo(...worldToCanvas(path[i], canvasExtent));
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
    }
    function drawLine({ coordinates, properties }: VPolyline) {
        ctx.save();
        ctx.strokeStyle = properties?.['lineColor'] || 'black';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(...worldToCanvas(coordinates[0], canvasExtent));
        for (let i = 1; i < coordinates.length; i++) {
            ctx.lineTo(...worldToCanvas(coordinates[i], canvasExtent));
        }
        ctx.stroke();
        ctx.restore();
    }
}

draw({ z: 0, x: 0, y: 0 });
const button = document.body.querySelector('button') as HTMLButtonElement;
button.addEventListener('click', () => {
    button.remove();
    const edits = {
        updates: [
            {
                id: 0,
                type: 'Feature',
                properties: { lineColor: 'orange' },
                geometry: {
                    type: 'LineString',
                    coordinates: [[0, 0], [100, 50], [200, 0], [210, 80]]
                }
            },
        ],
        removes: [1, 2],
        adds: [
            {
                id: 3,
                type: 'Feature',
                properties: { lineColor: 'cyan' },
                geometry: {
                    type: 'LineString',
                    coordinates: [[120, 200 - 50], [200, 200 - 50]]
                }
            },
            {
                id: 4,
                type: 'Feature',
                properties: { lineColor: 'dark' },
                geometry: {
                    type: 'LineString',
                    coordinates: new Array(21).fill(0).map((_, idx) => {
                        return [
                            100 + 50 * Math.cos(2 * Math.PI / 20 * idx),
                            100 + 50 * Math.sin(2 * Math.PI / 20 * idx),
                        ]
                    })
                }
            },
            {
                id: 5,
                type: 'Feature',
                properties: { lineColor: 'blue', color: "#99999999" },
                geometry: {
                    type: 'Polygon',
                    coordinates: [
                        [
                            [50, 20],
                            [120, 70],
                            [20, 170],
                            [50, 20],
                        ]
                    ]
                }
            }
        ]
    } as VTEditParams;
    console.log('edits:');
    console.log(edits);
    const changes = vt.applyEdits(edits);
    console.log('change tile keys:', changes);
    draw(tileData.tile);
});
