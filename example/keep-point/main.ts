import { clamp, groupBy, isNil } from "es-toolkit";
import type { BBox } from "geojson";
import { vec2 } from 'gl-matrix';
import GUI from "lil-gui";
import { createBufferFromTypedArray, createProgram } from 'twgl.js';
import { createVectorTile, getTileChildrenXYZ, getTileKey, type Tile, type TileScheme } from "../../src";
import { bboxDetail } from "../../src/bbox";
import type { Coord, InputFeature, VectorTileOptions, VPolygon, VPolyline } from "../../src/interface";
import { colorToRGBA, mergePolygonTessellation, shiftCoords, tessellatePolygon } from "../utils";
import './style.scss';
let request = false;
let curTileXYZ = { z: 0, x: 0, y: 0 };
const div = document.body.querySelector('#curTile') as HTMLDivElement;
div.innerHTML = getTileKey(curTileXYZ);
const canvas = document.body.querySelector('#gl') as HTMLCanvasElement;
const gl = canvas.getContext('webgl2');
const canvas2 = document.body.querySelector('#d2') as HTMLCanvasElement;
const ctx = canvas2.getContext('2d', { alpha: true });
canvas.width = canvas.height = canvas2.width = canvas2.height = 512 * 1.5;

canvas2.addEventListener('click', e => {
    if (curTileXYZ.z === tileScheme.maxZoom) return;
    const ox = e.offsetX >= canvas2.width / 2 ? 1 : 0;
    const oy = e.offsetY >= canvas2.height / 2 ? 1 : 0;
    curTileXYZ = {
        z: curTileXYZ.z + 1,
        x: curTileXYZ.x * 2 + ox,
        y: curTileXYZ.y * 2 + oy
    };
    div.innerHTML = getTileKey(curTileXYZ);
    requestRender();
});
document.addEventListener('keyup', e => {
    if (e.key !== 'Escape') return;
    const { z, x, y } = curTileXYZ;
    if (z === 0) return;
    curTileXYZ = { z: z - 1, x: x >> 1, y: y >> 1 };
    div.innerHTML = getTileKey(curTileXYZ);
    requestRender();
});

const pixelPerMeter = 96 / 0.0254;
const worldBBox = [-200, -200, 200, 200] as BBox;
const worldExtent = bboxDetail(worldBBox);
const tileScheme = (() => {
    const maxZoom = 3;
    const tileSize = 256;
    return {
        origin: [worldBBox[0], worldBBox[3]],
        minZoom: 0,
        maxZoom,
        tileSize: [tileSize, tileSize],
        lods: new Array(maxZoom + 1).fill(0).map((_, idx) => {
            const r = worldExtent.width / tileSize / 2 ** idx;
            return {
                z: idx,
                resolution: r,
                scale: pixelPerMeter * r
            }
        }),
        worldBBox,
        wrapX: false,
        wrapY: false,
        dpi: 96
    } as TileScheme;
})();

const glCache = new Map<string, {
    tile: Tile,
    polyline: ReturnType<typeof buildLine>,
    polygon: ReturnType<typeof buildPolygon>
}>();

const fs = (() => {
    let ring = new Array(200).fill(0).map((_, i) => {
        const rad = Math.PI * 2 / 30 * i;
        const x = i;
        const y = Math.sin(rad) * 20;
        return [x, y];
    })
    ring = shiftCoords(ring, [-100, 120]);
    return [
        {
            id: 1,
            type: "Feature",
            properties: {
                lineWidth: [
                    [4, 16, 4],
                    [12, 2, 12]
                ],
                colors: [
                    [undefined, 'red', undefined],
                    ['darkgreen', undefined, 'cyan']
                ]
            },
            geometry: {
                type: "MultiLineString",
                coordinates: [
                    [[0, 0], [20, 30], [100, 0]],
                    [[130, 20], [180, -80], [60, -120]]
                ].map(path => shiftCoords(path, [-80, 10]))
            }
        },
        {
            id: 2,
            type: "Feature",
            properties: {
                colors: new Array(ring.length).fill(0).map((_, idx) => `rgb(${idx / ring.length * 255 >> 0}, 0,0)`),
                multiLineDistanceStrategy: 'cumulative',
                multiLineDistanceLink: false
            },
            geometry: {
                type: "LineString",
                coordinates: ring
            }
        },
        {
            id: 3,
            type: "Feature",
            properties: {
                colors: [
                    [
                        ['red', 'green', 'blue', 'yellow'],
                        ['red', 'yellow', 'green']
                    ],
                    [
                        ['purple', 'cyan', 'darkgreen']
                    ]
                ]
            },
            geometry: {
                type: "MultiPolygon",
                coordinates: [
                    [
                        [[25, 25], [75, 25], [75, 75], [25, 75], [25, 25]],
                        [[40, 40], [60, 40], [40, 60], [40, 40]].reverse()
                    ].map(i => shiftCoords(i, [-100, 20])),
                    [
                        shiftCoords([[-10, 20], [10, -50], [60, 10], [-10, 20]], [0, -40])
                    ]
                ]
            }
        },
        {
            id: 4,
            type: 'Feature',
            properties: {
                colors: [
                    ['red', 'orange', 'yellow', 'green', 'blue', 'cyan', 'purple', 'skyblue', 'darkgreen']
                ]
            },
            geometry: {
                type: "Polygon",
                coordinates: [
                    [
                        [0, -50],
                        [11.2, -15.5],
                        [47.6, -15.5],
                        [18.2, 5.9],
                        [29.4, 40.5],
                        [0, 19.1],
                        [-29.4, 40.5],
                        [-18.2, 5.9],
                        [-47.6, -15.5],
                        [-11.2, -15.5]
                    ]
                ].map(i => shiftCoords(i, [-60, -30]))
            }
        }
    ] as InputFeature[];
})();

const uboScheme = `
    uniform CommonUniform {
        uniform vec2 u_screenSize;
        uniform float u_lineWidth;
        uniform float u_q;
        uniform float u_time;
        uniform float u_lineFlowSpeed;
        uniform bool u_flow;
    };
`;
const ubo = gl.createBuffer();
gl.bindBuffer(gl.UNIFORM_BUFFER, ubo);
gl.bufferData(gl.UNIFORM_BUFFER, 4 * 2 * Float32Array.BYTES_PER_ELEMENT, gl.DYNAMIC_DRAW);

const lineProgram = initLineProgram(gl);
const polygonProgram = initPolygonProgram(gl);
const options = {
    tileScheme,
    keepLinePoint: true,
    keepLinePointIndex: true,
    keepPolygonPoint: true,
    keepPolygonPointIndex: true,
    calcLineDistance: true,
    debug: true,
    multiLineDistanceStrategy: 'cumulative',
    multiLineDistanceLink: false,
    tolerance: 1,
    Q: 4096
} as VectorTileOptions;
let vt = createVectorTile({ ...options, source: fs });

console.group();
console.log('fs:');
console.log(fs);
console.log('tileScheme:');
console.log(tileScheme);
console.log('vt:');
console.log(vt);
console.groupEnd();

//
const gui = new GUI();
const params = {
    flow: true,
    lineWidth: 8,
    flowSpeed: 20,
    distanceStrategy: options.multiLineDistanceStrategy,
    distanceLink: options.multiLineDistanceLink,
};
gui.add(params, 'distanceLink').onChange(() => rebuildVT());
gui.add(params, 'distanceStrategy', ['cumulative', 'stand-alone']).onChange(() => rebuildVT());
function rebuildVT() {
    vt = createVectorTile({
        ...options,
        source: fs,
        multiLineDistanceStrategy: params.distanceStrategy,
        multiLineDistanceLink: params.distanceLink
    });
    glCache.values().forEach(i => {
        i.polygon?.destroy();
        i.polyline?.destroy();
    });
    glCache.clear();
    requestRender();
}
gui.add(params, 'flow').onChange(() => requestRender());
gui.add(params, 'lineWidth', 1, 20, 1).onChange(() => requestRender());
gui.add(params, 'flowSpeed', 0.1, 100, 0.1).onChange(() => requestRender());

requestRender();

function draw() {
    //GL
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0.1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    //set uniforms
    gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, ubo);
    gl.bindBuffer(gl.UNIFORM_BUFFER, ubo);
    gl.bufferSubData(gl.UNIFORM_BUFFER, 0, new Float32Array([
        canvas.width, canvas.height, params.lineWidth, vt.options.Q,
        performance.now() / 1000, params.flowSpeed, params.flow ? 1 : 0, NaN,
    ]));

    const { polyline, polygon, tile = curTileXYZ } = buildTileGL() || {};
    if (polygon) {
        gl.useProgram(polygonProgram);
        gl.bindVertexArray(polygon.vao);
        gl.drawElements(polygon.drawMode, polygon.drawCount, polygon.drawType, 0);
    }

    if (polyline) {
        gl.useProgram(lineProgram);
        gl.bindVertexArray(polyline.vao);
        gl.drawElements(polyline.drawMode, polyline.drawCount, polyline.drawType, 0);
    }

    gl.bindVertexArray(null);

    //2D
    ctx.clearRect(0, 0, canvas2.width, canvas2.height);
    ctx.strokeStyle = 'orange';
    ctx.beginPath();
    ctx.moveTo(canvas.width / 2, 0);
    ctx.lineTo(canvas.width / 2, canvas.height);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, canvas.height / 2);
    ctx.lineTo(canvas.width, canvas.height / 2);
    ctx.stroke();
    if (tile.z < tileScheme.maxZoom) {
        ctx.font = '16px system-ui';
        ctx.fillStyle = 'black';
        getTileChildrenXYZ(tile).forEach(xyz => {
            const x = xyz.x % 2 === 0 ? 0 : canvas.width / 2;
            const y = xyz.y % 2 === 0 ? 0 : canvas.height / 2;
            ctx.fillText(getTileKey(xyz), x, y + 20);
        })
    }
}

function buildTileGL() {
    const data = vt.getTileData(curTileXYZ);
    const key = getTileKey(curTileXYZ);

    if (!glCache.has(key)) {

        if (!data) {
            glCache.set(key, null);
        } else {
            const { tile, features } = data;
            const { polyline, polygon } = groupBy(features, i => i.type);
            glCache.set(key, {
                tile,
                polyline: polyline?.length ? buildLine(polyline as VPolyline[]) : null,
                polygon: polygon?.length ? buildPolygon(polygon as VPolygon[]) : null,
            });
        }
        console.log('build gl:', key);
    }
    return glCache.get(key);
}

function buildLine(lines: VPolyline[]) {
    let vcursor = 0;
    const posBuf = [] as number[];
    const offsetBuf = [] as number[];
    const colorBuf = [] as number[];
    const disBuf = [] as number[];
    const widthBuf = [] as number[];
    const indices = [] as number[];
    for (let line of lines) {
        const { properties, coordinates, vertexIndex, distances, totalDistance, multiLineStringIndex } = line;
        for (let i = 0; i < coordinates.length; i++) {
            const pa = i === 0 ? centrosymmetry(coordinates[i + 1], coordinates[i]) : coordinates[i - 1];
            const pb = coordinates[i];
            const pc = i === coordinates.length - 1 ? centrosymmetry(coordinates[i - 1], coordinates[i]) : coordinates[i + 1];
            let vab = vec2.fromValues(pb[0] - pa[0], pb[1] - pa[1]);
            vec2.normalize(vab, vab);
            let vbc = vec2.fromValues(pc[0] - pb[0], pc[1] - pb[1]);
            vec2.normalize(vbc, vbc);
            const t = vec2.add([], vab, vbc);
            vec2.normalize(t, t);
            const offset = vec2.fromValues(-t[1], t[0]);
            const miterLength = clamp(1.0 / clamp(vec2.dot(t, vbc), -1.0, 1.0), 10);
            vec2.scale(offset, offset, miterLength);

            const index = vertexIndex?.[i];
            const width = (
                isNil(multiLineStringIndex)
                    ? properties.lineWidth?.[index]
                    : properties.lineWidth?.[multiLineStringIndex]?.[index]
            ) || 0;
            const colorStr = (
                isNil(multiLineStringIndex)
                    ? properties.colors?.[index]
                    : properties.colors?.[multiLineStringIndex]?.[index]
            ) || 'black';

            const [r, g, b, a] = colorToRGBA(colorStr);

            posBuf.push(...pb);
            offsetBuf.push(offset[0], offset[1]);
            disBuf.push(distances[i], totalDistance);
            colorBuf.push(r, g, b);
            widthBuf.push(width);

            posBuf.push(...pb);
            offsetBuf.push(-offset[0], -offset[1]);
            disBuf.push(distances[i], totalDistance);
            colorBuf.push(r, g, b);
            widthBuf.push(width);

            if (i > 0) {
                indices.push(
                    vcursor - 2, vcursor - 1, vcursor,
                    vcursor, vcursor - 1, vcursor + 1
                );
            }
            vcursor += 2;
        }
    }
    const posBuffer = createBufferFromTypedArray(gl, new Float32Array(posBuf), gl.ARRAY_BUFFER, gl.STATIC_DRAW);
    const offsetBuffer = createBufferFromTypedArray(gl, new Float32Array(offsetBuf), gl.ARRAY_BUFFER, gl.STATIC_DRAW);
    const colorBuffer = createBufferFromTypedArray(gl, new Uint8Array(colorBuf), gl.ARRAY_BUFFER, gl.STATIC_DRAW);
    const disBuffer = createBufferFromTypedArray(gl, new Float32Array(disBuf), gl.ARRAY_BUFFER, gl.STATIC_DRAW);
    const widthBuffer = createBufferFromTypedArray(gl, new Float32Array(widthBuf), gl.ARRAY_BUFFER, gl.STATIC_DRAW);
    const indexBuffer = createBufferFromTypedArray(gl, new Uint32Array(indices), gl.ELEMENT_ARRAY_BUFFER, gl.STATIC_DRAW);

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    //
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    //
    gl.bindBuffer(gl.ARRAY_BUFFER, offsetBuffer);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
    //
    gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 3, gl.UNSIGNED_BYTE, true, 0, 0);
    //
    gl.bindBuffer(gl.ARRAY_BUFFER, disBuffer);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 2, gl.FLOAT, false, 0, 0);
    //
    gl.bindBuffer(gl.ARRAY_BUFFER, widthBuffer);
    gl.enableVertexAttribArray(4);
    gl.vertexAttribPointer(4, 1, gl.FLOAT, false, 0, 0);
    //
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bindVertexArray(null);

    return {
        vao,
        drawMode: gl.TRIANGLES,
        drawCount: indices.length,
        drawType: gl.UNSIGNED_INT,
        destroy() {
            gl.deleteBuffer(posBuffer);
            gl.deleteBuffer(offsetBuffer);
            gl.deleteBuffer(colorBuffer);
            gl.deleteBuffer(indexBuffer);
            gl.deleteVertexArray(vao);
        }
    }
    function centrosymmetry(p: Coord, center: Coord) {
        return [
            2 * center[0] - p[0],
            2 * center[1] - p[1]
        ]
    }
}
function buildPolygon(polygons: VPolygon[]) {
    const meshes = polygons.map(polygon => tessellatePolygon(polygon.coordinates));
    const { vertices, indices } = mergePolygonTessellation(meshes, Float32Array, Uint32Array);
    const colors = [] as number[];
    for (let { coordinates: rings, properties, vertexIndex, multiPolygonIndex } of polygons) {
        for (let i = 0; i < rings.length; i++) {
            const ring = rings[i];
            for (let j = 0; j < ring.length; j++) {
                let colorStr: string;
                if (vertexIndex) {
                    let [ringIndex, pointIndex] = vertexIndex[i][j];
                    if (!isNil(multiPolygonIndex)) {
                        const colorArr = properties.colors?.[multiPolygonIndex]?.[ringIndex];
                        if (colorArr) {
                            colorStr = colorArr[pointIndex % colorArr.length];
                        }
                    } else {
                        const colorArr = properties.colors?.[ringIndex];
                        if (colorArr) {
                            colorStr = colorArr[pointIndex % colorArr.length];
                        }
                    }
                }
                colorStr ??= 'rgba(0, 0, 0, 0.3)';
                const [r, g, b, a] = colorToRGBA(colorStr);
                colors.push(r, g, b);
            }
        }
    }

    const posBuffer = createBufferFromTypedArray(gl, new Float32Array(vertices), gl.ARRAY_BUFFER, gl.STATIC_DRAW);
    const colorBuffer = createBufferFromTypedArray(gl, new Uint8Array(colors), gl.ARRAY_BUFFER, gl.STATIC_DRAW);
    const indexBuffer = createBufferFromTypedArray(gl, new Uint32Array(indices), gl.ELEMENT_ARRAY_BUFFER, gl.STATIC_DRAW);

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    //
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    //
    gl.bindBuffer(gl.ARRAY_BUFFER, colorBuffer);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.UNSIGNED_BYTE, true, 0, 0);
    //
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bindVertexArray(null);

    return {
        vao,
        drawMode: gl.TRIANGLES,
        drawCount: indices.length,
        drawType: gl.UNSIGNED_INT,
        destroy() {
            gl.deleteBuffer(posBuffer);
            gl.deleteBuffer(colorBuffer);
            gl.deleteBuffer(indexBuffer);
            gl.deleteVertexArray(vao);
        }
    }
}
function initLineProgram(gl: WebGL2RenderingContext) {
    const vs = `#version 300 es
        layout(location = 0) in vec2 position;
        layout(location = 1) in vec2 offset;
        layout(location = 2) in vec3 color;
        layout(location = 3) in vec2 distance;
        layout(location = 4) in float width;
        ${uboScheme}

        out vec3 v_color;
        out vec2 v_dis;
        void main(){
            v_dis = distance;
            v_color = color;
            vec2 screenPos = position / vec2(u_q) * u_screenSize;
            float lineWidth = width > 0.0 ? width : u_lineWidth;

            screenPos += offset * lineWidth * 0.5;
            vec2 ndc = screenPos / u_screenSize * vec2(2, -2) + vec2(-1, 1);
            gl_Position = vec4(ndc, 0, 1);
        }
    `;
    const fs = `#version 300 es 
        precision highp float;

        ${uboScheme}

        in vec3 v_color;
        in vec2 v_dis;
        out vec4 outColor;

        float calcFlowLineAlpha(
            float trailLength, // 0~cycle
            float cycle, //0-1
            float normalizeDistance
        ){
            float d = mod(mod(normalizeDistance, cycle) + cycle, cycle);
            bool isTrail = (d >= 0.0 && d <= trailLength);
            return isTrail ? smoothstep(0.0, trailLength, d) : 0.0;
        }

        void main(){
            float offset = u_time * u_lineFlowSpeed;
            float disPer = (v_dis.x - offset) / v_dis.y;
            float alpha = u_flow ? max(calcFlowLineAlpha(0.35, 0.5, disPer), 0.3) : 1.0;
            outColor = vec4(v_color, alpha);
        }
    `;
    const program = createProgram(gl, [vs, fs]);
    gl.uniformBlockBinding(program, gl.getUniformBlockIndex(program, 'CommonUniform'), 0);
    return program;
}
function initPolygonProgram(gl: WebGL2RenderingContext) {
    const vs = `#version 300 es
        layout(location = 0) in vec2 position;
        layout(location = 1) in vec3 color;
       
        ${uboScheme}

        out vec3 v_color;
        void main(){
            v_color = color;
            vec2 ndc = position / vec2(u_q) * vec2(2, -2) + vec2(-1, 1);
            gl_Position = vec4(ndc, 0, 1);
        }
    `;
    const fs = `#version 300 es 
        precision highp float;
        in vec3 v_color;
        out vec4 outColor;
        void main(){
            outColor = vec4(v_color, 1.0);
        }
    `;
    const program = createProgram(gl, [vs, fs]);
    gl.uniformBlockBinding(program, gl.getUniformBlockIndex(program, 'CommonUniform'), 0);
    return program;
}
function requestRender() {
    if (request) return;
    request = true;
    requestAnimationFrame(function loop() {
        request = false;
        draw();
        params.flow && requestAnimationFrame(loop);
    })
}