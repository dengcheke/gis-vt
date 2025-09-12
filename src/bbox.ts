import type { BBox } from "geojson";
import type { Coord, VFeature } from "./interface";

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

export function resolveVFeatureBBox(vfs: VFeature[]) {
    let xmin = Infinity,
        xmax = -Infinity,
        ymin = Infinity,
        ymax = -Infinity;
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