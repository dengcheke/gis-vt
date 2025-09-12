import { assert, random } from "es-toolkit";
import type { BBox, Feature, GeoJSON } from "geojson";
import { getTileKey, type TileScheme, type TileXYZ } from "../src";
import type { Coord, Rings } from "../src/interface";
import { createEmptyExtent, createExtent, type Extent } from "./extent";

export function resolveFeaturesExtent(fs: Feature[]) {
    const extent = createEmptyExtent();
    for (let f of fs) {
        const geo = f.geometry;
        switch (geo.type) {
            case 'Point':
                resolvePoint(geo.coordinates); break;
            case 'MultiPoint':
            case 'LineString':
                geo.coordinates.forEach(resolvePoint); break;
            case 'MultiLineString':
            case 'Polygon':
                geo.coordinates.forEach(path => path.forEach(resolvePoint)); break;
            case 'MultiPolygon':
                geo.coordinates.forEach(rings => rings.forEach(path => path.forEach(resolvePoint)));
        }
    }
    return createExtent(extent);
    function resolvePoint([x, y]: Coord) {
        extent.xmin = Math.min(extent.xmin, x);
        extent.xmax = Math.max(extent.xmax, x);
        extent.ymin = Math.min(extent.ymin, y);
        extent.ymax = Math.max(extent.ymax, y);
    }
}

export function extentToBounds(extent: Extent) {
    return [extent.xmin, extent.ymin, extent.xmax, extent.ymax]
}


export function loadImg(url: string) {
    return new Promise<HTMLImageElement>(resolve => {
        const img = new Image();
        img.src = url;
        img.onload = () => resolve(img);
    })
}



//从xyz中解析出瓦片
export function resolveTileFromXYZ(
    { origin, lods, tileSize, wrapX, wrapY }: TileScheme,
    { x, y, z }: TileXYZ
) {
    assert(z >= 0 && z === Math.floor(z), `can not get tile at z:${z}`);
    const { z: z0, resolution: r0, scale: s0 } = lods[0];
    const resolution = r0 * 2 ** (z0 - z);
    const scale = s0 * 2 ** (z0 - z);
    const [ox, oy] = origin;

    const worldTileCount = 1 << z;

    const wx = wrapX ? Math.floor(x / worldTileCount) : 0;
    const wy = wrapY ? Math.floor(y / worldTileCount) : 0;

    x = wrapX ? (x - wx * worldTileCount) : x;
    y = wrapY ? (y - wy * worldTileCount) : y;

    const tileSizeX = resolution * tileSize[0];
    const tileSizeY = resolution * tileSize[1];

    const xmin = ox + x * tileSizeX;
    const ymax = oy - y * tileSizeY;
    const xmax = xmin + tileSizeX;
    const ymin = ymax - tileSizeY;
    return {
        key: getTileKey({ x, y, z }),
        x,
        y,
        z,
        resolution,
        scale,
        wx,
        wy,
        bbox: [xmin, ymin, xmax, ymax] as BBox
    }
}
export function getCRS(data: any) {
    const crs = data.crs;
    if (!crs) return 'EPSG:4326';
    if ('type' in crs) {
        //"crs": { "type": "name", "properties": { "name": "urn:ogc:def:crs:EPSG::3857" } }
        //urn:ogc:def:crs:AUTHORITY:VERSION:CODE
        if (crs.type === 'name') {
            return 'EPSG:' + crs.properties.name.match(/urn:ogc:def:crs:(.*):(.*):(.*)$/)[3];
        } else {
            console.error('解析crs失败,', crs);
            throw new Error(`解析crs失败`)
        }
    }
    return 'EPSG:4326';

}
export function parseGeoJSON(data: GeoJSON) {
    if (data.type === 'FeatureCollection') {
        return data.features;
    } else if (data.type === 'Feature') {
        return [data];
    } else {
        switch (data.type) {
            case 'Point':
            case 'MultiPoint':
            case 'LineString':
            case 'MultiLineString':
            case 'Polygon':
            case 'MultiPolygon':
                return [{
                    geometry: data,
                    properties: null
                } as Feature]
            case 'GeometryCollection': {
                const commonProperties = {};
                return data.geometries.map(singleGeo => {
                    return {
                        geometry: singleGeo,
                        properties: commonProperties,
                    } as Feature
                })
            }
        }
    }
}

// 引入 proj4（Node.js 需要先 require）
import earcut, { flatten } from "earcut";
import proj4 from 'proj4';
const proj = proj4('EPSG:4326', 'EPSG:3857');

export function lonlatTo3857(lonlat: Coord) {
    return proj.forward(lonlat);
}

export function projFeature(fs: Feature[], srcCrs: string, targetCRS: string) {
    const proj = proj4(srcCrs, targetCRS).forward;
    return fs.map(f => {
        switch (f.geometry.type) {
            case "Point":
                f.geometry.coordinates = proj(f.geometry.coordinates); return f;
            case "MultiPoint":
            case "LineString":
                f.geometry.coordinates = f.geometry.coordinates.map(i => proj(i)); return f;
            case "MultiLineString":
            case "Polygon":
                f.geometry.coordinates = f.geometry.coordinates.map(path => path.map(i => proj(i))); return f;
            case "MultiPolygon":
                f.geometry.coordinates = f.geometry.coordinates.map(rings => rings.map(path => path.map(i => proj(i)))); return f;
        }
    });
}

export function randomColor(count: number) {
    return new Array(count).fill(0).map(() => {
        const r = random(0, 255) | 0;
        const g = random(0, 255) | 0;
        const b = random(0, 255) | 0;
        return `rgb(${r},${g},${b})`;
    })
}


const canvas = document.createElement('canvas');
const ctx = canvas.getContext('2d', {
    willReadFrequently: true,

});
canvas.width = canvas.height = 1;
export function colorToRGBA(color: string) {
    ctx.fillStyle = color;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillRect(0, 0, 1, 1);
    return ctx.getImageData(0, 0, 1, 1).data;
}

type TypedArray =
    | Int8Array
    | Uint8Array
    | Uint8ClampedArray
    | Int16Array
    | Uint16Array
    | Int32Array
    | Uint32Array
    | Float32Array
    | Float64Array;
type TypedArrayConstructor =
    | Int8ArrayConstructor
    | Uint8ArrayConstructor
    | Uint8ClampedArrayConstructor
    | Int16ArrayConstructor
    | Uint16ArrayConstructor
    | Int32ArrayConstructor
    | Uint32ArrayConstructor
    | Float32ArrayConstructor
    | Float64ArrayConstructor;
//合并面细分
export function mergePolygonTessellation(
    tesses: PolygonEarcutTessellation[],
    vertexArrayType?: TypedArrayConstructor,
    indicesArrayType?: TypedArrayConstructor
): PolygonEarcutTessellation {
    if (tesses.length <= 1) return tesses[0];

    const d = tesses[0].dimensions;

    const { vertexCount, indexCount } = tesses.reduce((total, item) => {
        total.vertexCount += item.vertexCount;
        total.indexCount += item.indices.length
        return total;
    }, { vertexCount: 0, indexCount: 0 });
    const vertexArr = new (vertexArrayType ?? Array)(vertexCount * d); //[x, y, ]
    const indexArr = new (indicesArrayType ?? Array)(indexCount);
    for (
        let index = 0,
        len = tesses.length,
        vertexCursor = 0, //顶点游标
        indexCursor = 0; //索引游标
        index < len;
        index++
    ) {
        const { vertices, indices, dimensions } = tesses[index];
        if (dimensions !== d) throw new Error('cannot merge data from different dimensions');
        for (let i = 0, len = indices.length; i < len; i++) {
            indexArr[indexCursor] = vertexCursor + indices[i];
            indexCursor++;
        }
        for (let i = 0, len = vertices.length / dimensions; i < len; i++) {
            const idx = i * dimensions;
            const c = vertexCursor * dimensions;
            for (let j = 0; j < dimensions; j++) {
                vertexArr[c + j] = vertices[idx + j]
            }
            vertexCursor++;
        }
    }
    return {
        vertexCount,
        vertices: vertexArr,
        indices: indexArr,
        dimensions: d,
        holes: undefined
    };
}

export interface PolygonEarcutTessellation {
    vertices: TypedArray | number[]; //[x1, y1, x2, y2, x3, y3, ...]
    indices: TypedArray | number[]; //索引
    vertexCount: number;//顶点数
    dimensions: number;// 维度 2 = xy, 3 = xyz, ...
    holes: number[],
}

//细分一个面
export function tessellatePolygon(rings: Rings): PolygonEarcutTessellation {
    const { vertices, holes, dimensions } = flatten(rings);
    const indices = earcut(vertices, holes, dimensions);
    if (!indices?.length) return null;
    return {
        indices,
        vertices,
        vertexCount: vertices.length / dimensions,
        dimensions,
        holes
    }
}


export function shiftCoords(points: Coord[], offset: number[]) {
    return points.map(p => [p[0] + offset[0], p[1] + offset[1]])
}