/**
 * 裁剪与可见率核心算法。
 * - 1:1 居中裁剪区域计算
 * - 标注区域被裁剪后的几何可见率（面积比例）
 * - 可见率分级（完整 / 部分可见 / 严重缺失）
 * 全部为纯函数，不依赖界面，便于单元测试。
 */
import type { Rect, VisibilityLevel } from '../types';
import { intersectRect, rectArea } from './geometry';

/** 可见率阈值：≥85% 判为完整 */
export const VISIBLE_FULL_THRESHOLD = 0.85;
/** 可见率阈值：50%～85% 判为部分可见 */
export const VISIBLE_PARTIAL_THRESHOLD = 0.5;

/**
 * 计算以原图中心为基准的居中裁剪区域（原图坐标）。
 * aspectW / aspectH 为裁剪宽高比，默认 1:1（正方形，边长取短边）。
 * 算法：取原图内最大的该比例矩形，不拉伸图片。
 * 例：9:16 时，裁剪宽 = min(原图宽, 原图高 × 9/16)，裁剪高 = 裁剪宽 × 16/9。
 */
export function computeCenterCrop(
  imageW: number,
  imageH: number,
  aspectW = 1,
  aspectH = 1,
): Rect {
  const w = Math.min(imageW, (imageH * aspectW) / aspectH);
  const h = (w * aspectH) / aspectW;
  return {
    x: (imageW - w) / 2,
    y: (imageH - h) / 2,
    w,
    h,
  };
}

/**
 * 计算标注区域被裁剪后保留的几何面积比例，返回值在 0～1 之间。
 * 注意：这只是「几何可见率」，仅反映面积保留比例，
 * 不代表区域内的文字或图形仍能被准确阅读。
 */
export function computeVisibleRatio(annotation: Rect, cropRect: Rect): number {
  const area = rectArea(annotation);
  if (area <= 0) return 0;
  const intersection = intersectRect(annotation, cropRect);
  if (!intersection) return 0;
  return rectArea(intersection) / area;
}

/**
 * 根据几何可见率给出检测结果：
 * ≥85% 完整；50%～85% 部分可见；<50% 严重缺失。
 */
export function classifyVisibility(ratio: number): VisibilityLevel {
  if (ratio >= VISIBLE_FULL_THRESHOLD) return '完整';
  if (ratio >= VISIBLE_PARTIAL_THRESHOLD) return '部分可见';
  return '严重缺失';
}

/** 一次算全：可见率 + 检测结果 */
export function analyzeAnnotation(annotation: Rect, cropRect: Rect) {
  const ratio = computeVisibleRatio(annotation, cropRect);
  return { ratio, level: classifyVisibility(ratio) };
}
