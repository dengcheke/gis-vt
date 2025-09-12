import { assert } from "es-toolkit";
import type { BBox } from "geojson";
import type { TileScheme } from "./tile-scheme";


export interface TileXYZ {
    z: number,
    x: number,
    y: number,
};

//xy is wrapped if tileScheme support wrap
export interface Tile extends TileXYZ {
    key: string, // z/y/x
    bbox: BBox,
    resolution: number,
    scale: number,
};

//z/y/x
export function getTileKey({ x, y, z }: TileXYZ) {
    return [z, y, x].join('/');
}

export function tileKeyToXYZ(key: string) {
    const [z, y, x] = key.split("/")
    return { z: +z, y: +y, x: +x }
}

//[topLeft, topRight, bottomLeft, bottomRight]
export function getTileChildrenXYZ({ x, y, z }: TileXYZ) {
    z = z + 1;
    y = y * 2;
    x = x * 2;
    return [
        { z, x: x + 0, y: y + 0 },
        { z, x: x + 1, y: y + 0 },
        { z, x: x + 0, y: y + 1 },
        { z, x: x + 1, y: y + 1 },
    ] as TileXYZ[]
}

export function getTileChildren(tile: Tile, tileScheme: TileScheme) {
    return getTileChildrenXYZ(tile).map(p => getTile(tileScheme, p));
}

export function getParentXYZW({ x, y, z }: TileXYZ) {
    return {
        z: z - 1,
        x: Math.floor(x / 2),
        y: Math.floor(y / 2),
    } as TileXYZ;
}

export function getTileParent(tile: Tile, tileScheme: TileScheme) {
    return getTile(tileScheme, getParentXYZW(tile));
}

//https://github.com/mapbox/geojson-vt/blob/main/src/index.js 
//#line 168
export function wrapTileIndex(z: number, v: number) {
    const z2 = 2 ** z;
    return (v + z2) & (z2 - 1);
}

//获取瓦片
export function getTile(
    { lods, origin, tileSize, wrapX, wrapY }: TileScheme,
    { x, y, z }: TileXYZ,
): Tile {
    assert(z >= 0 && z === Math.floor(z), `can not get tile at z:${z}`);

    const { z: z0, resolution: r0, scale: s0 } = lods[0];
    const resolution = r0 * 2 ** (z0 - z);
    const scale = s0 * 2 ** (z0 - z);

    x = wrapX ? wrapTileIndex(z, x) : x;
    y = wrapY ? wrapTileIndex(z, y) : y;

    const [ox, oy] = origin;

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
        bbox: [xmin, ymin, xmax, ymax]
    }
}
