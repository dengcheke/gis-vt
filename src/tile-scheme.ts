import { clamp } from "es-toolkit";
import type { BBox } from "geojson";
import { bboxDetail } from "./bbox";
import type { Coord } from "./interface";
import { ceilPowerOfTwo } from "./utils";

export interface TileScheme {
    minZoom: number, //最低等级
    maxZoom: number, //最高等级
    origin: Coord, //切片方案原点坐标 [xmin, ymax]
    tileSize: number[], //瓦片大小（像素）
    //切片分级
    lods: {
        z: number,  //等级
        resolution: number, //分辨率 1像素 = resolution 个地图单位 
        scale: number //比例尺
    }[],
    worldBBox: BBox, //切片世界范围
    wrapX: boolean,  //x方向是否可环绕
    wrapY: boolean,  //y方向是否可环绕
    dpi: number,
}

export function zoomToScale(z: number, lods: TileScheme['lods']) {
    const { scale: maxScale, z: z0 } = lods[0];
    return maxScale / 2 ** (z - z0);
}

export function scaleToZoom(scale: number, lods: TileScheme['lods']) {
    const { scale: maxScale, z: z0 } = lods[0];
    const minScale = lods[lods.length - 1].scale;
    scale = clamp(scale, minScale, maxScale);
    return z0 + Math.log2(maxScale / scale);
}

const INCH = 0.0254;
export function createTileScheme(opts: {
    origin: Coord,
    worldSize: number,
    maxZoom: number,
    tileSize: number,
    wrapX: boolean,
    wrapY: boolean,
    dpi: number,
}) {
    const { origin, worldSize, maxZoom, tileSize, wrapX, wrapY, dpi } = opts;
    const [xmin, ymax] = origin;
    const r0 = worldSize / tileSize;
    const s0 = dpi / INCH * r0;
    return {
        minZoom: 0,
        maxZoom,
        origin,
        tileSize: [tileSize, tileSize],
        lods: new Array(maxZoom + 1).fill(0).map((_, z) => {
            const f = 1 / (2 ** z);
            return {
                z,
                resolution: r0 * f,
                scale: s0 * f,
            }
        }),
        worldBBox: [
            xmin,
            ymax - opts.worldSize,
            xmin + opts.worldSize,
            ymax
        ] as BBox,
        wrapX,
        wrapY,
        dpi
    }
}

export function createTileSchemeWebMercator(maxZoom = 24, tileSize = 256, dpi = 96): TileScheme {
    const V = 20037508.3427892;
    return createTileScheme({
        origin: [-V, V],
        worldSize: V * 2,
        maxZoom,
        tileSize,
        wrapX: true,
        wrapY: false,
        dpi
    });
}

type O = {
    tileSize: number;
    dpi: number;
    wrapX: boolean;
    wrapY: boolean
};
export function createTileSchemeFromBBoxAndZoom(
    bbox: BBox,
    maxZoom: number,
    {
        tileSize = 256,
        dpi = 96,
        wrapX = false,
        wrapY = false
    } = {} as O
) {
    const { width, height, cx, cy } = bboxDetail(bbox);
    const worldSize = Math.max(width, height);
    return createTileScheme({
        origin: [
            cx - worldSize / 2,
            cy + worldSize / 2
        ],
        worldSize,
        maxZoom,
        tileSize,
        wrapX,
        wrapY,
        dpi,
    })
}

export function createTileSchemeFromBBoxAndScale(
    bbox: BBox, //数据范围
    baseScale: number, //数据比例
    {
        tileSize = 256,
        dpi = 96,
        wrapX = false,
        wrapY = false
    } = {} as O
): TileScheme {
    const { width, height, cx, cy } = bboxDetail(bbox);
    const baseResolution = baseScale / (dpi / INCH);
    const baseTileSizeWorld = tileSize * baseResolution;
    const baseTileCount = Math.max(width, height) / baseTileSizeWorld;
    const maxZoom = Math.log2(ceilPowerOfTwo(Math.ceil(baseTileCount)));
    const worldSize = 2 ** maxZoom * baseTileSizeWorld;
    return createTileScheme({
        origin: [
            cx - worldSize / 2,
            cy + worldSize / 2
        ],
        worldSize,
        maxZoom,
        tileSize,
        wrapX,
        wrapY,
        dpi,
    })
}