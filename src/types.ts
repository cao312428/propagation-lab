/**
 * 全局类型定义
 * 重要约定：所有矩形坐标一律使用「原图坐标系」，
 * 即 x / y 是相对原图左上角的像素位置，与界面缩放无关。
 */

/** 重要信息区域的标签类型 */
export type LabelType = '标题' | '日期' | '地点' | '二维码' | '其他';

/** 矩形（原图坐标，x / y 为左上角） */
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 一条标注记录：矩形 + 标签 + 唯一 ID，坐标永远基于原图 */
export interface Annotation extends Rect {
  id: string;
  label: LabelType;
}

/** 几何可见率判定结果 */
export type VisibilityLevel = '完整' | '部分可见' | '严重缺失';

/** 裁剪比例选项（均为居中裁剪；多场景阶段新增 4:5 与 16:9） */
export type CropRatio = '1:1' | '4:5' | '9:16' | '16:9';
