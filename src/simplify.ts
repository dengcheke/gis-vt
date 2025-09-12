import type { Coord, Path } from "./interface";

export function douglasSimplify(points: Path, epsilonSquare: number) {
    const len = points.length;
    if (epsilonSquare === 0 || len <= 2) return points.map(() => true);
    const flags = new Array(len).fill(false) as boolean[];
    const first = points[0];
    const last = points[len - 1];
    //是否是闭合线
    const isClose = first[0] === last[0] && first[1] === last[1];
    if (isClose) {
        flags[len - 1] = true;
    }
    const stack = [
        [0, isClose ? len - 2 : len - 1]
    ] as [number/*start*/, number/*end*/][];
    while (stack.length) {
        let dmax = 0;
        let index: number;
        const [start, end] = stack.pop();
        const ps = points[start], pe = points[end];
        for (let i = start + 1; i < end; i++) {
            const point = points[i];
            const d = perpendicularDistanceSq(point, ps, pe);
            if (d >= dmax) {
                dmax = d;
                index = i;
            }
        }
        if (dmax >= epsilonSquare) {
            stack.push(
                [start, index],
                [index, end]
            );
        } else {
            //保留首尾2点
            flags[start] = true;
            flags[end] = true;
        }
    }
    //方便对应点的其他额外属性可以一起被处理
    return flags;
}

// 点到线段的距离平方
export function perpendicularDistanceSq(p: Coord, a: Coord, b: Coord) {
    const [px, py] = p;
    const [ax, ay] = a;
    const [bx, by] = b;

    const x1 = ax - bx;
    const y1 = ay - by;
    const dir_ab_sq = x1 ** 2 + y1 ** 2;
    if (dir_ab_sq === 0) return (px - ax) ** 2 + (py - ay) ** 2;
    const x2 = px - ax;
    const y2 = py - ay;
    const area_sq = (x1 * y2 - x2 * y1) ** 2;
    return area_sq / dir_ab_sq;
}
