/**
 * 基础几何运算：矩形面积、交集、归一化、范围限制。
 * 全部为纯函数，不依赖界面，便于单元测试。
 */
import type { Rect } from '../types';

/** 矩形面积 */
export function rectArea(r: Rect): number {
  return r.w * r.h;
}

/**
 * 计算两个矩形的交集。
 * 两矩形恰好相切（公共边或公共顶点）视为无交集，返回 null。
 */
export function intersectRect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const w = x2 - x;
  const h = y2 - y;
  if (w <= 0 || h <= 0) return null;
  return { x, y, w, h };
}

/**
 * 把「起点 + 终点」归一化为标准矩形（左上角坐标 + 正宽高）。
 * 鼠标反向拖动（从右下往左上）时宽高为负，需要归一化。
 */
export function normalizeRect(x1: number, y1: number, x2: number, y2: number): Rect {
  return {
    x: Math.min(x1, x2),
    y: Math.min(y1, y2),
    w: Math.abs(x2 - x1),
    h: Math.abs(y2 - y1),
  };
}

/** 把矩形限制在图片范围内（原图坐标，越界部分被裁掉） */
export function clampRectToImage(r: Rect, imageW: number, imageH: number): Rect {
  const x = Math.max(0, Math.min(r.x, imageW));
  const y = Math.max(0, Math.min(r.y, imageH));
  const w = Math.max(0, Math.min(r.w, imageW - x));
  const h = Math.max(0, Math.min(r.h, imageH - y));
  return { x, y, w, h };
}
