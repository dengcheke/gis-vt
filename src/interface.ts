import type { BBox, Feature, LineString, MultiLineString, MultiPoint, MultiPolygon, Point, Polygon } from "geojson";
import type { Tile } from "./tile";
import type { TileScheme } from "./tile-scheme";

export type Coord = number[];
export type Path = Coord[];
export type Rings = Path[];

export type Integer = number;

export type MaybeArray<T> = T | T[];

type Geo = Point | MultiPoint | LineString | MultiLineString | Polygon | MultiPolygon;
export type InputFeature<G extends Geo | null = Geo> = Feature<G, {
    multiLineDistanceStrategy?: 'stand-alone' | 'cumulative',
    multiLineDistanceLink?: boolean
    [p: string]: any
}>;

export type CustomSimplify = (raws: VFeature[], tile: Tile, option: VTOption, isEdit: boolean) => VFeature[];

//vector-tile选项
export interface VectorTileOptions {
    source: InputFeature[]; // 输入要素
    tileScheme: TileScheme; // 切片方案

    Q?: number;       // 坐标量化值(正整数), 如果传了,则vt.getTileData().features 坐标为量化后的坐标
    static?: boolean; // 是否是静态数据，静态则不可编辑(vt.applyEdits不可用）， 动态则每个InputFeature必须指定唯一id

    minZoom?: number, // 限制数据的zoom范围
    maxZoom?: number, // 限制数据的zoom范围
    indexMaxZoom?: number; // 初始化时生成的最大瓦片zoom
    indexMaxPoints?: number; // 初始化时生成的最大瓦片点数, 超过此值会继续向下分裂
    tolerance?: number; // 简化容差(像素), 小于此阈值的点会被剔除简化, 默认1
    buffer?: number;    // tile每个边向外扩张的范围(百分比值0-1), 默认4/256
    simplifyAtMaxZoom?: boolean;  //是否在最大等级简化， 默认false

    /***polygon***/
    keepPolygonPoint?: boolean; // 是否保留面的原始点
    keepPolygonPointIndex?: boolean; // 是否保留面原始点的索引，keepPolygonPoint必须是true

    /***line***/
    keepLinePoint?: boolean;      // 是否保留线的原始点
    keepLinePointIndex?: boolean; // 是否保持线的原始点索引(用于获取逐顶点属性， 例如颜色), keepLinePoint必须是true
    calcLineDistance?: boolean;   // 是否计算线上每个点的距离(多用于流动线渲染)，默认false

    // multiLineString中每条线距离计算方式
    // stand-alone: 每条线就像LineString一样单独计算, 每条线的起点的距离为0
    // cumulative: 线条距离累加, 每条线的起点的距离为上一条线的结尾距离
    // 可在Feature.properties 中 单独设置
    multiLineDistanceStrategy?: 'stand-alone' | 'cumulative';

    // cumulative模式下, 上一个线的终点和下一个线的起点之间的距离是否计算在内, 默认false
    // 可在Feature.properties 中 单独设置
    multiLineDistanceLink?: boolean;

    customSimplify?: CustomSimplify;//自定义简化函数
    debug?: boolean;
}

export type VTOption = Required<Omit<VectorTileOptions, 'source'>>;

interface VBase<T = any> {
    id: number | string;
    properties: T;
}

export interface VPoint extends VBase {
    type: 'point';
    multiPointIndex: number; //如果数据源是 Multipoint，则表明是第几个点
    coordinates: Coord;
}

export interface VPolyline extends VBase {
    type: 'polyline';
    multiLineStringIndex: number; // 如果数据源是MultiLineString, 则表明是第几条线
    coordinates: Path;
    bbox: BBox;
    vertexIndex: number[]; //每个点在当前线中是第几个点
    distances: number[];  //顶点距离
    totalDistance: number; //线总长
}

export interface VPolygon extends VBase {
    type: 'polygon';
    multiPolygonIndex: number; // 如果数据源是MultiPolygon, 则表明是第几个面
    coordinates: Rings;
    bbox: BBox;
    vertexIndex: [
        number, // ringIndex  在当前Rings中是第几个ring
        number // vertexIndex 在对应ring中是第几个点
    ][][]; //每个点对应的索引
}

export type VFeature = VPoint | VPolygon | VPolyline;

export interface VTNode {
    version: number, //版本, 修改后会增加
    key: string; //tileKey,
    tile: Tile; //对应的tile
    ///raw(原始坐标)
    source: VFeature[]; //未简化的几何
    sourceBBox: BBox;
    sourcePointNums: number; //未简化总点数(估计值)

    ///simplified (若Q存在, 则为量化坐标)
    simplified: VFeature[]; //简化后输出要素
    simplifiedPointNums: number; //简化后总点数(估计值)

    hasDrillDown: boolean;//是否已向下迭代到子瓦片
}

