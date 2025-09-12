import { assert, clamp, groupBy, isNil } from "es-toolkit";
import type { BBox, Feature } from "geojson";
import { bboxDetail, resolveVFeatureBBox } from "./bbox";
import { clipVT } from "./clip";
import { toVFeatures } from "./convert";
import {
    type InputFeature,
    type VFeature,
    type VTNode,
    type VTOption,
    type VectorTileOptions
} from "./interface";
import { createVTNode } from "./node";
import { getTile, getTileChildren, getTileKey, wrapTileIndex } from "./tile";
import { wrap } from "./wrap";


export const DefaultVTOpts = {
    buffer: 4 / 256,
    indexMaxPoints: 100000,
    tolerance: 1,
    simplifyAtMaxZoom: false,

    keepLinePoint: false,
    keepLinePointIndex: false,
    calcLineDistance: false,

    keepPolygonPoint: false,
    keepPolygonPointIndex: false,

    multiLineDistanceStrategy: 'stand-alone' as VectorTileOptions['multiLineDistanceStrategy'],
    multiLineDistanceLink: false,
    static: true,
}

function resolveOption(option: VectorTileOptions): VTOption {
    assert(!!option.tileScheme, 'tileScheme not exist');
    const Q = option.Q;
    if (Q) {
        assert(typeof Q === 'number' && Q === Math.floor(Q), `Q must be positive integer`);
        assert(Q >= option.tileScheme.tileSize[0], `Q must >= tileScheme.tileSize`);
    }
    const minZoom = Math.max(option.minZoom ?? 0, option.tileScheme.minZoom);
    const maxZoom = Math.min(option.maxZoom ?? Infinity, option.tileScheme.maxZoom);

    option.buffer && assert(option.buffer >= 0, 'vector tile buffer must >= 0');

    const keepPolygonPoint = option.keepPolygonPoint ?? DefaultVTOpts.keepPolygonPoint;
    const keepPolygonPointIndex = option.keepPolygonPointIndex ?? DefaultVTOpts.keepPolygonPointIndex;
    if (keepPolygonPointIndex) {
        assert(keepPolygonPoint === true, 'when keepPolygonPointIndex is true, keepPolygonPoint must be true');
    }
    const keepLinePoint = option.keepLinePoint ?? DefaultVTOpts.keepLinePoint;
    const keepLinePointIndex = option.keepLinePointIndex ?? DefaultVTOpts.keepLinePointIndex;
    if (keepLinePointIndex) {
        assert(keepLinePoint === true, 'when keepLinePointIndex is true, keepLinePoint must be true');
    }
    return {
        static: option.static ?? DefaultVTOpts.static,
        Q,
        minZoom,
        maxZoom,
        tileScheme: option.tileScheme,
        indexMaxZoom: clamp(option.indexMaxZoom ?? (maxZoom / 3 >> 0), minZoom, maxZoom),
        indexMaxPoints: option.indexMaxPoints ?? DefaultVTOpts.indexMaxPoints,
        tolerance: option.tolerance ?? DefaultVTOpts.tolerance,
        buffer: clamp(option.buffer ?? DefaultVTOpts.buffer, 0, 0.5),
        debug: option.debug ?? false,
        keepPolygonPoint,
        keepPolygonPointIndex,
        simplifyAtMaxZoom: option.simplifyAtMaxZoom ?? DefaultVTOpts.simplifyAtMaxZoom,
        calcLineDistance: option.calcLineDistance ?? DefaultVTOpts.calcLineDistance,
        multiLineDistanceStrategy: option.multiLineDistanceStrategy ?? DefaultVTOpts.multiLineDistanceStrategy,
        multiLineDistanceLink: option.multiLineDistanceLink ?? DefaultVTOpts.multiLineDistanceLink,
        keepLinePoint,
        keepLinePointIndex,
        customSimplify: option.customSimplify
    };
}

export type VectorTile = ReturnType<typeof createVectorTile>;

export type VTEditParams = {
    adds?: InputFeature[],
    updates?: InputFeature[],
    removes?: (number | string)[],
};

export function createVectorTile(props: VectorTileOptions) {
    assert(!!props.source?.length, 'features is empty');
    const $options = resolveOption(props);
    const $tiles = new Map<string/*tileKey*/, VTNode>();
    const t = performance.now();
    if (!$options.static) checkSourceId(props.source);
    splitTileNode(wrap(toVFeatures(props.source, $options), $options), 0, 0, 0, null, null, null);
    $options.debug && console.log(`生成初始切片${(performance.now() - t).toFixed(2)}ms`);

    /**
     *  z,x,y 源tile
     *  tz,tx,ty 目标tile
     */
    function splitTileNode(
        source: {
            data: VFeature[],
            bbox: BBox,
        },
        sz: number,
        sx: number,
        sy: number,
        tz: number,
        tx: number,
        ty: number,
    ) {
        const stack = [
            {
                src: source,
                tile: getTile($options.tileScheme, { z: sz, x: sx, y: sy }),
            },
        ];
        while (stack.length) {

            const { src, tile } = stack.pop();
            const { z, x, y, key } = tile;

            if (!src?.data?.length || z < $options.minZoom || z > $options.maxZoom) {
                continue;
            }

            let tileNode = $tiles.get(key);
            if (!tileNode) {
                const now = performance.now();
                tileNode = createVTNode(src.data, src.bbox, tile, $options, false);
                $tiles.set(key, tileNode);
                if ($options.debug) {
                    console.log(
                        [
                            `%c ${key}`,
                            `%c ${(performance.now() - now).toFixed(2)} ms`,
                            `%c points: ${tileNode.sourcePointNums}`,
                            `%c simplify: ${tileNode.simplifiedPointNums}`,
                        ].join(" ") + ' ',
                        'background:#2cc9ff;color:white',
                        'background:#ff9800',
                        'background:darkgreen;color:white',
                        'background:skyblue',
                    );
                }
            }

            // 第一次split
            if (tz === undefined || tz === null) {
                // 到达maxZoom 或者 点数小于最大点数限制, 停止切分
                if (z === $options.indexMaxZoom || tileNode.sourcePointNums <= $options.indexMaxPoints) {
                    continue;
                }
            } else {
                if (z === $options.maxZoom || z === tz) {
                    //到达最大层级后不会在继续细分, source不需要了
                    z === $options.maxZoom && (tileNode.source = null);
                    continue;
                } {
                    // 非目标切片
                    const zoomSteps = tz - z;
                    if (x !== (tx >> zoomSteps) || y !== (ty >> zoomSteps)) {
                        continue;
                    }
                }
            }

            // 继续切分, 则不在需要保存源几何数据
            tileNode.source = null;
            tileNode.sourceBBox = null;

            const { xmin, ymin, xmax, ymax, width, cx, cy } = bboxDetail(tile.bbox);

            const padding = $options.buffer * width;
            type R = ReturnType<typeof clipVT>;
            let topLeft: R = null;
            let bottomLeft: R = null;
            let topRight: R = null;
            let bottomRight: R = null;


            let left = clipVT(src.data, xmin - padding, cx + padding, "x", src.bbox, $options);
            let right = clipVT(src.data, cx - padding, xmax + padding, "x", src.bbox, $options);

            if (left) {
                topLeft = clipVT(left.data, cy - padding, ymax + padding, "y", left.bbox, $options);
                bottomLeft = clipVT(left.data, ymin - padding, cy + padding, "y", left.bbox, $options);
                left = null;
            }
            if (right) {
                topRight = clipVT(right.data, cy - padding, ymax + padding, "y", right.bbox, $options);
                bottomRight = clipVT(right.data, ymin - padding, cy + padding, "y", right.bbox, $options);
                right = null;
            }

            tileNode.hasDrillDown = true;

            const childTiles = getTileChildren(tile, $options.tileScheme);
            [topLeft, topRight, bottomLeft, bottomRight]
                .forEach((item, idx) => {
                    item && stack.push({
                        src: {
                            data: item.data,
                            bbox: item.bbox
                        },
                        tile: childTiles[idx],
                    });
                });
        }
    }

    function getTileNode(z: number, x: number, y: number): VTNode {
        if (z < 0 || z > $options.tileScheme.maxZoom) return null;

        if ($options.tileScheme.wrapX) x = wrapTileIndex(z, x);
        if ($options.tileScheme.wrapY) y = wrapTileIndex(z, y);

        const key = getTileKey({ z, x, y });

        if ($tiles.has(key)) return $tiles.get(key);

        let z0 = z;
        let x0 = x;
        let y0 = y;
        let parent;

        while (!parent && z0 > 0) {
            z0--;
            x0 = x0 >> 1;
            y0 = y0 >> 1;
            parent = $tiles.get(getTileKey({ z: z0, y: y0, x: x0 }));
        }

        if (!parent) return null;

        splitTileNode({
            data: parent.source,
            bbox: parent.sourceBBox,
        }, z0, x0, y0, z, x, y);

        return $tiles.get(key);
    }

    function applyEdits({ adds = [], updates = [], removes = [] }: VTEditParams) {
        assert(!$options.static, 'static vector tile  can not modify');
        const changes = new Set<string>();
        const removeSet = new Set(removes);
        const needChecks = $tiles.keys().filter(key => inRangeZ($tiles.get(key).tile.z));
        if (updates.length) {
            const { news = [], propOnly = [] } = groupBy(
                updates.filter(i => !isNil(i.id) && (i.geometry || i.properties)),
                i => i.geometry ? 'news' : 'propOnly'
            );
            news.forEach(i => removeSet.add(i.id)); //remove first and then add
            adds.push(...news);
            if (propOnly.length) {
                const propMap = propOnly.reduce((map, f) => {
                    map[f.id] = f.properties;
                    return map;
                }, {} as Record<string | number, any>);
                for (let key of needChecks) {
                    const tileData = $tiles.get(key);
                    let change = false;
                    tileData.source?.forEach(vf => {
                        if (propMap[vf.id]) {
                            vf.properties = propMap[vf.id];
                            change = true;
                        }
                    });
                    tileData.simplified.forEach(vf => {
                        if (propMap[vf.id]) {
                            vf.properties = propMap[vf.id];
                            change = true;
                        }
                    });
                    change && changes.add(key);
                }
            }
        }
        if (removeSet.size) {
            for (let key of needChecks) {
                const tileNode = $tiles.get(key);
                let change = false;
                if (tileNode.source?.length) {
                    const oldSize = tileNode.source.length;
                    tileNode.source = tileNode.source.filter(i => !removeSet.has(i.id));
                    change = oldSize !== tileNode.source.length;
                }
                const oldLength = tileNode.simplified.length;
                tileNode.simplified = tileNode.simplified.filter(i => !removeSet.has(i.id));
                change = change || oldLength !== tileNode.simplified.length;
                change && changes.add(key);
            }
        }
        if (adds.length) {
            const stack = [
                {
                    src: wrap(toVFeatures(adds, $options), $options),
                    tile: $tiles.get(getTileKey({ x: 0, y: 0, z: 0 })).tile,
                },
            ];
            while (stack.length) {
                const { src, tile } = stack.pop();
                changes.add(tile.key);
                const raw = $tiles.get(tile.key);
                const addNode = createVTNode(src.data, src.bbox, tile, $options, true);
                if (raw) {
                    //merge
                    if (inRangeZ(raw.tile.z)) {
                        raw.simplified.push(...addNode.simplified);
                    }
                    if (!raw.hasDrillDown && raw.tile.z < $options.maxZoom) {
                        raw.source.push(...addNode.source);
                        continue;
                    }
                } else {
                    $tiles.set(tile.key, addNode);
                }
                if (!src.data.length) continue;
                if (tile.z === $options.tileScheme.maxZoom) continue;
                const { xmin, ymin, xmax, ymax, width, cx, cy } = bboxDetail(tile.bbox);
                const padding = $options.buffer * width;
                type R = ReturnType<typeof clipVT>;
                let topLeft: R = null;
                let bottomLeft: R = null;
                let topRight: R = null;
                let bottomRight: R = null;


                let left = clipVT(src.data, xmin - padding, cx + padding, "x", src.bbox, $options);
                let right = clipVT(src.data, cx - padding, xmax + padding, "x", src.bbox, $options);

                if (left) {
                    topLeft = clipVT(left.data, cy - padding, ymax + padding, "y", left.bbox, $options);
                    bottomLeft = clipVT(left.data, ymin - padding, cy + padding, "y", left.bbox, $options);
                    left = null;
                }
                if (right) {
                    topRight = clipVT(right.data, cy - padding, ymax + padding, "y", right.bbox, $options);
                    bottomRight = clipVT(right.data, ymin - padding, cy + padding, "y", right.bbox, $options);
                    right = null;
                }

                const childTiles = getTileChildren(tile, $options.tileScheme);
                [topLeft, topRight, bottomLeft, bottomRight]
                    .forEach((item, idx) => {
                        item && stack.push({
                            src: {
                                data: item.data,
                                bbox: item.bbox
                            },
                            tile: childTiles[idx],
                        });
                    });
            }
        }
        const changeTileKeys = Array.from(changes.values());
        changeTileKeys.forEach(key => {
            const tileNode = $tiles.get(key);
            tileNode.version++;
            if (!tileNode.hasDrillDown && tileNode.tile.z > $options.maxZoom) {
                tileNode.sourceBBox = resolveVFeatureBBox(tileNode.source);
            }
        });
        return changeTileKeys;
    }

    function inRangeZ(z: number) {
        return z >= $options.minZoom && z <= $options.maxZoom;
    }

    return {
        options: $options,
        tiles: $tiles,
        getTileData({ z, x, y }: { z: number, x: number, y: number }) {
            const node = getTileNode(z, x, y);
            return node?.simplified?.length
                ? {
                    version: node.version,
                    Q: $options.Q,
                    features: node.simplified,
                    tile: node.tile,
                }
                : null;
        },
        applyEdits,
        destroy() {
            $tiles.clear();
        }
    };
}

function checkSourceId(fs: Feature[]) {
    const set = new Set<string | number>();
    for (let f of fs) {
        assert(!isNil(f.id), `invalid vector tile source feature id:${f.id}`);
        assert(!set.has(f.id), `editable vector tile source features must have diff id, duplicate id:${f.id}`);
        set.add(f.id);
    }
}