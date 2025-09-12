//https://www.redblobgames.com/grids/hexagons/

//Offset coordinates
type Q = number;
type R = number;
type X = number;
type Y = number;
type AxialCoord = [Q, R];
type Cartesian = [X, Y];

const sqrt3 = 3 ** 0.5;
const sqrt3_invert = 1 / sqrt3;

export function pointy_axial_to_pixel(hex: AxialCoord, size: number) {
    // hex to cartesian
    const x = (sqrt3 * hex[0] + sqrt3 / 2 * hex[1]);
    const y = (3 / 2 * hex[1]);
    // scale cartesian coordinates
    return [x * size, y * size] as Cartesian
}


export function pixel_to_pointy_axial(point: Cartesian, size: number) {
    let x = point[0] / size;
    let y = point[1] / size;

    // Convert to their coordinate system
    x *= sqrt3_invert
    y *= -sqrt3_invert
    // Algorithm from Charles Chambers
    // with modifications and comments by Chris Cox 2023
    // <https://gitlab.com/chriscox/hex-coordinates>
    const t = sqrt3 * y + 1         // scaled y, plus phase
    const temp1 = Math.floor(t + x)      // (y+x) diagonal, this calc needs floor
    const temp2 = (t - x)           // (y-x) diagonal, no floor needed
    const temp3 = (2 * x + 1)       // scaled horizontal, no floor needed, needs +1 to get correct phase
    const qf = (temp1 + temp3) / 3.0  // pseudo x with fraction
    const rf = (temp1 + temp2) / 3.0  // pseudo y with fraction
    const q = Math.floor(qf)               // pseudo x, quantized and thus requires floor
    const r = Math.floor(rf)               // pseudo y, quantized and thus requires floor
    return [q, -r] as AxialCoord
}
