/**
 * 版本对比逻辑模块（全部为纯函数）。
 *
 * - 快照：只保存检测结果数值与文字，不保存图片 / Canvas / 像素；
 * - 配对：按「标签类型 + 同类型出现顺序」匹配，不宣称自动识别同一元素；
 * - 场景一致性：裁剪比例与遮挡开关必须一致才生成结论，不自动修改用户设置；
 * - 变化分类与摘要：完全由实际比较数据推导，无任何主观评价。
 */
import { LABEL_OPTIONS } from '../constants';
import type { CropRatio } from '../types';
import type { DiagnosisResult } from './diagnosis';
import type { QrCheckResult } from './qrDetection';
import {
  type BaselineSnapshot,
  type ChangeDirection,
  type ComparisonPair,
  type ComparisonResult,
  type DegradationSnapshot,
  type PairStatus,
  type RegionComparison,
  type SnapshotAnnotation,
} from '../types/comparison';

/* ------------------------------------------------------------------
 * 变化分类阈值（当前产品初始规则，不是行业标准）
 * ------------------------------------------------------------------ */

/**
 * 最终几何可见率变化的「基本不变」区间：±5 个百分点。
 * 变化 ≥ +5pp → 改善；≤ -5pp → 下降；中间 → 基本不变。
 * 二维码功能性变化（无法识别↔可识别）优先级更高，不受此阈值限制。
 */
export const VISIBILITY_CHANGE_THRESHOLD_PP = 5;

/** 二维码突出文案 */
export const QR_RECOVERED_TEXT = '修改后二维码恢复可识别';
export const QR_LOST_TEXT = '修改后二维码失去可识别性';

/** 场景不一致时的提示文案（不生成任何比较结论） */
export const SCENARIO_MISMATCH_TEXT =
  '当前测试场景与修改前版本不一致，请切换到相同的裁剪比例和遮挡设置后再比较。';

/** 配对规则说明（界面常驻显示，不宣称自动识别同一元素） */
export const PAIRING_RULE_TEXT = '当前版本对比通过标签类型及标注顺序进行匹配。';

/* ------------------------------------------------------------------
 * 快照生成
 * ------------------------------------------------------------------ */

/** 从当前检测结果生成修改前版本快照（纯数据，无像素） */
export function createSnapshot(input: {
  fileName: string;
  imageWidth: number;
  imageHeight: number;
  cropRatio: CropRatio;
  occlusionEnabled: boolean;
  degradation: DegradationSnapshot;
  diagnoses: DiagnosisResult[];
  qrResults: Map<string, QrCheckResult>;
}): BaselineSnapshot {
  return {
    fileName: input.fileName,
    imageWidth: input.imageWidth,
    imageHeight: input.imageHeight,
    cropRatio: input.cropRatio,
    occlusionEnabled: input.occlusionEnabled,
    degradation: input.degradation,
    annotations: toSnapshotAnnotations(input.diagnoses, input.qrResults),
  };
}

/** 当前检测结果 → 快照标注数组（供快照与实时对比共用） */
export function toSnapshotAnnotations(
  diagnoses: DiagnosisResult[],
  qrResults: Map<string, QrCheckResult>,
): SnapshotAnnotation[] {
  return diagnoses.map((d) => {
    const qr = qrResults.get(d.annotation.id);
    return {
      label: d.annotation.label,
      cropKeptRatio: d.cropKeptRatio,
      finalVisibleRatio: d.finalVisibleRatio,
      level: d.level,
      problemSource: d.problemSource,
      cropDirection: d.cropDirection,
      occlusionSource: d.occlusionSource,
      suggestion: d.suggestion,
      qr: qr
        ? {
            baselineReadable: qr.baselineReadable,
            scenarioReadable: qr.scenarioReadable,
            conclusion: qr.conclusion,
          }
        : null,
    };
  });
}

/* ------------------------------------------------------------------
 * 配对：标签类型 + 同类型出现顺序
 * ------------------------------------------------------------------ */

/**
 * 按「标签类型 + 同类型出现顺序」配对：
 * - 同标签双方按保存顺序一一对应 → 匹配；
 * - 修改前多出的 → 修改后未标注；
 * - 修改后多出的 → 新增标注。
 * 结果按标签分组（LABEL_OPTIONS 顺序），组内先匹配、再未标注、最后新增。
 */
export function pairByLabelAndOrder(
  before: SnapshotAnnotation[],
  after: SnapshotAnnotation[],
): ComparisonPair[] {
  const pairs: ComparisonPair[] = [];
  for (const label of LABEL_OPTIONS) {
    const bs = before.filter((a) => a.label === label);
    const as = after.filter((a) => a.label === label);
    const matched = Math.min(bs.length, as.length);
    for (let i = 0; i < matched; i++) {
      pairs.push({ label, status: '匹配', before: bs[i], after: as[i] });
    }
    for (let i = matched; i < bs.length; i++) {
      pairs.push({ label, status: '修改后未标注', before: bs[i], after: null });
    }
    for (let i = matched; i < as.length; i++) {
      pairs.push({ label, status: '新增标注', before: null, after: as[i] });
    }
  }
  return pairs;
}

/* ------------------------------------------------------------------
 * 单区域变化分类
 * ------------------------------------------------------------------ */

/**
 * 判断一个匹配区域的变化分类（阈值见 VISIBILITY_CHANGE_THRESHOLD_PP）。
 * 二维码功能性变化优先级更高：
 * - 修改前无法识别 → 修改后可识别：强制「改善」；
 * - 修改前可识别 → 修改后无法识别：强制「下降」；
 * 即使几何变化不足阈值。
 */
export function classifyRegionChange(
  before: SnapshotAnnotation,
  after: SnapshotAnnotation,
): RegionComparison {
  // 先四舍五入到 0.1 个百分点再与阈值比较：
  // 既与界面显示精度一致，也避免浮点误差（如 0.95 - 0.9 浮点值为 4.999…）造成临界值误判
  const cropDeltaPp = roundPp((after.cropKeptRatio - before.cropKeptRatio) * 100);
  const finalDeltaPp = roundPp((after.finalVisibleRatio - before.finalVisibleRatio) * 100);

  let direction: ChangeDirection;
  if (finalDeltaPp >= VISIBILITY_CHANGE_THRESHOLD_PP) direction = '改善';
  else if (finalDeltaPp <= -VISIBILITY_CHANGE_THRESHOLD_PP) direction = '下降';
  else direction = '基本不变';

  // 二维码功能性变化优先于几何变化
  let qrStatusText: string | null = null;
  let qrHighlightText: string | null = null;
  if (before.qr && after.qr) {
    qrStatusText = `${before.qr.scenarioReadable ? '可识别' : '无法识别'} → ${
      after.qr.scenarioReadable ? '可识别' : '无法识别'
    }`;
    if (!before.qr.scenarioReadable && after.qr.scenarioReadable) {
      qrHighlightText = QR_RECOVERED_TEXT;
      direction = '改善';
    } else if (before.qr.scenarioReadable && !after.qr.scenarioReadable) {
      qrHighlightText = QR_LOST_TEXT;
      direction = '下降';
    }
  }

  const levelChangeText =
    before.level !== after.level ? `${before.level} → ${after.level}` : null;

  return {
    pair: { label: after.label, status: '匹配', before, after },
    cropDeltaPp,
    finalDeltaPp,
    levelChangeText,
    qrStatusText,
    qrHighlightText,
    direction,
  };
}

/* ------------------------------------------------------------------
 * 总体变化摘要（确定性文本，只来自实际比较数据）
 * ------------------------------------------------------------------ */

/**
 * 拼接总体变化摘要：
 * 「共比较N个匹配区域：X个区域最终几何可见率提高，Y个基本不变，Z个下降。
 *   严重缺失区域从A个减少到B个。其中K个二维码由无法识别变为可识别。」
 * K > 0 时才追加二维码句；K = 0 且 A、B 均为 0 时省略严重缺失句。
 */
export function buildComparisonSummary(regions: RegionComparison[]): string {
  const improved = regions.filter((r) => r.direction === '改善').length;
  const unchanged = regions.filter((r) => r.direction === '基本不变').length;
  const declined = regions.filter((r) => r.direction === '下降').length;
  const missingBefore = regions.filter((r) => r.pair.before?.level === '严重缺失').length;
  const missingAfter = regions.filter((r) => r.pair.after?.level === '严重缺失').length;
  const qrRecovered = regions.filter((r) => r.qrHighlightText === QR_RECOVERED_TEXT).length;

  let summary = `共比较${regions.length}个匹配区域：${improved}个区域最终几何可见率提高，${unchanged}个基本不变，${declined}个下降。`;
  if (missingBefore > 0 || missingAfter > 0) {
    summary += `严重缺失区域从${missingBefore}个减少到${missingAfter}个。`;
  }
  if (qrRecovered > 0) {
    summary += `其中${qrRecovered}个二维码由无法识别变为可识别。`;
  }
  return summary;
}

/* ------------------------------------------------------------------
 * 完整对比结果
 * ------------------------------------------------------------------ */

/**
 * 生成完整对比结果。
 * 场景（裁剪比例 + 遮挡开关 + 画质退化设置）不一致时不生成任何结论，
 * 由界面显示 SCENARIO_MISMATCH_TEXT 提示，绝不自动修改用户当前设置。
 */
export function buildComparisonResult(
  baseline: BaselineSnapshot,
  current: {
    cropRatio: CropRatio;
    occlusionEnabled: boolean;
    degradation: DegradationSnapshot;
    annotations: SnapshotAnnotation[];
  },
): ComparisonResult {
  const scenarioMatch =
    baseline.cropRatio === current.cropRatio &&
    baseline.occlusionEnabled === current.occlusionEnabled &&
    baseline.degradation.enabled === current.degradation.enabled &&
    baseline.degradation.scaleFactor === current.degradation.scaleFactor &&
    baseline.degradation.jpegQuality === current.degradation.jpegQuality;

  const pairs = pairByLabelAndOrder(baseline.annotations, current.annotations);
  if (!scenarioMatch) {
    return { scenarioMatch: false, pairs, regions: [], summary: null };
  }

  const regions = pairs
    .filter(
      (p): p is ComparisonPair & { before: SnapshotAnnotation; after: SnapshotAnnotation } =>
        p.status === '匹配' && p.before !== null && p.after !== null,
    )
    // 复用原 pair 对象，保证与 result.pairs 中的引用一致
    .map((p) => ({ ...classifyRegionChange(p.before, p.after), pair: p }));

  return {
    scenarioMatch: true,
    pairs,
    regions,
    summary: buildComparisonSummary(regions),
  };
}

/** 四舍五入到 0.1 个百分点（用于阈值比较与显示） */
function roundPp(value: number): number {
  return Math.round(value * 10) / 10;
}

/** 配对状态 → 中文说明（未配对卡片用） */
export function formatPairStatus(status: PairStatus): string {
  if (status === '修改后未标注') return '修改后未标注';
  if (status === '新增标注') return '新增标注';
  return '匹配';
}

/** 百分点差值格式化：+37.3 / -12.0 / 0.0（明确使用「百分点」） */
export function formatDeltaPp(deltaPp: number): string {
  const value = deltaPp.toFixed(1);
  return deltaPp > 0 ? `+${value}` : value;
}

/** 百分比格式化（0.547 → 54.7%） */
export function formatPercentValue(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}
