import { groupBy } from "es-toolkit";
import type { BBox } from "geojson";
import { bboxDetail, bboxFromPoints, resolveVFeatureBBox } from "./bbox";
import { pixel_to_pointy_axial, pointy_axial_to_pixel } from "./hexagons";
import { type Coord, type Integer, type Rings, type VFeature, type VPoint, type VPolygon, type VPolyline, type VTNode, type VTOption } from "./interface";
import { douglasSimplify } from "./simplify";
import type { Tile } from "./tile";
import { Bresenham_calcLinePixels } from "./utils";

export function createVTNode(
    srcVfs: VFeature[],
    srcBBox: BBox,
    tile: Tile,
    option: VTOption,
    isEdit: boolean
): VTNode {
    const { maxZoom, Q, simplifyAtMaxZoom } = option;

    let simplified: VFeature[];

    if (tile.z === maxZoom && !simplifyAtMaxZoom) {
        simplified = Q
            ? toQuantize(srcVfs, bboxDetail(tile.bbox), Q)
            : srcVfs;
    } else {
        simplified = (option.customSimplify || featureSimplify)(srcVfs, tile, option, isEdit);
    }

    return {
        version: 1,
        key: tile.key,
        tile: tile,
        source: srcVfs,
        sourceBBox: srcBBox,
        sourcePointNums: resolvePointCounts(srcVfs),
        simplified,
        simplifiedPointNums: resolvePointCounts(simplified),
        hasDrillDown: false,
    }
}

function featureSimplify(raws: VFeature[], tile: Tile, option: VTOption, isEdit: boolean) {
    const { point, polygon, polyline } = groupBy(raws, i => i.type) as {
        point: VPoint[], polygon: VPolygon[], polyline: VPolyline[]
    };
    const simplified = [] as VFeature[];
    if (polygon?.length) {
        simplified.push(...simplify_polygon(polygon, tile, option, isEdit));
    }
    if (polyline?.length) {
        simplified.push(...simplify_line(polyline, tile, option, isEdit));
    }
    if (point?.length) {
        if (isEdit) {
            simplified.push(...point);
        } else {
            simplified.push(...simplify_point(point, tile, option));
        }
    }
    return simplified;
}

function simplify_point(points: VPoint[], tile: Tile, option: VTOption) {
    if (option.Q) {
        points = toQuantize(points, bboxDetail(tile.bbox), option.Q) as VPoint[];
    }
    const cellSize = 5 * tile.resolution;
    const hexagons = {} as Record<string, VPoint[]>;
    for (let point of points) {
        const [q, r] = pixel_to_pointy_axial(point.coordinates as [number, number], cellSize);
        (hexagons[q + ',' + r] ??= []).push(point);
    }
    const results = [] as VPoint[];
    for (let key in hexagons) {
        const points = hexagons[key];
        const count = points.length;
        const limit = Math.ceil(0.4 ** (option.maxZoom - tile.z) * count);
        const interval = count / limit >> 0;
        for (let i = 0; i < count; i += interval) {
            results.push(points[i])
        }
    }
    return results;
}

const $LinePixelCache = /*#__PURE__*/ {} as Record<string, number[][]>;
function simplify_line(
    lines: VPolyline[],
    tile: Tile,
    { Q, tileScheme, tolerance }: VTOption,
    resolveTiny: boolean
) {
    const tinyTolerance = 3;
    const resolution = tile.resolution;
    const tinySize = tinyTolerance * resolution;
    let { result = [], tiny = [] } = resolveTiny
        ? groupBy(lines, i => isTiny(i.bbox, tinySize) ? 'tiny' : 'result')
        : { result: lines, tiny: [] };

    const tileExtent = Q ? bboxDetail(tile.bbox) : null;
    {
        const unitPerPixel = Q
            ? Q / tileScheme.tileSize[0] //quantize unit
            : resolution; //world unit

        const simplifyThresholdSq = (tolerance * unitPerPixel) ** 2;
        if (Q) result = toQuantize(result, tileExtent, Q) as VPolyline[];

        if (simplifyThresholdSq > 0) {
            result = result.map(line => {
                if (line.coordinates.length <= 2) return line;
                const flags = douglasSimplify(line.coordinates, simplifyThresholdSq);
                const points = maskFilter(line.coordinates, flags);
                return {
                    id: line.id,
                    properties: line.properties,
                    type: 'polyline',
                    multiLineStringIndex: line.multiLineStringIndex,
                    coordinates: points,
                    vertexIndex: maskFilter(line.vertexIndex, flags),
                    bbox: bboxFromPoints(points),
                    distances: maskFilter(line.distances, flags),
                    totalDistance: line.totalDistance,
                } as VPolyline;
            });
        }

    }

    if (!tiny.length) return result;

    {
        const f = 1 / resolution;
        const { width, height, xmin, ymax } = bboxDetail(resolveVFeatureBBox(tiny));
        const maskWidth = Math.ceil(width * f);
        const maskHeight = Math.ceil(height * f);
        const maskLength = maskWidth * maskHeight;
        const mask = new Uint8Array(maskLength);
        let maskCount = 0;
        let resolves = [] as VPolyline[];
        for (let { id, coordinates: points, bbox, properties, totalDistance, distances, multiLineStringIndex, vertexIndex } of tiny) {
            const start = points[0], end = points[points.length - 1];
            const lineExtent = bboxDetail(bbox);
            let canRender = false;
            if (lineExtent.width < resolution && lineExtent.height < resolution) {
                // only 1pixel
                const col = (lineExtent.cx - xmin) * f >> 0;
                const row = (ymax - lineExtent.cy) * f >> 0;
                const index = col + row * maskWidth;
                if (mask[index] === 0) {
                    mask[index] = 1;
                    maskCount += 1;
                    canRender = true;
                }
            } else {
                const sx = (start[0] - xmin) * f >> 0,
                    sy = (ymax - start[1]) * f >> 0,
                    ex = (end[0] - xmin) * f >> 0,
                    ey = (ymax - end[1]) * f >> 0,
                    colmin = Math.min(sx, ex),
                    rowmin = Math.min(sy, ey),
                    x0 = sx - colmin,
                    y0 = sy - rowmin,
                    x1 = ex - colmin,
                    y1 = ey - rowmin;
                const key = [x0, y0, x1, y1].join(',');
                const pixels = $LinePixelCache[key] ??= Bresenham_calcLinePixels(x0, y0, x1, y1);
                pixels.forEach(p => {
                    const index = (p[0] + colmin) + (p[1] + rowmin) * maskWidth;
                    if (mask[index] === 0) {
                        maskCount++;
                        mask[index] = 1;
                        canRender = true;
                    }
                });
            }
            if (!canRender) continue;
            resolves.push({
                id,
                properties,
                type: "polyline",
                multiLineStringIndex: multiLineStringIndex,
                coordinates: [start, end],
                vertexIndex: vertexIndex ? [vertexIndex[0], vertexIndex[vertexIndex.length - 1]] : null,
                bbox: bboxFromPoints([start, end]),
                distances: distances ? [distances[0], distances[distances.length - 1]] : null,
                totalDistance,
            } as VPolyline);
            if (maskCount === maskLength) break;
        }
        if (Q) {
            resolves = toQuantize(resolves, tileExtent, Q) as VPolyline[];
        }
        result.push(...resolves);
    }

    return result;
}

function simplify_polygon(
    polygons: VPolygon[],
    tile: Tile,
    { Q, tileScheme, keepPolygonPointIndex, tolerance }: VTOption,
    resolveTiny: boolean
) {
    const tinyTolerance = 2;
    const resolution = tile.resolution;
    const tinySize = tinyTolerance * resolution;
    let { result = [], tiny = [] } = resolveTiny
        ? groupBy(polygons, i => isTiny(i.bbox, tinySize) ? 'tiny' : 'result')
        : { result: polygons, tiny: [] };

    const tileExtent = Q ? bboxDetail(tile.bbox) : null;
    {
        const unitPerPixel = Q
            ? Q / tileScheme.tileSize[0] //quantize unit
            : resolution; //world unit

        const simplifyThresholdSq = (tolerance * unitPerPixel) ** 2;

        if (Q) result = toQuantize(result, tileExtent, Q) as VPolygon[];

        if (simplifyThresholdSq > 0) {
            result = result.map((polygon) => {
                const { id, coordinates: rings, properties, vertexIndex, multiPolygonIndex } = polygon;
                const simplifiedRings: Rings = [];
                const simplifiedVertexIndex = keepPolygonPointIndex ? [] as [number, number][][] : null;
                for (let i = 0; i < rings.length; i++) {
                    const ring = rings[i];
                    if (ring.length < 4) break;
                    const flags = douglasSimplify(ring, simplifyThresholdSq);
                    const rest = flags.reduce((total, flag) => total += (flag ? 1 : 0), 0);
                    if (rest < 4) break;
                    simplifiedRings.push(ring.filter((_, idx) => flags[idx]));
                    if (keepPolygonPointIndex) {
                        simplifiedVertexIndex.push(vertexIndex[i].filter((_, idx) => flags[idx]));
                    }
                }
                if (!simplifiedRings.length) {
                    tiny.push(polygon);
                    return;
                }
                return {
                    id,
                    properties,
                    type: 'polygon',
                    multiPolygonIndex,
                    coordinates: simplifiedRings,
                    bbox: bboxFromPoints(simplifiedRings[0]),
                    vertexIndex: simplifiedVertexIndex
                } as VPolygon;
            }).filter(Boolean)
        }

    }

    if (!tiny.length) return result;

    // resolve tinys, 
    // don't quantize, it's may have so many points
    // just use it bbox,
    {
        const f = 1 / tinySize;
        const { xmin, ymax, width, height } = bboxDetail(resolveVFeatureBBox(tiny));
        const maskWidth = Math.ceil(width * f);
        const maskHeight = Math.ceil(height * f);
        const maskLength = maskWidth * maskHeight;
        let maskCount = 0;
        const mask = new Uint8Array(maskLength);

        let resolves = [] as VPolygon[];
        for (let { bbox, id, properties, multiPolygonIndex, vertexIndex } of tiny) {
            const cx = (bbox[0] + bbox[2]) / 2;
            const cy = (bbox[1] + bbox[3]) / 2;
            const col = (cx - xmin) * f >> 0;
            const row = (ymax - cy) * f >> 0;
            const maskIndex = col + row * maskWidth;

            if (mask[maskIndex] === 1) continue;

            mask[maskIndex] = 1;

            const path = [
                [col, row],
                [col, row + 1],
                [col + 1, row + 1],
                [col + 1, row],
                [col, row],
            ].map(([x, y]) => [
                xmin + x / f,
                ymax - y / f,
            ]);
            resolves.push({
                id,
                properties,
                type: 'polygon',
                multiPolygonIndex,
                coordinates: [path],
                bbox: bboxFromPoints(path),
                vertexIndex: vertexIndex ? [[...vertexIndex[0].slice(0, 3), vertexIndex[0][0]]] : null
            } as VPolygon);
            if (maskCount === maskLength) break;
        }
        if (Q) {
            resolves = toQuantize(resolves, tileExtent, Q) as VPolygon[];
        }
        result.push(...resolves);
    }

    return result;
}

//calc area is slow, just use size
function isTiny(bbox: BBox, t: number) {
    return (bbox[2] - bbox[0]) < t && (bbox[3] - bbox[1]) < t;
}
function resolvePointCounts(ps: VFeature[]) {
    let sum = 0;
    for (let p of ps) {
        switch (p.type) {
            case 'polyline': sum += p.coordinates.length; break;
            case "polygon": p.coordinates.forEach(ring => sum += ring.length); break;
            case "point": sum += 1;
        }
    }
    return sum;
}

type E = ReturnType<typeof bboxDetail>;
//坐标量化
function toQuantize(f: VFeature, extent: E, Q: Integer): VFeature;
function toQuantize(f: VFeature[], extent: E, Q: Integer): VFeature[];
function toQuantize(f: VFeature | VFeature[], { xmin, width, height, ymax }: E, Q: Integer) {
    const fx = Q / width;
    const fy = Q / height;

    if (Array.isArray(f)) {
        return f.map(convert)
    } else {
        return convert(f);
    }

    function convert(f: VFeature) {
        switch (f.type) {
            case 'point':
                return { ...f, coordinates: transformPoint(f.coordinates) };
            case 'polyline':
                return convertPolyline(f);
            case "polygon":
                return convertPolygon(f);
        }
    }

    function convertPolygon(polygon: VPolygon): VPolygon {
        const rings = polygon.coordinates.map(ring => ring.map(transformPoint));
        const flagArr = rings.map(ring => dedupFlags(ring));
        return {
            ...polygon,
            coordinates: rings,
            vertexIndex: polygon.vertexIndex ? polygon.vertexIndex.map((item, idx) => maskFilter(item, flagArr[idx])) : null,
            bbox: transformBBox(polygon.bbox)
        }
    }

    function convertPolyline(line: VPolyline): VPolyline {
        const path = line.coordinates.map(transformPoint);
        const flags = dedupFlags(path);
        return {
            ...line,
            coordinates: maskFilter(path, flags),
            vertexIndex: maskFilter(line.vertexIndex, flags),
            distances: maskFilter(line.distances, flags),
            bbox: transformBBox(line.bbox),
        }
    }

    function dedupFlags(points: Coord[]) {
        const length = points.length;
        const flags = new Array(length).fill(false);
        flags[0] = true;
        for (let i = 1; i < length; i++) {
            const [x1, y1] = points[i - 1];
            const [x2, y2] = points[i];
            flags[i] = (x1 !== x2 || y1 !== y2);
        }
        return flags;
    }

    function transformPoint(p: Coord) {
        return [
            Math.round((p[0] - xmin) * fx),
            Math.round((ymax - p[1]) * fy)
        ]
    }

    function transformBBox([xmin, ymin, xmax, ymax]: BBox) {
        const p1 = transformPoint([xmin, ymin]);
        const p2 = transformPoint([xmax, ymax]);
        return [p1, p2].flat() as BBox;
    }
}

function debug_draw_hexagons(hexagons: Record<string, VPoint[]>, tile: Tile, cellSize: number) {
    const offset_pointy_axial = [30, 90, 150, 210, 270, 330].map(i => {
        const r = -i / 180 * Math.PI;
        return [Math.cos(r), Math.sin(r)]
    });
    const { xmin, ymax, width, height } = bboxDetail(tile.bbox);
    const canvas = document.createElement('canvas');
    document.body.appendChild(canvas);
    canvas.style.cssText = 'background:white;position:fixed;z-index:1000;left:0;top:0';
    canvas.width = canvas.height = 1024;
    const ctx = canvas.getContext('2d');
    const colors = ['red', 'darkgreen', 'purple', 'blue', 'orange', 'cyan'];
    for (let key in hexagons) {
        const [q, r] = key.split(',').map(i => +i);
        const hexCenter = pointy_axial_to_pixel([q, r], cellSize);
        const hexPoints = offset_pointy_axial.map(i => [
            i[0] * cellSize + hexCenter[0],
            i[1] * cellSize + hexCenter[1],
        ]);
        ctx.strokeStyle = 'black';
        ctx.beginPath();
        ctx.moveTo(...worldToCanvas(hexPoints[0]));
        for (let i = 1; i < hexPoints.length; i++) ctx.lineTo(...worldToCanvas(hexPoints[i]));
        ctx.closePath();
        ctx.stroke();
        ctx.fillStyle = colors[(Math.abs(q) + Math.abs(r)) % colors.length];
        for (let point of hexagons[key]) {
            const [x, y] = worldToCanvas(point.coordinates);
            ctx.fillRect(x - 2, y - 2, 4, 4);
        }
        function worldToCanvas(world: number[]) {
            return [
                (world[0] - xmin) / width * canvas.width,
                (ymax - world[1]) / height * canvas.height
            ] as const;
        }
    }
}
function maskFilter<T = any>(arr: T[], flags: boolean[]) {
    if (!arr) return null;
    return arr.filter((_, idx) => flags[idx]);
}