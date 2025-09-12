import type { BBox } from "geojson";
import { bboxFromPoints, resolveVFeatureBBox, xRange, yRange } from "./bbox";
import { type Coord, type Path, type VFeature, type VPoint, type VPolygon, type VPolyline, type VTOption } from "./interface";
import { lerp } from "./utils";


/* clip features between two vertical or horizontal axis-parallel lines:
 *     |        |
 *  ___|___     |     /
 * /   |   \____|____/
 *     |        |
 *
 * k1 and k2 are the line coordinates (k1<k2)
 * minAll and maxAll: minimum and maximum coordinate value for all features
 */
export function clipVT(
    srcData: VFeature[], //要裁剪数据源
    k1: number, //原始裁剪范围最小值
    k2: number, //原始裁剪范围最大值
    axis: "x" | "y",
    srcBBox: BBox, //数据源范围,
    options: VTOption
): {
    data: VFeature[],
    bbox: BBox,
} {
    const isXAxis = axis === 'x';
    const getMinMax = isXAxis ? xRange : yRange;
    const [minAll, maxAll] = getMinMax(srcBBox);

    //无交集
    if (minAll >= k2 || maxAll <= k1) {
        return null;
    }
    //完全包含
    if (minAll >= k1 && maxAll <= k2) {
        return {
            data: srcData,
            bbox: srcBBox,
        };
    }

    const result: VFeature[] = [];

    for (const f of srcData) {
        switch (f.type) {
            case 'point': resolvePoint(f); break;
            case 'polyline': resolvePolyline(f); break;
            case 'polygon': resolvePolygon(f); break;
        }
    }
    if (!result.length) return null;
    return {
        data: result,
        bbox: resolveVFeatureBBox(result),
    };

    function resolvePoint(p: VPoint) {
        const v = p.coordinates[isXAxis ? 0 : 1];
        if (v >= k1 && v <= k2) result.push(p);
    }

    function resolvePolyline(line: VPolyline) {
        const [min, max] = getMinMax(line.bbox);
        if (min >= k1 && max <= k2) {
            result.push(line);
            return;
        } else if (max < k1 || min > k2) {
            return;
        }
        const clips = options.keepLinePoint
            ? clipPolylinePath_noClip(line, k1, k2, isXAxis, options)
            : clipPolylinePath(line, k1, k2, isXAxis, options);
        result.push(...clips);
    }

    function resolvePolygon(polygon: VPolygon) {
        const { bbox, coordinates, id } = polygon;
        const [min, max] = getMinMax(bbox);
        if (min >= k1 && max <= k2) {
            result.push(polygon);
            return;
        } else if (max < k1 || min > k2) {
            return;
        }
        if (options.keepPolygonPoint) {
            const clipResults = coordinates.map((ring, ringIndex) => clipPolygonRing_noClip(
                ring, k1, k2, isXAxis, polygon.vertexIndex?.[ringIndex], options)
            )
                .filter(i => i.ring.length > 0)
                .filter(Boolean);
            clipResults.forEach(item => {
                const oldLength = item.ring.length;
                item.ring = closeRing(item.ring);
                if (oldLength !== item.ring.length) {
                    item.index.push(item.index[0])
                }
            });
            result.push({
                id,
                properties: polygon.properties,
                type: "polygon",
                multiPolygonIndex: polygon.multiPolygonIndex,
                coordinates: clipResults.map(item => item.ring),
                bbox: bboxFromPoints(clipResults[0].ring),
                vertexIndex: clipResults.map(item => item.index),
            } as VPolygon);
        } else {
            const clipRings = coordinates.map(ring => clipPolygonRing(ring, k1, k2, isXAxis))
                .filter(i => i.ring.length > 0)
                .map(i => i.ring);
            result.push({
                id,
                properties: polygon.properties,
                type: "polygon",
                multiPolygonIndex: polygon.multiPolygonIndex,
                coordinates: clipRings.map(ring => closeRing(ring)),
                bbox: bboxFromPoints(clipRings[0]),
                vertexIndex: undefined,
            } as VPolygon);
        }
    }
}

function clipPolygonRing(points: Coord[], k1: number, k2: number, axis_x: boolean) {
    const intersect = axis_x ? intersectX : intersectY;
    let result = [] as Coord[];
    for (let i = 0, len = points.length - 1; i < len; i++) {
        const pa = points[i];
        const pb = points[i + 1];
        const a = axis_x ? pa[0] : pa[1];
        const b = axis_x ? pb[0] : pb[1];

        if (a < k1) {
            // (a)---|-->(b) tile  | (line enters the clip region from the left)
            if (b > k1) {
                intersect(result, pa, pb, k1);
            }
        } else if (a > k2) {
            // |  tile (b)<--|---(a) (line enters the clip region from the right)
            if (b < k2) {
                intersect(result, pa, pb, k2);
            }
        } else {
            addPoint(result, pa);
        }
        if (b < k1 && a >= k1) {
            //(line exits the clip region on the left)
            // (b)<--|---(a)   |  or  (b)<--|------|---(a)
            //       |   tile  |            | tile |
            intersect(result, pa, pb, k1);
        }
        if (b > k2 && a <= k2) {
            //(line exits the clip region on the right)
            // |  (a)---|-->(b)  or  (a)---|------|-->(b)
            // |   tile |                  | tile |
            intersect(result, pa, pb, k2);
        }
    }

    // add the last point
    const last = points[points.length - 1];
    const a = axis_x ? last[0] : last[1];
    if (a >= k1 && a <= k2) {
        addPoint(result, last);
    }
    return { ring: result }
}

function clipPolygonRing_noClip(points: Coord[], k1: number, k2: number, axis_x: boolean, rawVertexIndex: [number, number][], { keepPolygonPointIndex }: VTOption) {
    const result = [] as Coord[];
    const vertexIndex = keepPolygonPointIndex ? [] as [number, number][] : null;
    for (let i = 0, len = points.length - 1; i < len; i++) {
        const pa = points[i];
        const pb = points[i + 1];
        const a = axis_x ? pa[0] : pa[1];
        const b = axis_x ? pb[0] : pb[1];

        if (a < k1) {
            // (a)---|-->(b) tile  | (line enters the clip region from the left)
            if (b > k1) {
                addPoint(result, pa) && keepPolygonPointIndex && vertexIndex.push(rawVertexIndex[i]);
            }
        } else if (a > k2) {
            // |  tile (b)<--|---(a) (line enters the clip region from the right)
            if (b < k2) {
                addPoint(result, pa) && keepPolygonPointIndex && vertexIndex.push(rawVertexIndex[i]);
            }
        } else {
            addPoint(result, pa) && keepPolygonPointIndex && vertexIndex.push(rawVertexIndex[i]);
        }
        if (b < k1 && a >= k1) {
            //(line exits the clip region on the left)
            // (b)<--|---(a)   |  or  (b)<--|------|---(a)
            //       |   tile  |            | tile |
            addPoint(result, pb) && keepPolygonPointIndex && vertexIndex.push(rawVertexIndex[i + 1]);
        }
        if (b > k2 && a <= k2) {
            //(line exits the clip region on the right)
            // |  (a)---|-->(b)  or  (a)---|------|-->(b)
            // |   tile |                  | tile |
            addPoint(result, pb) && keepPolygonPointIndex && vertexIndex.push(rawVertexIndex[i + 1]);
        }
    }

    // add the last point
    const lastIndex = points.length - 1;
    const last = points[lastIndex];
    const a = axis_x ? last[0] : last[1];
    if (a >= k1 && a <= k2) {
        addPoint(result, last) && keepPolygonPointIndex && vertexIndex.push(rawVertexIndex[lastIndex]);
    }
    return {
        ring: result,
        index: vertexIndex
    }
}

function clipPolylinePath(line: VPolyline, k1: number, k2: number, axis_x: boolean, { calcLineDistance }: VTOption) {
    const distance = line.distances;
    const points = line.coordinates;
    const result = [] as VPolyline[];
    const intersect = axis_x ? intersectX : intersectY;
    let subLine = create();
    for (let i = 0, len = points.length; i < len - 1; i++) {
        const pa = points[i];
        const pb = points[i + 1];
        const a = axis_x ? pa[0] : pa[1];
        const b = axis_x ? pb[0] : pb[1];
        const disa = distance?.[i];
        const disb = distance?.[i + 1];
        let exited = false,
            t: number = null;

        if (a < k1) {
            // (a)---|-->(b) tile  | (line enters the clip region from the left)
            if (b > k1) {
                t = intersect(subLine.coordinates, pa, pb, k1);
                calcLineDistance && subLine.distances.push(lerp(disa, disb, t));
            }
        } else if (a > k2) {
            // |  tile (b)<--|---(a) (line enters the clip region from the right)
            if (b < k2) {
                t = intersect(subLine.coordinates, pa, pb, k2);
                calcLineDistance && subLine.distances.push(lerp(disa, disb, t));
            }
        } else {
            addPoint(subLine.coordinates, pa);
            t = 0;
            calcLineDistance && subLine.distances.push(disa);
        }

        if (b < k1 && a >= k1) {
            //(line exits the clip region on the left)
            // (b)<--|---(a)   |  or  (b)<--|------|---(a)
            //       |   tile  |            | tile |
            t = intersect(subLine.coordinates, pa, pb, k1);
            calcLineDistance && subLine.distances.push(lerp(disa, disb, t));
            exited = true;
        }
        if (b > k2 && a <= k2) {
            //(line exits the clip region on the right)
            // |  (a)---|-->(b)  or  (a)---|------|-->(b)
            // |   tile |                  | tile |
            t = intersect(subLine.coordinates, pa, pb, k2);
            calcLineDistance && subLine.distances.push(lerp(disa, disb, t));
            exited = true;
        }

        if (exited) {
            if (subLine.coordinates.length >= 2) {
                result.push({
                    id: line.id,
                    properties: line.properties,
                    type: 'polyline',
                    multiLineStringIndex: line.multiLineStringIndex,
                    coordinates: subLine.coordinates,
                    bbox: bboxFromPoints(subLine.coordinates),
                    distances: subLine.distances,
                    totalDistance: line.totalDistance,
                } as VPolyline);
            }
            subLine = create();
            t = null;
        }
    }

    // add the last point
    const last = points[points.length - 1];
    const a = axis_x ? last[0] : last[1];
    if (a >= k1 && a <= k2) {
        addPoint(subLine.coordinates, last);
        calcLineDistance && subLine.distances.push(distance[points.length - 1]);
    }

    // add the final slice
    if (subLine.coordinates.length >= 2) {
        result.push({
            id: line.id,
            properties: line.properties,
            type: 'polyline',
            multiLineStringIndex: line.multiLineStringIndex,
            coordinates: subLine.coordinates,
            bbox: bboxFromPoints(subLine.coordinates),
            distances: subLine.distances,
            totalDistance: line.totalDistance,
        } as VPolyline);
    }

    return result;

    function create() {
        return {
            coordinates: [] as Coord[],
            distances: calcLineDistance ? [] as number[] : null,
            totalDistance: null as number,
            vertexIndex: null as number[],
        }
    }
}

function clipPolylinePath_noClip(line: VPolyline, k1: number, k2: number, axis_x: boolean, { keepLinePointIndex, calcLineDistance }: VTOption) {
    const distance = line.distances;
    const points = line.coordinates;
    const result = [] as VPolyline[];
    let subLine = create();
    for (let i = 0, len = points.length; i < len - 1; i++) {
        const pa = points[i];
        const pb = points[i + 1];
        const a = axis_x ? pa[0] : pa[1];
        const b = axis_x ? pb[0] : pb[1];
        const disa = distance?.[i];
        const disb = distance?.[i + 1];
        let exited = false;

        if (a < k1) {
            // (a)---|-->(b) tile  | (line enters the clip region from the left)
            if (b > k1) {
                const added = addPoint(subLine.coordinates, pa);
                added && keepLinePointIndex && subLine.vertexIndex.push(line.vertexIndex[i]);
                added && calcLineDistance && subLine.distances.push(disa);
            }
        } else if (a > k2) {
            // |  tile (b)<--|---(a) (line enters the clip region from the right)
            if (b < k2) {
                const added = addPoint(subLine.coordinates, pa);
                added && keepLinePointIndex && subLine.vertexIndex.push(line.vertexIndex[i]);
                added && calcLineDistance && subLine.distances.push(disa);
            }
        } else {
            const added = addPoint(subLine.coordinates, pa);
            added && keepLinePointIndex && subLine.vertexIndex.push(line.vertexIndex[i]);
            added && calcLineDistance && subLine.distances.push(disa);
        }

        if (b < k1 && a >= k1) {
            //(line exits the clip region on the left)
            // (b)<--|---(a)   |  or  (b)<--|------|---(a)
            //       |   tile  |            | tile |
            const added = addPoint(subLine.coordinates, pb);
            added && keepLinePointIndex && subLine.vertexIndex.push(line.vertexIndex[i + 1]);
            added && calcLineDistance && subLine.distances.push(disb);
            exited = true;
        }
        if (b > k2 && a <= k2) {
            //(line exits the clip region on the right)
            // |  (a)---|-->(b)  or  (a)---|------|-->(b)
            // |   tile |                  | tile |
            const added = addPoint(subLine.coordinates, pb);
            added && keepLinePointIndex && subLine.vertexIndex.push(line.vertexIndex[i + 1]);
            added && calcLineDistance && subLine.distances.push(disb);
            exited = true;
        }

        if (exited) {
            if (subLine.coordinates.length >= 2) {
                result.push({
                    id: line.id,
                    properties: line.properties,
                    type: 'polyline',
                    multiLineStringIndex: line.multiLineStringIndex,
                    coordinates: subLine.coordinates,
                    bbox: bboxFromPoints(subLine.coordinates),
                    vertexIndex: subLine.vertexIndex,
                    distances: subLine.distances,
                    totalDistance: line.totalDistance,
                } as VPolyline);
            }
            subLine = create();
        }
    }

    // add the last point
    const lastIndex = points.length - 1;
    const last = points[lastIndex];
    const a = axis_x ? last[0] : last[1];
    if (a >= k1 && a <= k2) {
        const added = addPoint(subLine.coordinates, last);
        added && keepLinePointIndex && subLine.vertexIndex.push(line.vertexIndex[lastIndex]);
        added && calcLineDistance && subLine.distances.push(distance[lastIndex]);
    }

    // add the final slice
    if (subLine.coordinates.length >= 2) {
        result.push({
            id: line.id,
            properties: line.properties,
            type: 'polyline',
            multiLineStringIndex: line.multiLineStringIndex,
            coordinates: subLine.coordinates,
            bbox: bboxFromPoints(subLine.coordinates),
            vertexIndex: subLine.vertexIndex,
            distances: subLine.distances,
            totalDistance: line.totalDistance,
        } as VPolyline);
    }

    return result;

    function create() {
        return {
            coordinates: [] as Coord[],
            distances: calcLineDistance ? [] as number[] : null,
            totalDistance: null as number,
            vertexIndex: keepLinePointIndex ? [] as number[] : null,
        }
    }
}

function addPoint(result: Coord[], p: Coord) {
    const length = result.length;
    if (length === 0 || !samePoint(p, result[length - 1], 1e-3)) {
        result.push(p);
        return true;
    } else {
        return false;
    }
}

function intersectX(result: Coord[], pa: Coord, pb: Coord, x: number) {
    const t = (x - pa[0]) / (pb[0] - pa[0]);
    addPoint(result, [
        x,
        lerp(pa[1], pb[1], t)
    ]);
    return t;
}

function intersectY(result: Coord[], pa: Coord, pb: Coord, y: number) {
    const t = (y - pa[1]) / (pb[1] - pa[1]);
    addPoint(result, [
        lerp(pa[0], pb[0], t),
        y
    ]);
    return t;
}

function equals(a: number, b: number, epsilon = Number.EPSILON) {
    return Math.abs(a - b) <= epsilon;
}

function samePoint(a: Coord, b: Coord, epsilon = 0) {
    return equals(a[0], b[0], epsilon) && equals(a[1], b[1], epsilon);
}

function closeRing(ring: Path) {
    const [x, y] = ring[0];
    const [nx, ny] = ring[ring.length - 1];
    if (x !== nx || y !== ny) {
        ring.push([x, y])
    }
    return ring;
}