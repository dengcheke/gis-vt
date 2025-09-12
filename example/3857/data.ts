import type { Feature } from "geojson";
import type { Coord } from "../../src/interface";

const R = 20037508.3427892;
function transform(p: Coord) { return [p[0] * R, p[1] * R] }
export const data_wrap = [
    {
        type: "Feature",
        properties: {
            outlineColor: 'red',
            outlineWidth: 2,
            fillColor: 'rgba(0,0,0,0.2)'
        },
        geometry: {
            type: "Polygon",
            coordinates: [
                [
                    [1.5, 0],
                    [0.5, 0.5],
                    [0.5, -0.5],
                    [1.5, 0]
                ].map(transform)
            ]
        },
    },
    {
        type: 'Feature',
        properties: {
            lineColor: 'darkgreen',
            width: 4,
        },
        geometry: {
            type: 'LineString',
            coordinates: [
                [0.1, -0.8],
                [0.2, -0.6],
                [1.2, 0.3]
            ].map(transform)
        }
    }
] as Feature[]