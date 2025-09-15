import { assert } from "es-toolkit";
import type { BBox } from "geojson";
import type { TileScheme } from "./tile-scheme";


export interface TileXYZ {
    z: number,
    x: number,
    y: number,
};
export interface TileXYZW extends TileXYZ {
    wx: number;
    wy: number;
}

//xy is wrapped if tileScheme support wrap
export interface Tile extends TileXYZW {
    id: string, //z/y/x/wy/wx
    key: string, // z/y/x
    bbox: BBox, //wrapped bbox
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
export function getTileChildrenXYZW({ x, y, z, wx, wy }: TileXYZW) {
    z = z + 1;
    y = y * 2;
    x = x * 2;
    return [
        { z, x: x + 0, y: y + 0, wx, wy },
        { z, x: x + 1, y: y + 0, wx, wy },
        { z, x: x + 0, y: y + 1, wx, wy },
        { z, x: x + 1, y: y + 1, wx, wy },
    ] as TileXYZW[]
}

export function getTileChildren(tile: Tile, tileScheme: TileScheme) {
    return getTileChildrenXYZW(tile).map(p => createTile(tileScheme, p));
}

export function getParentXYZW({ x, y, z, wx, wy }: TileXYZW) {
    return {
        z: z - 1,
        x: Math.floor(x / 2),
        y: Math.floor(y / 2),
        wx,
        wy,
    } as TileXYZW;
}

export function getTileParent(tile: Tile, tileScheme: TileScheme) {
    return createTile(tileScheme, getParentXYZW(tile));
}

export function getTileNeighborXYZ({ x, y, z, wx, wy }: Tile, offset: number[], { wrapX, wrapY }: TileScheme) {
    x = wrapX ? unwrapTileIndex(z, x, wx) : x;
    y = wrapY ? unwrapTileIndex(z, y, wy) : y;
    return {
        x: x + offset[0],
        y: y + offset[1],
        z
    }
}

export function getTileNeighbor(tile: Tile, offset: number[], tileScheme: TileScheme) {
    return resolveTileFromXYZ(tileScheme, getTileNeighborXYZ(tile, offset, tileScheme));
}

//https://github.com/mapbox/geojson-vt/blob/main/src/index.js 
//#line 168
export function wrapTileIndex(z: number, v: number) {
    // v % (2^z)
    const z2 = 2 ** z;
    return (v + z2) & (z2 - 1);
}
export function unwrapTileIndex(z: number, v: number, world: number) {
    return v + world * (2 ** z);
}

//xyz可以是任意值
export function resolveTileFromXYZ(
    tileScheme: TileScheme,
    { x, y, z }: TileXYZ
): Tile {
    assert(z >= 0 && z === Math.floor(z), `can not get tile at z:${z}`);
    const { wrapX, wrapY } = tileScheme;
    const worldTileCount = 2 ** z;

    const wx = wrapX ? Math.floor(x / worldTileCount) : 0;
    const wy = wrapY ? Math.floor(y / worldTileCount) : 0;

    x = wrapX ? (x - wx * worldTileCount) : x;
    y = wrapY ? (y - wy * worldTileCount) : y;

    return createTile(tileScheme, { x, y, z, wx, wy });
}

//获取瓦片, x,y,z,wx,wy 必须满足环绕规则
export function createTile(
    { lods, origin, tileSize, wrapX, wrapY }: TileScheme,
    { x, y, z, wx, wy }: TileXYZW,
): Tile {
    assert(z >= 0 && z === Math.floor(z), `can not get tile at z:${z}`);
    if (wrapX) {
        wx !== 0 && assert(x === wrapTileIndex(z, x), `invalid x:${x}`);
    } else {
        assert(wx === 0, `invalid wx:${wx}`)
    }
    if (wrapY) {
        wy !== 0 && assert(y === wrapTileIndex(z, y), `invalid y:${y}`);
    } else {
        assert(wy === 0, `invalid wy:${wy}`)
    }

    const { z: z0, resolution: r0, scale: s0 } = lods[0];
    const f = 2 ** (z0 - z);
    const resolution = r0 * f;
    const scale = s0 * f;


    const tileSizeX = resolution * tileSize[0];
    const tileSizeY = resolution * tileSize[1];

    const xmin = origin[0] + x * tileSizeX;
    const ymax = origin[1] - y * tileSizeY;
    const xmax = xmin + tileSizeX;
    const ymin = ymax - tileSizeY;
    return {
        id: [z, y, x, wy, wx].join("/"),
        key: getTileKey({ x, y, z }),
        x,
        y,
        z,
        wx,
        wy,
        resolution,
        scale,
        bbox: [xmin, ymin, xmax, ymax]
    }
}
