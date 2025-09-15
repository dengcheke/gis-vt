import type { BBox } from "geojson";
import type { Coord } from "./interface";

export function bboxFromPoints(points: Coord[]) {
    let xmin = Infinity,
        xmax = -Infinity,
        ymin = Infinity,
        ymax = -Infinity;
    for (let p of points) {
        xmin = Math.min(xmin, p[0]);
        ymin = Math.min(ymin, p[1]);
        xmax = Math.max(xmax, p[0]);
        ymax = Math.max(ymax, p[1]);
    }
    return [xmin, ymin, xmax, ymax] as BBox;
}

export function translateBBox(bbox: BBox, offset: number[]) {
    return [
        bbox[0] + offset[0],
        bbox[1] + offset[1],
        bbox[2] + offset[0],
        bbox[3] + offset[1]
    ] as BBox;
}

export function xRange(bbox: BBox) {
    return [bbox[0], bbox[2]];
}

export function yRange(bbox: BBox) {
    return [bbox[1], bbox[3]];
}

export function bboxDetail([xmin, ymin, xmax, ymax]: BBox) {
    return {
        xmin, ymin, xmax, ymax,
        width: xmax - xmin,
        height: ymax - ymin,
        cx: (xmax + xmin) / 2,
        cy: (ymax + ymin) / 2,
    }
}