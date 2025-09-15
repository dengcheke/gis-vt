

import type { BBox } from "geojson";
import type { Integer, Path, VFeature } from "./interface";


//大于等于某个数的最小的2的幂
export function ceilPowerOfTwo(val: number) {
    if (val & (val - 1)) {
        val |= val >> 1;
        val |= val >> 2;
        val |= val >> 4;
        val |= val >> 8;
        val |= val >> 16;
        return val + 1;
    } else {
        return val === 0 ? 1 : val;
    }
}

export function lerp(a: number, b: number, t: number) {
    return (b - a) * t + a;
}

//Bresenham https://en.wikipedia.org/wiki/Bresenham%27s_line_algorithm#cite_note-Zingl-3
export function Bresenham_calcLinePixels(x0: Integer, y0: Integer, x1: Integer, y1: Integer) {
    const dx = Math.abs(x1 - x0);
    const sx = x0 < x1 ? 1 : -1;
    const dy = -Math.abs(y1 - y0);
    const sy = y0 < y1 ? 1 : -1;
    let error = dx + dy;
    const result = [] as number[][];
    while (true) {
        result.push([x0, y0]);
        const e2 = 2 * error;
        if (e2 >= dy) {
            if (x0 == x1) break
            error = error + dy
            x0 = x0 + sx
        }
        if (e2 <= dx) {
            if (y0 == y1) break;
            error = error + dx
            y0 = y0 + sy
        }
    }
    return result;
}
export function resolveVFeaturesBBox(vfs: VFeature[]) {
    let xmin = Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
    vfs.forEach((vf) => {
        switch (vf.type) {
            case "point":
                xmin = Math.min(xmin, vf.coordinates[0]);
                ymin = Math.min(ymin, vf.coordinates[1]);
                xmax = Math.max(xmax, vf.coordinates[0]);
                ymax = Math.max(ymax, vf.coordinates[1]);
                break;
            case "polyline":
            case "polygon":
                xmin = Math.min(xmin, vf.bbox[0]);
                ymin = Math.min(ymin, vf.bbox[1]);
                xmax = Math.max(xmax, vf.bbox[2]);
                ymax = Math.max(ymax, vf.bbox[3]);
        }
    });
    return [xmin, ymin, xmax, ymax] as BBox;
}
