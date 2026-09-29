/**
 * 通用界面遮挡模拟（1:1 与 9:16 两种裁剪模式共用）。
 *
 * 遮挡区域按「当前裁剪画面」的比例定义（顶部 10%、底部 18%、右侧 12%、高度 25%～75%），
 * 为用于压力测试的简化参数，不对应任何真实平台官方尺寸；
 * 统一换算到原图坐标系存储，保证可见率计算与预览绘制使用完全一致的位置。
 * 全部为纯函数，便于单元测试。
 */
import type { Rect, VisibilityLevel } from '../types';
import { intersectRect, rectArea } from './geometry';
import { classifyVisibility, computeVisibleRatio } from './crop';

/** 遮挡区域规格（相对裁剪结果画面的比例） */
export interface OccluderSpec {
  name: string;
  xRatio: number; // 相对裁剪画面宽
  yRatio: number; // 相对裁剪画面高
  wRatio: number;
  hRatio: number;
}

/** 三块通用界面遮挡：顶部 10% 高、底部 18% 高、右侧 12% 宽（高度 25%~75%） */
export const OCCLUDER_SPECS: OccluderSpec[] = [
  { name: '顶部遮挡', xRatio: 0, yRatio: 0, wRatio: 1, hRatio: 0.1 },
  { name: '底部遮挡', xRatio: 0, yRatio: 0.82, wRatio: 1, hRatio: 0.18 },
  { name: '右侧遮挡', xRatio: 0.88, yRatio: 0.25, wRatio: 0.12, hRatio: 0.5 },
];

/**
 * 生成三块遮挡矩形（原图坐标系）。
 * 预览绘制与可见率计算共用本函数，确保位置一致。
 */
export function computeOccluders(cropRect: Rect): Rect[] {
  return OCCLUDER_SPECS.map((spec) => ({
    x: cropRect.x + spec.xRatio * cropRect.w,
    y: cropRect.y + spec.yRatio * cropRect.h,
    w: spec.wRatio * cropRect.w,
    h: spec.hRatio * cropRect.h,
  }));
}

/**
 * 矩形减法：从 target 中挖去 hole，返回剩余部分（0～4 个矩形）。
 */
export function subtractRect(target: Rect, hole: Rect): Rect[] {
  const inter = intersectRect(target, hole);
  if (!inter) return [target];
  const result: Rect[] = [];
  const push = (x: number, y: number, w: number, h: number) => {
    if (w > 0 && h > 0) result.push({ x, y, w, h });
  };
  push(target.x, target.y, target.w, inter.y - target.y); // 上
  push(target.x, inter.y + inter.h, target.w, target.y + target.h - inter.y - inter.h); // 下
  push(target.x, inter.y, inter.x - target.x, inter.h); // 左
  push(inter.x + inter.w, inter.y, target.x + target.w - inter.x - inter.w, inter.h); // 右
  return result;
}

/**
 * 从保留区域中逐块扣除所有遮挡，返回剩余可见矩形列表。
 * 遮挡之间重叠的部分只扣一次；遮挡超出保留区（即已被裁掉）的部分不会额外扣除。
 */
export function visiblePartsAfterOcclusion(kept: Rect, occluders: Rect[]): Rect[] {
  let remaining: Rect[] = [kept];
  for (const occ of occluders) {
    const next: Rect[] = [];
    for (const r of remaining) next.push(...subtractRect(r, occ));
    remaining = next;
    if (remaining.length === 0) break;
  }
  return remaining;
}

/** 计算保留区域扣除所有遮挡后的可见面积 */
export function computeOccludedArea(kept: Rect, occluders: Rect[]): number {
  return visiblePartsAfterOcclusion(kept, occluders).reduce((sum, r) => sum + rectArea(r), 0);
}

/** 遮挡分析的完整结果 */
export interface OcclusionAnalysis {
  /** 裁剪保留率 = 裁剪后保留面积 / 原始标注面积（与无遮挡模式的指标一致） */
  cropKeptRatio: number;
  /** 最终可见率 = 再扣除界面遮挡后的可见面积 / 原始标注面积 */
  finalVisibleRatio: number;
  /** 基于最终可见率的检测结果 */
  finalLevel: VisibilityLevel;
}

/**
 * 计算标注在「裁剪 + 界面遮挡」下的完整可见性。
 * 先求裁剪保留区，再从中扣除遮挡：
 * 已裁掉的部分不参与扣除，遮挡重叠的部分只扣一次。
 */
export function analyzeWithOcclusion(
  annotation: Rect,
  cropRect: Rect,
  occluders: Rect[],
): OcclusionAnalysis {
  const cropKeptRatio = computeVisibleRatio(annotation, cropRect);
  const kept = intersectRect(annotation, cropRect);
  const visibleArea = kept ? computeOccludedArea(kept, occluders) : 0;
  const annotationArea = rectArea(annotation);
  const finalVisibleRatio = annotationArea > 0 ? visibleArea / annotationArea : 0;
  return {
    cropKeptRatio,
    finalVisibleRatio,
    finalLevel: classifyVisibility(finalVisibleRatio),
  };
}
