
import type { BBox } from "geojson";
import { bboxDetail, translateBBox } from "./bbox";
import { resolveVFeaturesBBox } from "./utils";
import { clipVT } from "./clip";
import { type Coord, type VFeature, type VTOption } from "./interface";
export function wrap(fs: VFeature[], option: VTOption): {
    data: VFeature[],
    bbox: BBox,
} {
    const { tileScheme, buffer } = option;
    const { worldBBox, wrapX, wrapY } = tileScheme;
    const bbox = resolveVFeaturesBBox(fs);
    if (!wrapX && !wrapY) return { data: fs, bbox };

    const { xmin, xmax, ymin, ymax, width, height } = bboxDetail(worldBBox);
    const bufferSize = buffer * width;

    if (wrapX) {
        const middle = clipVT(fs, xmin - bufferSize, xmax + bufferSize, 'x', bbox, option);
        const left = clipVT(fs, xmin - width - bufferSize, xmin + bufferSize, 'x', bbox, option);
        const right = clipVT(fs, xmax - bufferSize, xmax + width + bufferSize, 'x', bbox, option);
        fs = [...middle.data];
        if (left) fs.push(...shiftFeatureCoords(left.data, [width, 0]));
        if (right) fs.push(...shiftFeatureCoords(right.data, [-width, 0]));
    }
    if (wrapY) {
        const middle = clipVT(fs, ymin - bufferSize, ymax + bufferSize, 'y', bbox, option);
        const top = clipVT(fs, ymax - bufferSize, ymax + height + bufferSize, 'y', bbox, option);
        const bottom = clipVT(fs, ymin - height - bufferSize, ymin + bufferSize, 'y', bbox, option);
        fs = [...middle.data];
        if (top) fs.push(...shiftFeatureCoords(top.data, [0, -height]));
        if (bottom) fs.push(...shiftFeatureCoords(bottom.data, [0, height]));
    }
    return { data: fs, bbox: resolveVFeaturesBBox(fs) };
}

function shiftFeatureCoords(fs: VFeature[], offset: number[]) {
    fs.forEach(f => {
        switch (f.type) {
            case "point": f.coordinates = shiftCoords(f.coordinates, offset); break;
            case "polyline": {
                f.coordinates = f.coordinates.map(p => shiftCoords(p, offset));
                f.bbox = translateBBox(f.bbox, offset);
                break;
            }
            case "polygon": {
                f.coordinates = f.coordinates.map(path => {
                    return path.map(p => shiftCoords(p, offset));
                });
                f.bbox = translateBBox(f.bbox, offset);
            }
        }
    })
    return fs;
}

function shiftCoords(point: Coord, offset: number[]) {
    return [
        point[0] + offset[0],
        point[1] + offset[1]
    ]
}
