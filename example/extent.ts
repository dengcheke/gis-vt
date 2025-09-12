
import type { Coord, Path } from "../src/interface";

export interface ExtentBase {
    xmin: number;
    ymin: number;
    xmax: number;
    ymax: number;
}

export interface Extent extends ExtentBase {
    width: number;
    height: number;
    cx: number;
    cy: number;
}

function calcSize(extent: Extent) {
    extent.width = extent.xmax - extent.xmin;
    extent.height = extent.ymax - extent.ymin;
    extent.cx = (extent.xmax + extent.xmin) / 2;
    extent.cy = (extent.ymax + extent.ymin) / 2;
    return extent;
}

export function createExtent(extent: ExtentBase) {
    return calcSize({
        xmin: extent.xmin,
        xmax: extent.xmax,
        ymin: extent.ymin,
        ymax: extent.ymax,
    } as Extent);
}

export function createEmptyExtent() {
    return {
        xmin: Infinity,
        xmax: -Infinity,
        ymin: Infinity,
        ymax: -Infinity,
        width: NaN,
        height: NaN,
        cx: NaN,
        cy: NaN
    } as Extent;
}

export function unionPoint(extent: Extent, point: Coord) {
    extent.xmin = Math.min(extent.xmin, point[0]);
    extent.xmax = Math.max(extent.xmax, point[0]);
    extent.ymin = Math.min(extent.ymin, point[1]);
    extent.ymax = Math.max(extent.ymax, point[1]);
    return calcSize(extent);
}

export function unionExtent(extent: Extent, other: Extent) {
    extent.xmin = Math.min(extent.xmin, other.xmin);
    extent.xmax = Math.max(extent.xmax, other.xmax);
    extent.ymin = Math.min(extent.ymin, other.ymin);
    extent.ymax = Math.max(extent.ymax, other.ymax);
    return calcSize(extent);
}

export function extentFromPoints(points: Coord[]) {
    const extent = createEmptyExtent();
    for (let p of points) {
        extent.xmin = Math.min(extent.xmin, p[0]);
        extent.xmax = Math.max(extent.xmax, p[0]);
        extent.ymin = Math.min(extent.ymin, p[1]);
        extent.ymax = Math.max(extent.ymax, p[1]);
    }
    return calcSize(extent);
}

export function extentFromPaths(paths: Path[]) {
    const extent = createEmptyExtent();
    for (let path of paths) {
        for (let point of path) {
            extent.xmin = Math.min(extent.xmin, point[0]);
            extent.xmax = Math.max(extent.xmax, point[0]);
            extent.ymin = Math.min(extent.ymin, point[1]);
            extent.ymax = Math.max(extent.ymax, point[1]);
        }
    }
    return calcSize(extent);
}

export function translateExtent({ xmin, ymin, xmax, ymax }: ExtentBase, offset: number[]) {
    return createExtent({
        xmin: xmin + offset[0],
        ymin: ymin + offset[1],
        xmax: xmax + offset[0],
        ymax: ymax + offset[1]
    });
}
//给定比例扩张当前box, in place
export function expandFactor(extent: Extent, factor: number | number[]) {
    if (factor === 0) return extent;
    const [fx, fy] = typeof factor === "number" ? [factor, factor] : factor;
    const { cx, cy, width, height } = extent;
    const hw = width / 2 * fx;
    const hh = height / 2 * fy;
    return calcSize({
        xmin: cx - hw,
        xmax: cx + hw,
        ymin: cy - hh,
        ymax: cy + hh,
    } as Extent)
}