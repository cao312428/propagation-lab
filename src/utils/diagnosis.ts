/**
 * 问题诊断模块：在「裁剪 + 通用界面遮挡」几何计算的基础上，
 * 为每条标注生成问题来源、受损方向、遮挡来源与修改建议。
 *
 * 所有判断只基于已有的几何计算（原图坐标），不涉及任何 AI / OCR 分析。
 * 全部为纯函数，便于单元测试。
 */
import type { Annotation, Rect, VisibilityLevel } from '../types';
import { intersectRect, rectArea } from './geometry';
import { analyzeAnnotation } from './crop';
import { analyzeWithOcclusion, OCCLUDER_SPECS } from './occlusion';

/* ------------------------------------------------------------------
 * 诊断阈值（当前产品规则，不是行业标准）
 * ------------------------------------------------------------------ */

/** 损失低于该值视为「接近零」，即无明显问题（产品规则，非行业标准） */
export const NEAR_ZERO_LOSS = 0.02;

/** 一方损失超过另一方该倍数时，视为「明显占主导」（产品规则，非行业标准） */
export const DOMINANT_LOSS_RATIO = 2;

/** 问题来源分类 */
export type ProblemSource =
  | '无明显问题'
  | '主要受裁剪影响'
  | '主要受界面遮挡影响'
  | '同时受裁剪和界面遮挡影响';

/** 裁剪受损方向（仅几何判断，基于原图坐标） */
export type CropDirection = '左侧受损' | '右侧受损' | '顶部受损' | '底部受损' | '多方向受损';

/** 主要遮挡来源 */
export type OccluderSource = '顶部遮挡' | '底部遮挡' | '右侧遮挡' | '多处界面遮挡';

/** 一条标注的完整诊断结果 */
export interface DiagnosisResult {
  annotation: Annotation;
  /** 裁剪保留率 = 裁剪后保留面积 / 原始标注面积 */
  cropKeptRatio: number;
  /** 最终几何可见率 = 再扣除界面遮挡后的可见面积 / 原始标注面积（未开启遮挡时等于裁剪保留率） */
  finalVisibleRatio: number;
  /** 当前分类：基于最终可见率 */
  level: VisibilityLevel;
  /** 主要问题来源 */
  problemSource: ProblemSource;
  /** 裁剪受损方向（无裁剪损失时为 null） */
  cropDirection: CropDirection | null;
  /** 主要遮挡来源（未开启遮挡或无遮挡相交时为 null） */
  occlusionSource: OccluderSource | null;
  /** 基于几何关系的简短修改建议 */
  suggestion: string;
}

/** 损失分解：cropLoss = 1 - 裁剪保留率；occlusionLoss = 裁剪保留率 - 最终可见率 */
export interface LossBreakdown {
  cropLoss: number;
  occlusionLoss: number;
}

/** 计算两类损失（诊断规则的输入，产品规则：非行业标准） */
export function computeLosses(cropKeptRatio: number, finalVisibleRatio: number): LossBreakdown {
  return {
    cropLoss: 1 - cropKeptRatio,
    occlusionLoss: cropKeptRatio - finalVisibleRatio,
  };
}

/**
 * 按两项损失判断主要问题来源（产品规则，非行业标准）：
 * - 两者都接近零 → 无明显问题；
 * - cropLoss 明显大于 occlusionLoss → 主要受裁剪影响；
 * - occlusionLoss 明显大于 cropLoss → 主要受界面遮挡影响；
 * - 两者都有明显损失且接近 → 同时受裁剪和界面遮挡影响。
 */
export function classifyProblemSource(cropLoss: number, occlusionLoss: number): ProblemSource {
  if (cropLoss <= NEAR_ZERO_LOSS && occlusionLoss <= NEAR_ZERO_LOSS) return '无明显问题';
  if (cropLoss > DOMINANT_LOSS_RATIO * occlusionLoss) return '主要受裁剪影响';
  if (occlusionLoss > DOMINANT_LOSS_RATIO * cropLoss) return '主要受界面遮挡影响';
  return '同时受裁剪和界面遮挡影响';
}

/**
 * 判断裁剪受损方向：用原图坐标计算标注矩形相对裁剪区域的四个方向溢出量，
 * 某方向溢出（被裁掉）则为该方向受损；两个及以上方向受损返回「多方向受损」。
 * 完全不使用屏幕坐标。
 */
export function detectCropDirection(annotation: Rect, cropRect: Rect): CropDirection | null {
  const leftOverflow = cropRect.x - annotation.x;
  const rightOverflow = annotation.x + annotation.w - (cropRect.x + cropRect.w);
  const topOverflow = cropRect.y - annotation.y;
  const bottomOverflow = annotation.y + annotation.h - (cropRect.y + cropRect.h);
  const directions: CropDirection[] = [
    leftOverflow > 0 ? '左侧受损' : null,
    rightOverflow > 0 ? '右侧受损' : null,
    topOverflow > 0 ? '顶部受损' : null,
    bottomOverflow > 0 ? '底部受损' : null,
  ].filter((d): d is CropDirection => d !== null);
  if (directions.length === 0) return null;
  if (directions.length > 1) return '多方向受损';
  return directions[0];
}

/**
 * 判断主要遮挡来源：统计标注与三块界面遮挡的相交情况
 * （遮挡均位于裁剪画面内，故与标注相交即与保留区相交）。
 * 仅开启遮挡（occluders 非 null）时判断；多块相交返回「多处界面遮挡」。
 */
export function detectOccluderSource(
  annotation: Rect,
  occluders: Rect[] | null,
): OccluderSource | null {
  if (!occluders) return null;
  const hits = OCCLUDER_SPECS.map((spec, i) => {
    const inter = intersectRect(annotation, occluders[i]);
    return inter && rectArea(inter) > 0 ? spec.name : null;
  }).filter((n): n is OccluderSource => n !== null);
  if (hits.length === 0) return null;
  if (hits.length >= 2) return '多处界面遮挡';
  return hits[0];
}

/** 裁剪受损方向 → 修改建议（仅几何关系，不评价设计好坏） */
const CROP_DIRECTION_SUGGESTIONS: Record<CropDirection, string> = {
  左侧受损: '建议将该信息向画面中央或右侧移动。',
  右侧受损: '建议将该信息向画面中央或左侧移动。',
  顶部受损: '建议将该信息向画面中央或下方移动。',
  底部受损: '建议将该信息向画面中央或上方移动。',
  多方向受损: '建议缩小信息区域或将其重新布置到画面安全区域。',
};

/** 遮挡来源 → 修改建议（仅几何关系，不评价设计好坏） */
const OCCLUSION_SUGGESTIONS: Record<OccluderSource, string> = {
  顶部遮挡: '建议将该信息下移，避开顶部界面区域。',
  底部遮挡: '建议将该信息上移，避开底部界面区域。',
  右侧遮挡: '建议将该信息向左侧或中央移动。',
  多处界面遮挡: '建议缩小信息区域或将其重新布置到画面安全区域。',
};

/** 无问题的默认建议 */
const NO_ISSUE_SUGGESTION = '当前信息完整可见，无需调整。';

/** 兜底建议（有损失但方向不明时使用，正常情况下不会触发） */
const FALLBACK_SUGGESTION = '建议缩小信息区域或将其重新布置到画面安全区域。';

/**
 * 按问题来源生成建议：
 * - 无明显问题 → 无需调整；
 * - 主要受裁剪影响 → 只给裁剪方向建议；
 * - 主要受界面遮挡影响 → 只给遮挡建议；
 * - 同时受影响 → 两条建议拼接（内容相同时去重）。
 */
export function buildSuggestion(
  problemSource: ProblemSource,
  cropDirection: CropDirection | null,
  occlusionSource: OccluderSource | null,
): string {
  if (problemSource === '无明显问题') return NO_ISSUE_SUGGESTION;
  const parts: string[] = [];
  if (cropDirection && problemSource !== '主要受界面遮挡影响') {
    parts.push(CROP_DIRECTION_SUGGESTIONS[cropDirection]);
  }
  if (occlusionSource && problemSource !== '主要受裁剪影响') {
    parts.push(OCCLUSION_SUGGESTIONS[occlusionSource]);
  }
  const unique = [...new Set(parts)];
  if (unique.length === 0) return FALLBACK_SUGGESTION;
  return unique.join(' 同时，');
}

/**
 * 诊断主入口：复用现有的可见率计算，生成一条标注的完整诊断结果。
 * occluders 传 null 表示未开启遮挡（最终可见率 = 裁剪保留率）。
 */
export function diagnoseAnnotation(
  annotation: Annotation,
  cropRect: Rect,
  occluders: Rect[] | null,
): DiagnosisResult {
  const base = analyzeAnnotation(annotation, cropRect);
  const occ = occluders ? analyzeWithOcclusion(annotation, cropRect, occluders) : null;
  const cropKeptRatio = base.ratio;
  const finalVisibleRatio = occ ? occ.finalVisibleRatio : base.ratio;
  const level = occ ? occ.finalLevel : base.level;
  const { cropLoss, occlusionLoss } = computeLosses(cropKeptRatio, finalVisibleRatio);
  const problemSource = classifyProblemSource(cropLoss, occlusionLoss);
  const cropDirection = detectCropDirection(annotation, cropRect);
  const occlusionSource = detectOccluderSource(annotation, occluders);
  const suggestion = buildSuggestion(problemSource, cropDirection, occlusionSource);
  return {
    annotation,
    cropKeptRatio,
    finalVisibleRatio,
    level,
    problemSource,
    cropDirection,
    occlusionSource,
    suggestion,
  };
}
