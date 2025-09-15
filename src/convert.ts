import type { Feature, LineString, MultiLineString, MultiPoint, MultiPolygon, Point, Polygon } from "geojson";
import { bboxFromPoints } from "./bbox";
import type { InputFeature, MaybeArray, Rings, VPoint, VPolygon, VPolyline, VTOption } from "./interface";

type O = Pick<VTOption,
    'calcLineDistance' |
    'keepLinePointIndex' |
    'multiLineDistanceStrategy' |
    'multiLineDistanceLink' |
    'keepPolygonPointIndex'
>;
export function toVFeatures(fs: InputFeature[], options: O) {
    return fs.map(validate)
        .filter(Boolean)
        .map(f => {
            switch (f.geometry.type) {
                case "Point":
                case "MultiPoint":
                    return toVPoint(f as Feature<Point | MultiPoint>);
                case "LineString":
                case "MultiLineString":
                    return toVPolyline(f as Feature<LineString | MultiLineString>, options);
                case "Polygon":
                case "MultiPolygon":
                    return toPolygon(f as Feature<Polygon | MultiPolygon>, options);
            }
        })
        .flat();
}

const ConvertMap =/*#__PURE__*/  {
    "MultiPoint": "Point",
    "MultiLineString": "LineString",
    "MultiPolygon": "Polygon",
} as const;

function validate(f: InputFeature): Feature {
    const { geometry } = f;
    switch (geometry?.type) {
        case "Point":
            return geometry.coordinates?.length ? f : null;
        case "LineString":
            return geometry.coordinates?.length >= 2 ? f : null;
        case "Polygon":
            return geometry.coordinates?.[0]?.length >= 4 ? f : null;
        case "MultiPoint":
        case "MultiLineString":
        case "MultiPolygon": {
            const length = geometry.coordinates?.length;
            if (!length) return null;
            if (length === 1) {
                return validate({
                    ...f,
                    //@ts-ignore
                    geometry: {
                        type: ConvertMap[geometry.type],
                        coordinates: geometry.coordinates[0]
                    }
                })
            }
            return f;
        }
        default: return null;
    }
}
function toVPoint({ geometry, properties, id }: InputFeature<Point | MultiPoint>): MaybeArray<VPoint> {
    if (geometry.type === 'Point') {
        return {
            id,
            properties,
            type: 'point',
            multiPointIndex: undefined,
            coordinates: geometry.coordinates
        }
    }
    else if (geometry.type === 'MultiPoint') {
        return geometry.coordinates.map((coord, index) => {
            return {
                id,
                properties,
                type: 'point',
                multiPointIndex: index,
                coordinates: coord
            } as VPoint
        });
    }
}
function toVPolyline(
    { geometry, properties, id }: InputFeature<LineString | MultiLineString>,
    { calcLineDistance, keepLinePointIndex, multiLineDistanceStrategy, multiLineDistanceLink }: O
): MaybeArray<VPolyline> {
    if (geometry.type === 'LineString') {
        const { distances, totalDistance } = calcLineDistance ? calcDistance(geometry) : {};
        return {
            id,
            properties,
            type: 'polyline',
            multiLineStringIndex: undefined,
            coordinates: geometry.coordinates,
            bbox: bboxFromPoints(geometry.coordinates),
            vertexIndex: keepLinePointIndex ? Array.from(geometry.coordinates.keys()) : null,
            distances,
            totalDistance,
        }
    } else if (geometry.type === 'MultiLineString') {
        const { distances, totalDistances } = calcLineDistance
            ? calcDistanceMulti(
                geometry,
                (properties?.['multiLineDistanceStrategy'] ?? multiLineDistanceStrategy) === 'stand-alone',
                (properties?.['multiLineDistanceLink'] ?? multiLineDistanceLink)
            )
            : {};
        return geometry.coordinates.map((path, index) => {
            return {
                id,
                properties,
                type: 'polyline',
                multiLineStringIndex: index,
                coordinates: path,
                bbox: bboxFromPoints(path),
                vertexIndex: keepLinePointIndex ? Array.from(path.keys()) : null,
                distances: distances?.[index],
                totalDistance: totalDistances?.[index],
            }
        })
    }
}
function toPolygon(
    { geometry, properties, id }: Feature<Polygon | MultiPolygon>,
    { keepPolygonPointIndex }: O
): MaybeArray<VPolygon> {
    if (geometry.type === 'Polygon') {
        return {
            id,
            properties,
            type: 'polygon',
            multiPolygonIndex: undefined,
            coordinates: geometry.coordinates,
            bbox: bboxFromPoints(geometry.coordinates[0]),
            vertexIndex: keepPolygonPointIndex ? resolvePolygonPointIndex(geometry.coordinates) : undefined
        }
    } else if (geometry.type === 'MultiPolygon') {
        return geometry.coordinates.map((rings, index) => {
            return {
                id,
                properties,
                type: 'polygon',
                multiPolygonIndex: index,
                coordinates: rings,
                bbox: bboxFromPoints(rings[0]),
                vertexIndex: keepPolygonPointIndex ? resolvePolygonPointIndex(rings) : undefined
            }
        });
    }
}
function resolvePolygonPointIndex(rings: Rings) {
    return rings.map((ring, ringIndex) => {
        return ring.map((_, pointIndex) => [ringIndex, pointIndex] as [number, number])
    });
}
function calcDistance({ coordinates }: LineString) {
    const distances = new Array(coordinates.length).fill(0);
    for (let i = 1, j = 0; i < coordinates.length; i++, j++) {
        distances[i] = distances[j] + Math.hypot(
            coordinates[i][0] - coordinates[j][0],
            coordinates[i][1] - coordinates[j][1]
        )
    }
    return {
        distances,
        totalDistance: distances[distances.length - 1]
    };
}
function calcDistanceMulti({ coordinates: paths }: MultiLineString, alone: boolean, link: boolean) {
    let cumulativeDis = 0;
    const distanceArr = [] as number[][];
    const totalDistanceArr = new Array(paths.length).fill(0) as number[];
    for (let pathIndex = 0; pathIndex < paths.length; pathIndex++) {
        const path = paths[pathIndex];
        if (alone) {
            cumulativeDis = 0;
        } else {
            if (link && pathIndex > 0) {
                const lastPath = paths[pathIndex - 1]
                const end = lastPath[lastPath.length - 1];
                const start = path[0];
                cumulativeDis += Math.hypot(start[0] - end[0], start[1] - end[1])
            }
        }
        const pointDistance = new Array(path.length).fill(cumulativeDis);
        for (let i = 1, j = 0; i < path.length; i++, j++) {
            cumulativeDis = pointDistance[j] + Math.hypot(
                path[i][0] - path[j][0],
                path[i][1] - path[j][1]
            );
            pointDistance[i] = cumulativeDis;
        }
        distanceArr.push(pointDistance);
        alone && (totalDistanceArr[pathIndex] = cumulativeDis);
    }
    if (!alone) totalDistanceArr.fill(cumulativeDis);
    return { distances: distanceArr, totalDistances: totalDistanceArr };
}

