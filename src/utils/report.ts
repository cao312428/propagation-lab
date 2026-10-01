/**
 * 传播风险报告数据整理模块。
 *
 * 只聚合现有检测结果（问题诊断 + 二维码压力测试 + 当前场景状态），
 * 不包含任何新的判断算法，不生成任何未经验证的评分或主观评价。
 * 全部为纯函数，便于单元测试。
 */
import type { CropRatio, VisibilityLevel } from '../types';
import type { DiagnosisResult } from './diagnosis';
import type { DegradedQrOutcome, QrCheckResult } from './qrDetection';
import type { TextRecognitionResult } from '../types/textRecognition';
import type { DegradationSnapshot } from '../types/comparison';
import type { MultiScenarioSummary } from '../types/multiScenario';
import {
  computeDegradedDimensions,
  formatJpegQualityPercent,
  formatScalePercent,
} from './imageDegradation';
import { formatReportTime } from './format';

/** 报告排序权重：严重缺失排最前，完整排最后（同级别保持原有顺序） */
const LEVEL_ORDER: Record<VisibilityLevel, number> = { 严重缺失: 0, 部分可见: 1, 完整: 2 };

/** 报告输入：全部来自现有状态与检测结果 */
export interface ReportInput {
  fileName: string;
  imageWidth: number;
  imageHeight: number;
  cropRatio: CropRatio;
  occlusionEnabled: boolean;
  /** 画质退化设置（含是否开启） */
  degradation: DegradationSnapshot;
  /** 当前场景（裁剪后）实际像素尺寸（用于计算退化后输出尺寸） */
  sceneWidth: number;
  sceneHeight: number;
  /** 二维码画质退化检测结果（仅启用退化时存在） */
  degradedQrResults: Map<string, DegradedQrOutcome>;
  diagnoses: DiagnosisResult[];
  qrResults: Map<string, QrCheckResult>;
  /** 文字 OCR 结果（仅用户在界面主动运行后存在） */
  ocrResults: Map<string, TextRecognitionResult>;
  /** 多场景测试摘要（纯计数，非评分；未运行多场景测试时不提供） */
  multiScenarioSummary?: MultiScenarioSummary | null;
}

/** 报告中的一条区域记录（诊断 + 可选的二维码 / OCR 检测结果） */
export interface ReportItem {
  diagnosis: DiagnosisResult;
  qr?: QrCheckResult;
  ocr?: TextRecognitionResult;
  degradedQr?: DegradedQrOutcome;
}

/** 整理后的报告数据（纯展示用） */
export interface ReportData {
  fileName: string;
  imageWidth: number;
  imageHeight: number;
  /** 测试场景文案，如「9:16 居中裁剪」 */
  cropRatioText: string;
  /** 界面遮挡文案：「已开启」或「未开启」 */
  occlusionText: string;
  /** 画质退化开关文案：「已开启」或「未开启」 */
  degradationText: string;
  /** 画质退化参数详情（开启时提供；关闭时为 null） */
  degradationDetail: string | null;
  totalCount: number;
  fullCount: number;
  partialCount: number;
  missingCount: number;
  /** 结论摘要（仅拼接已有数据，无主观评价） */
  summary: string;
  /** 报告生成时间文案（本地时间，仅用于报告展示，不参与任何检测计算） */
  generatedAtText: string;
  /** 在当前传播场景下识别失败的二维码数量（仅 baseline 可识别而场景失败时计入） */
  qrFailureCount: number;
  /** 多场景测试摘要（纯计数，非评分；未运行多场景测试时为 null） */
  multiScenarioSummary: MultiScenarioSummary | null;
  /** 按严重程度排序后的区域列表 */
  items: ReportItem[];
}

/** 裁剪比例 → 测试场景文案（1:1 / 4:5 / 9:16 / 16:9 通用） */
export function formatCropRatioText(ratio: CropRatio): string {
  return `${ratio} 居中裁剪`;
}

/** 遮挡开关 → 文案 */
export function formatOcclusionText(enabled: boolean): string {
  return enabled ? '已开启' : '未开启';
}

/**
 * 按已有统计结果拼接结论摘要（确定性文本）。
 * 存在二维码功能失效时追加说明；不生成任何评分或主观判断。
 */
export function buildSummary(
  total: number,
  full: number,
  partial: number,
  missing: number,
  qrFailure: number,
): string {
  const base = `本次共检测${total}个重要信息区域，其中${full}个完整、${partial}个部分可见、${missing}个严重缺失。`;
  if (qrFailure > 0) {
    return `${base}其中${qrFailure}个二维码在当前传播场景下无法被本地解码器识别。`;
  }
  return base;
}

/**
 * 汇总报告数据：
 * - 数量统计直接按诊断结果的最终分类计数；
 * - 列表按 严重缺失 → 部分可见 → 完整 排序（稳定排序，同级别保持原顺序）；
 * - 二维码失效数 = 结论为「传播处理后二维码识别失败」的标注数
 *   （原图本身无法识别的二维码不计入失效）。
 *
 * now 为报告生成时刻（默认当前时间），仅在生成时取一次，
 * 秒数变化不会触发重复计算。
 */
export function buildReportData(input: ReportInput, now: Date = new Date()): ReportData {
  const items: ReportItem[] = input.diagnoses
    .map((diagnosis) => ({
      diagnosis,
      qr: input.qrResults.get(diagnosis.annotation.id),
      ocr: input.ocrResults.get(diagnosis.annotation.id),
      degradedQr: input.degradedQrResults.get(diagnosis.annotation.id),
    }))
    .sort((a, b) => LEVEL_ORDER[a.diagnosis.level] - LEVEL_ORDER[b.diagnosis.level]);

  let fullCount = 0;
  let partialCount = 0;
  let missingCount = 0;
  for (const { diagnosis } of items) {
    if (diagnosis.level === '完整') fullCount += 1;
    else if (diagnosis.level === '部分可见') partialCount += 1;
    else missingCount += 1;
  }

  const qrFailureCount = items.filter(
    (i) => i.qr?.conclusion === '传播处理后二维码识别失败',
  ).length;

  // 画质退化信息（未开启时不生成详情）
  const degradationText = input.degradation.enabled ? '已开启' : '未开启';
  let degradationDetail: string | null = null;
  if (input.degradation.enabled) {
    const dims = computeDegradedDimensions(
      input.sceneWidth,
      input.sceneHeight,
      input.degradation.scaleFactor,
    );
    degradationDetail = `缩放比例：${formatScalePercent(input.degradation.scaleFactor)} · 实际输出尺寸：${dims.w} × ${dims.h} px · JPEG质量：${formatJpegQualityPercent(input.degradation.jpegQuality)}`;
  }

  return {
    fileName: input.fileName,
    imageWidth: input.imageWidth,
    imageHeight: input.imageHeight,
    cropRatioText: formatCropRatioText(input.cropRatio),
    occlusionText: formatOcclusionText(input.occlusionEnabled),
    degradationText,
    degradationDetail,
    totalCount: items.length,
    fullCount,
    partialCount,
    missingCount,
    summary: buildSummary(items.length, fullCount, partialCount, missingCount, qrFailureCount),
    generatedAtText: formatReportTime(now),
    qrFailureCount,
    multiScenarioSummary: input.multiScenarioSummary ?? null,
    items,
  };
}
