import * as d3 from "d3";
import type { Feature } from "geojson";
import GUI from "lil-gui";
import { createTileSchemeWebMercator, createVectorTile, type VectorTile } from "../../src";
import { bboxDetail } from "../../src/bbox";
import type { Coord, InputFeature, VPoint, VPolygon, VPolyline } from "../../src/interface";
import { lerp } from "../../src/utils";
import { createExtent, extentFromPoints, type Extent } from "../extent";
import { extentToBounds, getCRS, loadImg, parseGeoJSON, projFeature, resolveFeaturesExtent, resolveTileFromXYZ } from "../utils";
import { data_wrap } from "./data";
import './style.scss';

const dataMap = {
    'test-wrap:3857': data_wrap,
    'river-3857': './river_3857.geojson',
    'texas:4326': './tx_texas_zip_codes_geo.min.json',
    'california:4326': './ca_california_zip_codes_geo.min.json'
} as const;
type K = keyof typeof dataMap;

let dirty = true;
const params = {
    data: 'test-wrap:3857' as K,
    wrapX: true,
    wrapY: false,
}
const gui = new GUI();
gui.add(params, 'data', Object.keys(dataMap)).onChange((v: K) => loadData(v));


let curDataSource: Feature[];
let sourceExtent: Extent;
const urlTemplate = `https://server.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}`;
const info = document.querySelector('#z');
const appEl = document.body.querySelector('#app') as HTMLDivElement;
const container = d3.select<HTMLDivElement, any>('#app');
const tileScheme = createTileSchemeWebMercator(24);
console.log('tileScheme', tileScheme);
const canvas = document.createElement('canvas');
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;
appEl.appendChild(canvas);
const ctx = canvas.getContext('2d');
const bgSet = new Map<string, HTMLImageElement | Promise<void>>();

let wrapControls: GUI;
let vt: VectorTile;
let request = false;
let transform = d3.zoomIdentity;
let fullExtentWorld: Extent;
let viewportExtent: Extent;
let curZoom = Math.log2(transform.k);
function worldToCanvas([x, y]: Coord) {
    return transform.apply([
        (x - fullExtentWorld.xmin) / fullExtentWorld.width * canvas.width,
        (fullExtentWorld.ymax - y) / fullExtentWorld.height * canvas.height
    ] as [number, number]);
}

const zoom = d3.zoom<HTMLDivElement, any>()
    .on('zoom', handleZoom);

container.call(zoom);

function handleZoom(e: { transform: d3.ZoomTransform }) {
    curZoom = Math.log2(e.transform.k);
    transform = e.transform;
    info.innerHTML = `zoom:${curZoom.toFixed(1)}`;
    updateViewport(transform);
    requestRender();
}


setupDrag();
window.addEventListener('resize', handleResize);
handleResize();
loadData(params.data);

function handleResize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    fullExtentWorld = updateFullExtent(canvas.width, canvas.height);
    //keep center
    const { cx, cy } = (viewportExtent || fullExtentWorld);
    const k = 2 ** curZoom;
    const tx = (cx - fullExtentWorld.xmin) / fullExtentWorld.width * canvas.width;
    const ty = (fullExtentWorld.ymax - cy) / fullExtentWorld.height * canvas.height;
    const t = new d3.ZoomTransform(k, (1 - k) * tx, (1 - k) * ty);
    //@ts-ignore
    container.node().__zoom = t;
    handleZoom({ transform: t });
    requestRender();
}

function updateFullExtent(width: number, height: number) {
    const r0 = tileScheme.lods[0].resolution;
    const resolution = r0 * 2 ** tileScheme.lods[0].z;
    const { cx, cy } = (viewportExtent || bboxDetail(tileScheme.worldBBox));
    const xmin = cx - resolution * width / 2;
    const xmax = cx + resolution * width / 2;
    const ymin = cy - resolution * height / 2;
    const ymax = cy + resolution * height / 2;
    return createExtent({ xmin, xmax, ymin, ymax });
}

function updateViewport(transform: d3.ZoomTransform) {
    const [xmin, ymin] = transform.invert([0, 0]);
    const [xmax, ymax] = transform.invert([canvas.width, canvas.height]);
    viewportExtent = createExtent({
        xmin: lerp(fullExtentWorld.xmin, fullExtentWorld.xmax, xmin / canvas.width),
        xmax: lerp(fullExtentWorld.xmin, fullExtentWorld.xmax, xmax / canvas.width),
        ymin: lerp(fullExtentWorld.ymax, fullExtentWorld.ymin, ymax / canvas.height),
        ymax: lerp(fullExtentWorld.ymax, fullExtentWorld.ymin, ymin / canvas.height),
    });
}

function loadData(data: string | Feature[]) {
    const v = dataMap[data as K];
    if (typeof v === 'string') {
        wrapControls?.destroy();
        wrapControls = null;
        tileScheme.wrapX = params.wrapX = true;
        tileScheme.wrapY = params.wrapY = false;
        fetch(v)
            .then(res => res.json())
            .then(geojson => {
                const fs = parseGeoJSON(geojson);
                const crs = getCRS(geojson);
                curDataSource = projFeature(fs as Feature[], crs, 'EPSG:3857');
                sourceExtent = resolveFeaturesExtent(curDataSource);
                dirty = true;
                requestRender();
            });
    } else {
        dirty = true;
        curDataSource = v;
        sourceExtent = resolveFeaturesExtent(v);

        if (!wrapControls) {
            wrapControls = gui.addFolder('wrap');
            wrapControls.add(params, 'wrapX').onChange(() => {
                tileScheme.wrapX = params.wrapX;
                dirty = true;
                requestRender();
            });
            wrapControls.add(params, 'wrapY').onChange(() => {
                tileScheme.wrapY = params.wrapY;
                dirty = true;
                requestRender();
            });
        }



        requestRender();
    }
}

type T = ReturnType<typeof resolveTileFromXYZ>;
function draw() {
    const { origin, tileSize } = tileScheme;
    const worldExtent = bboxDetail(tileScheme.worldBBox);
    const z = Math.round(curZoom);
    const r0 = tileScheme.lods[0].resolution;
    const resolution = r0 * 2 ** (tileScheme.lods[0].z - z);
    const renderResolution = r0 * 2 ** (tileScheme.lods[0].z - curZoom);
    const corners = [
        [viewportExtent.xmin, viewportExtent.ymax],
        [viewportExtent.xmax, viewportExtent.ymax],
        [viewportExtent.xmax, viewportExtent.ymin],
        [viewportExtent.xmin, viewportExtent.ymin]
    ].map(([x, y]) => {
        return [
            (x - origin[0]) / resolution / tileSize[0],
            (origin[1] - y) / resolution / tileSize[1]
        ]
    });

    const [unwrapXMin, unwrapYMin, unwrapXMax, unwrapYMax] = extentToBounds(extentFromPoints(corners)).map(Math.floor);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const tiles = [] as T[];
    for (let x = unwrapXMin; x <= unwrapXMax; x++) {
        for (let y = unwrapYMin; y <= unwrapYMax; y++) {
            tiles.push(resolveTileFromXYZ(tileScheme, { x, y, z }));
        }
    }

    for (let tile of tiles) {
        const [a, b, c, d] = drawTile(tile, true);
        const data = vt?.getTileData(tile);
        if (!data?.features?.length) continue;
        ctx.save();
        ctx.beginPath();
        ctx.moveTo(...a);
        ctx.lineTo(...b);
        ctx.lineTo(...c);
        ctx.lineTo(...d);
        ctx.closePath();
        ctx.clip();

        for (let vf of data.features) {
            switch (vf.type) {
                case "point": drawPoint(vf as VPoint, tile); break;
                case "polygon": drawPolygon(vf as VPolygon, tile); break
                case "polyline": drawLine(vf as VPolyline, tile); break;
            }
        }
        ctx.restore()
    }

    //
    const points = [
        [worldExtent.xmin, worldExtent.ymin],
        [worldExtent.xmax, worldExtent.ymin],
        [worldExtent.xmax, worldExtent.ymax],
        [worldExtent.xmin, worldExtent.ymax],
    ].map(p => worldToCanvas(shiftCoords(p, [0, 0])));
    ctx.strokeStyle = '#6e25e4';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(...points[0])
    ctx.lineTo(...points[1])
    ctx.lineTo(...points[2])
    ctx.lineTo(...points[3])
    ctx.closePath();
    ctx.stroke();


    function drawTile({ bbox, key, z, x, y, wx, wy }: T, showLabel = false, { lineColor, lineWidth } = {
        lineColor: 'black',
        lineWidth: 1
    }) {
        const extent = bboxDetail(bbox);
        ctx.save();

        const offset = [wx * worldExtent.width, -wy * worldExtent.height];
        const points = [
            [extent.xmin, extent.ymin],
            [extent.xmax, extent.ymin],
            [extent.xmax, extent.ymax],
            [extent.xmin, extent.ymax],
        ].map(p => worldToCanvas(shiftCoords(p, offset)));

        let img = bgSet.get(key);
        if (!img) {
            bgSet.set(key,
                loadImg(urlTemplate.replace('{z}', z + "").replace('{x}', x + '').replace('{y}', y + ""))
                    .then(img => {
                        requestRender();
                        bgSet.set(key, img);
                    })
            )
        } else {
            if (img instanceof HTMLImageElement) {
                const renderSize = extent.width / renderResolution;
                ctx.drawImage(img, 0, 0, img.width, img.height, points[3][0], points[3][1], renderSize, renderSize);
            }
        }

        ctx.strokeStyle = lineColor;
        ctx.lineWidth = lineWidth;

        ctx.beginPath();
        ctx.moveTo(...points[0])
        ctx.lineTo(...points[1])
        ctx.lineTo(...points[2])
        ctx.lineTo(...points[3])
        ctx.closePath();
        ctx.stroke();

        if (showLabel) {
            ctx.font = '16px system-ui';
            ctx.fillStyle = 'white';
            ctx.fillText(key, points[3][0] + 5, points[3][1] + 16);
            ctx.fillStyle = 'orange';
            ctx.fillText(`wx:${wx}`, points[3][0] + 5, points[3][1] + 32);
            ctx.fillText(`wy:${wy}`, points[3][0] + 5, points[3][1] + 48);
        }

        if (params.data !== 'test-wrap:3857' && sourceExtent && z < 5) {
            const [xmin, ymax, xmax, ymin] = [
                [sourceExtent.xmin, sourceExtent.ymin],
                [sourceExtent.xmax, sourceExtent.ymax]
            ].map(i => worldToCanvas(shiftCoords(i, offset))).flat();
            ctx.strokeStyle = 'lightgreen'
            ctx.beginPath();
            ctx.moveTo(xmin, ymin);
            ctx.lineTo(xmax, ymin);
            ctx.lineTo(xmax, ymax);
            ctx.lineTo(xmin, ymax);
            ctx.closePath();
            ctx.stroke();
        }

        ctx.restore();
        return points;
    }

    function drawLine({ coordinates, properties }: VPolyline, { wx, wy }: T) {
        const offset = [wx * worldExtent.width, -wy * worldExtent.height];
        ctx.save();
        ctx.strokeStyle = properties?.['lineColor'] || 'black';
        ctx.lineWidth = properties?.['width'] || 2;
        ctx.beginPath();
        ctx.moveTo(...worldToCanvas(shiftCoords(coordinates[0], offset)));
        for (let i = 1; i < coordinates.length; i++) {
            ctx.lineTo(...worldToCanvas(shiftCoords(coordinates[i], offset)));
        }
        ctx.stroke();
        ctx.restore();
    }

    function drawPolygon({ coordinates, properties }: VPolygon, { wx, wy }: T) {
        const offset = [wx * worldExtent.width, -wy * worldExtent.height];
        ctx.save();
        ctx.fillStyle = properties?.['fillColor'] || 'rgba(0,255,255,0.3)';
        ctx.strokeStyle = properties?.['outlineColor'] || 'black';
        ctx.lineWidth = properties?.['outlineWidth'] || 1;
        ctx.beginPath();
        const path = coordinates[0];
        ctx.moveTo(...worldToCanvas(shiftCoords(path[0], offset)));
        for (let i = 1; i < path.length; i++) {
            ctx.lineTo(...worldToCanvas(shiftCoords(path[i], offset)));
        }
        ctx.closePath();
        ctx.stroke();
        ctx.fill();
        ctx.restore();
    }

    function drawPoint({ coordinates, properties }: VPoint, { wx, wy }: T) {
        const offset = [wx * worldExtent.width, -wy * worldExtent.height];
        ctx.save();
        ctx.fillStyle = properties?.['color'] || 'cyan';
        const [x, y] = worldToCanvas(shiftCoords(coordinates, offset));
        ctx.fillRect(x - 2, y - 2, 4, 4);
        ctx.restore();
    }

    function shiftCoords(p: Coord, offset: number[]) {
        return [p[0] + offset[0], p[1] + offset[1]]
    }
}

function requestRender() {
    if (request) return;
    request = true;
    requestAnimationFrame(() => {
        request = false;
        if (dirty) {
            if (!curDataSource) return;
            vt = createVectorTile({
                debug: true,
                source: curDataSource as InputFeature[],
                tileScheme,
                minZoom: 0,
                maxZoom: 12,
                calcLineDistance: true,
                keepLinePoint: true,
                keepLinePointIndex: true,
                keepPolygonPoint: true,
                keepPolygonPointIndex: true,
                multiLineDistanceStrategy: 'cumulative',
                multiLineDistanceLink: false,
            });
            zoom.scaleExtent([2 ** tileScheme.minZoom, 2 ** tileScheme.maxZoom]);
            dirty = false;
            console.log('vt:', vt);
        }
        draw();
    })
}

function setupDrag() {
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(event => {
        appEl.addEventListener(event, e => {
            e.preventDefault();
            e.stopPropagation();
        });
    });

    appEl.addEventListener('drop', (e) => {
        const files = e.dataTransfer.files;
        if (files.length === 0) return;
        const file = files[0];
        const reader = new FileReader();
        reader.onload = function (event) {
            const text = event.target.result;
            try {
                const geojson = JSON.parse(text as string)
                const fs = parseGeoJSON(geojson);
                const crs = getCRS(geojson);
                curDataSource = projFeature(fs as Feature[], crs, 'EPSG:3857');
                sourceExtent = resolveFeaturesExtent(curDataSource);
                dirty = true;
                requestRender();
            } catch (err) {
                alert("解析失败");
            }
        };
        reader.onerror = () => {
            alert("读取失败");
        };
        reader.readAsText(file);
    });
}