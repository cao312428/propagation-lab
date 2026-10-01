/**
 * 多场景传播压力测试核心模块。
 *
 * 只复用现有已验证的计算能力：
 * - 几何：diagnoseAnnotation（裁剪 + 遮挡 + 诊断，原图坐标）；
 * - 二维码：qrDetection / scenePixels / imageDegradation 的纯函数与浏览器入口；
 * - OCR：只匹配「当前已存在且与该场景条件一致」的 OCR 结果，绝不自动批量执行。
 *
 * 全部场景均为本项目压力测试场景，不对应任何真实平台官方规则。
 * 矩阵单元格状态（几何 / QR / OCR）分开保存，不生成任何综合评分。
 */
import type { Annotation, CropRatio } from '../types';
import { CROP_RATIO_OPTIONS } from '../constants';
import type { TextRecognitionResult } from '../types/textRecognition';
import { isTextOcrTarget } from './textRecognition';
import { diagnoseAnnotation } from './diagnosis';
import { computeCenterCrop } from './crop';
import { computeOccluders } from './occlusion';
import { getPaddedQrRect, decodeQrPixels, isQrAnnotation } from './qrDetection';
import { snapRectToPixels, extractRoiFromImage, applySceneTransform } from './scenePixels';
import {
  classifyDegradedQr,
  degradeScenePixels,
  formatJpegQualityPercent,
  formatScalePercent,
} from './imageDegradation';
import type {
  MultiScenarioRunResult,
  MultiScenarioSummary,
  OcrMatrixData,
  OcrMatrixStatus,
  QrMatrixData,
  QrMatrixStatus,
  RegionScenarioResult,
  ResolvedScenario,
  ScenarioDefinition,
  ScenarioResult,
} from '../types/multiScenario';

export type {
  MultiScenarioRunResult,
  MultiScenarioSummary,
  OcrMatrixData,
  OcrMatrixStatus,
  QrMatrixData,
  QrMatrixStatus,
  RegionScenarioResult,
  ResolvedScenario,
  ScenarioDefinition,
  ScenarioResult,
} from '../types/multiScenario';

/* ------------------------------------------------------------------
 * 场景定义（本项目压力测试场景，不对应真实平台官方规则）
 * ------------------------------------------------------------------ */

/** 四个居中裁剪场景 */
const CROP_SCENARIOS: ScenarioDefinition[] = CROP_RATIO_OPTIONS.map((opt) => ({
  id: `crop-${opt.value.replace(':', '-')}`,
  name: `${opt.label} 居中裁剪`,
  group: '裁剪' as const,
  cropRatio: opt.value,
  occlusionEnabled: false,
  degradationPreset: null,
}));

/** 四个「裁剪 + 通用界面遮挡」组合场景 */
const CROP_OCCLUSION_SCENARIOS: ScenarioDefinition[] = CROP_RATIO_OPTIONS.map((opt) => ({
  id: `crop-${opt.value.replace(':', '-')}-occlusion`,
  name: `${opt.label} 居中裁剪 + 通用界面遮挡`,
  group: '裁剪+遮挡' as const,
  cropRatio: opt.value,
  occlusionEnabled: true,
  degradationPreset: null,
}));

/** 两个画质退化压力预设（基础场景 = 运行时的当前单场景，不写平台名称） */
const DEGRADATION_SCENARIOS: ScenarioDefinition[] = [
  {
    id: 'deg-medium',
    name: '中等画质压力',
    group: '画质压力',
    cropRatio: null,
    occlusionEnabled: false,
    degradationPreset: { scaleFactor: 0.5, jpegQuality: 0.7 },
  },
  {
    id: 'deg-high',
    name: '高画质压力',
    group: '画质压力',
    cropRatio: null,
    occlusionEnabled: false,
    degradationPreset: { scaleFactor: 0.25, jpegQuality: 0.35 },
  },
];

/** 全部场景（顺序即界面展示顺序） */
export const ALL_SCENARIOS: ScenarioDefinition[] = [
  ...CROP_SCENARIOS,
  ...CROP_OCCLUSION_SCENARIOS,
  ...DEGRADATION_SCENARIOS,
];

/** 按分组归类（界面分组渲染用） */
export const SCENARIO_GROUPS: {
  group: ScenarioDefinition['group'];
  label: string;
  scenarios: ScenarioDefinition[];
}[] = [
  { group: '裁剪', label: '裁剪', scenarios: CROP_SCENARIOS },
  { group: '裁剪+遮挡', label: '裁剪 + 通用界面遮挡', scenarios: CROP_OCCLUSION_SCENARIOS },
  { group: '画质压力', label: '画质压力预设', scenarios: DEGRADATION_SCENARIOS },
];

/* ------------------------------------------------------------------
 * 场景解析（纯函数）
 * ------------------------------------------------------------------ */

/** 场景完整文案（退化预设带参数与基础场景说明） */
export function buildScenarioDetail(def: ScenarioDefinition, currentCropRatio: CropRatio): string {
  if (def.degradationPreset) {
    const base = `${formatScalePercent(def.degradationPreset.scaleFactor)} 缩放、JPEG 质量 ${formatJpegQualityPercent(def.degradationPreset.jpegQuality)}`;
    return `${def.name}（${base}，基于当前场景：${currentCropRatio} 居中裁剪）`;
  }
  return def.name;
}

/**
 * 把选中的场景 id 解析为可执行的场景条件（原图坐标）。
 * 画质退化预设的裁剪比例与遮挡开关取「运行时的当前单场景」。
 */
export function resolveScenarios(
  selectedIds: string[],
  currentCropRatio: CropRatio,
  currentOcclusionEnabled: boolean,
  imageW: number,
  imageH: number,
): ResolvedScenario[] {
  return ALL_SCENARIOS.filter((def) => selectedIds.includes(def.id)).map((def) => {
    const ratioValue = def.cropRatio ?? currentCropRatio;
    const aspect = CROP_RATIO_OPTIONS.find((o) => o.value === ratioValue) ?? CROP_RATIO_OPTIONS[0];
    const cropRect = computeCenterCrop(imageW, imageH, aspect.aspectW, aspect.aspectH);
    const occlusionEnabled = def.cropRatio === null ? currentOcclusionEnabled : def.occlusionEnabled;
    const occluders = occlusionEnabled ? computeOccluders(cropRect) : null;
    return {
      definition: def,
      detail: buildScenarioDetail(def, currentCropRatio),
      occlusionEnabled,
      cropRect,
      occluders,
      degradation: def.degradationPreset,
    };
  });
}

/* ------------------------------------------------------------------
 * 矩阵状态映射（纯函数，几何与 QR / OCR 分开）
 * ------------------------------------------------------------------ */

/**
 * 二维码矩阵状态映射：
 * - 原图不可识别 → 原图不可识别（不把传播处理归因为失效原因）；
 * - 退化场景看退化后解码结果（scene 已失败时同样为「无法识别」）；
 * - 其余按场景解码结果判断。
 */
export function mapQrMatrixStatus(input: {
  baselineReadable: boolean;
  scenarioReadable: boolean;
  /** 退化检测是否已执行（null = 非退化场景） */
  degradedChecked: boolean | null;
  degradedReadable: boolean;
}): QrMatrixStatus {
  if (!input.baselineReadable) return '原图不可识别';
  if (input.degradedChecked !== null) {
    return input.degradedReadable ? '可识别' : '无法识别';
  }
  return input.scenarioReadable ? '可识别' : '无法识别';
}

/**
 * 由解码文本构建二维码矩阵数据。
 * degraded 三态（显式编码，避免 null 歧义）：
 * - 'none'：非退化场景，无退化检测；
 * - 'skipped'：退化场景但 scene 已无法识别，未执行退化检测；
 * - { content }：已执行退化检测（content 为 null 表示执行了但无法识别）。
 * 退化结论文案复用现有 classifyDegradedQr，保证与单场景口径一致。
 */
export function buildQrMatrixData(input: {
  baselineContent: string | null;
  scenarioContent: string | null;
  degraded: 'none' | 'skipped' | { content: string | null };
}): QrMatrixData {
  const baselineReadable = input.baselineContent !== null;
  const scenarioReadable = input.scenarioContent !== null;
  const degradedChecked =
    input.degraded === 'none' ? null : input.degraded !== 'skipped';
  const degradedContent = input.degraded !== 'none' && input.degraded !== 'skipped'
    ? input.degraded.content
    : null;
  const degradedReadable = degradedChecked !== null && degradedContent !== null;
  // 退化场景（含 scene 已失败未执行退化检测）均生成结论文案，与单场景口径一致
  const degradedConclusion =
    input.degraded !== 'none'
      ? classifyDegradedQr(scenarioReadable, degradedReadable)
      : undefined;
  return {
    baselineReadable,
    scenarioReadable,
    degradedChecked,
    degradedReadable,
    status: mapQrMatrixStatus({ baselineReadable, scenarioReadable, degradedChecked, degradedReadable }),
    scenarioContent: input.scenarioContent ?? undefined,
    degradedContent: degradedContent ?? undefined,
    degradedConclusion,
  };
}

/** 由单场景 OCR 结论映射为矩阵状态（纯文案映射） */
export function mapOcrMatrixStatus(result: TextRecognitionResult): OcrMatrixStatus {
  switch (result.status) {
    case '识别文本保持一致':
      return '保持一致';
    case '识别文本发生变化':
      return '发生变化';
    case '传播处理后未能识别文字':
      return '未能识别';
    default:
      return '原图未识别';
  }
}

/** 矩阵中 OCR 单元格的展示状态：无匹配数据显示「未运行」，而不是失败 */
export function ocrMatrixStatusOf(ocr: OcrMatrixData | null): OcrMatrixStatus {
  return ocr?.status ?? '未运行';
}

/**
 * 为「区域 × 场景」匹配可复用的 OCR 结果：
 * 只复用当前已存在、且与该场景条件（裁剪比例 / 遮挡开关 / 退化参数）
 * 与当前单场景环境完全一致的结果；否则返回 null（界面显示「未运行」）。
 * 本函数不做任何 OCR 计算。
 */
export function matchOcrForScenario(
  ocrResults: TextRecognitionResult[],
  annotation: Annotation,
  scenario: ResolvedScenario,
  currentCropRatio: CropRatio,
  currentOcclusionEnabled: boolean,
  currentDegradation: { scaleFactor: number; jpegQuality: number } | null,
): OcrMatrixData | null {
  if (!isTextOcrTarget(annotation.label)) return null;
  // 场景条件必须与当前单场景环境一致（现有 OCR 结果只对当前单场景有效）
  const sceneRatio = scenario.definition.cropRatio ?? currentCropRatio;
  if (sceneRatio !== currentCropRatio) return null;
  if (scenario.occlusionEnabled !== currentOcclusionEnabled) return null;
  if (scenario.degradation === null || currentDegradation === null) {
    if (scenario.degradation !== currentDegradation) return null;
  } else if (
    scenario.degradation.scaleFactor !== currentDegradation.scaleFactor ||
    scenario.degradation.jpegQuality !== currentDegradation.jpegQuality
  ) {
    return null;
  }
  const result = ocrResults.find((r) => r.annotationId === annotation.id);
  if (!result || result.error) return null;
  return {
    status: mapOcrMatrixStatus(result),
    similarity: result.similarity,
    baselineText: result.baselineText,
    scenarioText: result.currentText,
  };
}

/* ------------------------------------------------------------------
 * 单区域结果与场景结果组装（纯函数，几何复用诊断模块）
 * ------------------------------------------------------------------ */

/**
 * 组装单个「区域 × 场景」结果。
 * 几何字段直接来自 diagnoseAnnotation；二维码 / OCR 数据独立保存，
 * 任何一方的失败都不会改写几何状态。
 */
export function buildRegionScenarioResult(
  annotation: Annotation,
  scenario: ResolvedScenario,
  qr: QrMatrixData | null,
  ocr: OcrMatrixData | null,
): RegionScenarioResult {
  const d = diagnoseAnnotation(annotation, scenario.cropRect, scenario.occluders);
  return {
    annotationId: annotation.id,
    label: annotation.label,
    cropKeptRatio: d.cropKeptRatio,
    finalVisibleRatio: d.finalVisibleRatio,
    level: d.level,
    problemSource: d.problemSource,
    cropDirection: d.cropDirection,
    occlusionSource: d.occlusionSource,
    suggestion: d.suggestion,
    qr,
    ocr,
  };
}

/**
 * 组装全部场景结果（几何 + OCR 匹配，均为同步纯计算）。
 * qrMaps：scenarioId → annotationId → 二维码数据（由浏览器批量检测生成）。
 */
export function buildScenarioResults(
  annotations: Annotation[],
  scenarios: ResolvedScenario[],
  qrMaps: Map<string, Map<string, QrMatrixData>>,
  ocrResults: TextRecognitionResult[],
  currentCropRatio: CropRatio,
  currentOcclusionEnabled: boolean,
  currentDegradation: { scaleFactor: number; jpegQuality: number } | null,
): ScenarioResult[] {
  return scenarios.map((scenario) => {
    const qrMap = qrMaps.get(scenario.definition.id);
    const regions = annotations.map((annotation) => {
      const qr = qrMap?.get(annotation.id) ?? null;
      const ocr = matchOcrForScenario(
        ocrResults,
        annotation,
        scenario,
        currentCropRatio,
        currentOcclusionEnabled,
        currentDegradation,
      );
      return buildRegionScenarioResult(annotation, scenario, qr, ocr);
    });
    return { definition: scenario.definition, detail: scenario.detail, regions };
  });
}

/* ------------------------------------------------------------------
 * 摘要（纯计数，不是评分）
 * ------------------------------------------------------------------ */

/** 汇总多场景摘要：场景数 / 存在严重缺失的场景数 / 出现无法识别二维码的场景数 */
export function buildMultiScenarioSummary(scenarios: ScenarioResult[]): MultiScenarioSummary {
  let missingScenarioCount = 0;
  let qrFailureScenarioCount = 0;
  for (const s of scenarios) {
    if (s.regions.some((r) => r.level === '严重缺失')) missingScenarioCount += 1;
    if (s.regions.some((r) => r.qr && r.qr.status === '无法识别')) qrFailureScenarioCount += 1;
  }
  return {
    testedScenarioCount: scenarios.length,
    missingScenarioCount,
    qrFailureScenarioCount,
  };
}

/* ------------------------------------------------------------------
 * 失效规则（纯函数）
 * ------------------------------------------------------------------ */

/** 场景 id 集合的内容比较（顺序无关） */
export function sameScenarioIds(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((id, i) => id === sb[i]);
}

/**
 * 判断一次多场景运行结果是否仍然有效。
 * 原图、标注、场景选择、当前裁剪比例或遮挡开关任一变化即失效。
 */
export function isScenarioRunValid(
  run: MultiScenarioRunResult,
  image: HTMLImageElement | null,
  annotations: Annotation[],
  selectedScenarioIds: string[],
  currentCropRatio: CropRatio,
  currentOcclusionEnabled: boolean,
): boolean {
  return (
    run.image === image &&
    run.annotations === annotations &&
    run.currentCropRatio === currentCropRatio &&
    run.currentOcclusionEnabled === currentOcclusionEnabled &&
    sameScenarioIds(run.selectedScenarioIds, selectedScenarioIds)
  );
}

/* ------------------------------------------------------------------
 * 浏览器部分：二维码批量检测
 * ------------------------------------------------------------------ */

/**
 * 对选中场景下的全部「二维码」标注执行批量检测。
 *
 * 性能策略：
 * - 每个「标注 × 场景」组合只提取一次 ROI、只合成一次场景像素；
 * - 只有画质退化场景执行 JPEG 编解码（异步，逐组合 await）；
 * - 周期性让出主线程，保证运行中界面可响应、进度可见。
 *
 * 与单场景 detectQrForAnnotation 使用完全相同的
 * padding / 像素合成 / 解码纯函数，baseline 与各场景口径一致。
 *
 * 返回 scenarioId → annotationId → 二维码数据。
 */
export async function runQrBatch(
  image: HTMLImageElement,
  imageW: number,
  imageH: number,
  qrAnnotations: Annotation[],
  scenarios: ResolvedScenario[],
  onProgress: (done: number, total: number) => void,
): Promise<Map<string, Map<string, QrMatrixData>>> {
  const byScenario = new Map<string, Map<string, QrMatrixData>>();
  const total = qrAnnotations.length * scenarios.length;
  let done = 0;

  for (const scenario of scenarios) {
    const map = new Map<string, QrMatrixData>();
    byScenario.set(scenario.definition.id, map);
    for (const annotation of qrAnnotations) {
      map.set(annotation.id, await detectQrForScenario(image, annotation, scenario, imageW, imageH));
      done += 1;
      onProgress(done, total);
      // 让出主线程，保证运行中界面可响应、进度可见
      if (done % 2 === 0) await new Promise((r) => setTimeout(r, 0));
    }
  }
  return byScenario;
}

/**
 * 单个「标注 × 场景」二维码检测（浏览器入口，供批量执行器调用）。
 * 复用 getPaddedQrRect / snapRectToPixels / extractRoiFromImage /
 * applySceneTransform / decodeQrPixels / classifyDegradedQr / degradeScenePixels，
 * 与单场景检测链路完全一致；不修改任何标注数据。
 */
async function detectQrForScenario(
  image: HTMLImageElement,
  annotation: Annotation,
  scenario: ResolvedScenario,
  imageW: number,
  imageH: number,
): Promise<QrMatrixData> {
  const extractRect = snapRectToPixels(getPaddedQrRect(annotation, imageW, imageH));
  const imageData = extractRoiFromImage(image, extractRect);
  if (!imageData) {
    return buildQrMatrixData({ baselineContent: null, scenarioContent: null, degraded: 'none' });
  }
  const baselineContent = decodeQrPixels(imageData.data, imageData.width, imageData.height);
  const scenePixels = applySceneTransform(imageData.data, extractRect, scenario.cropRect, scenario.occluders);
  const scenarioContent = decodeQrPixels(scenePixels, imageData.width, imageData.height);

  if (!scenario.degradation) {
    return buildQrMatrixData({ baselineContent, scenarioContent, degraded: 'none' });
  }

  // 画质退化场景：scene 已无法识别时不执行退化检测（与现有结论口径一致）
  if (scenarioContent === null) {
    return buildQrMatrixData({ baselineContent, scenarioContent, degraded: 'skipped' });
  }
  try {
    const degradedCanvas = await degradeScenePixels(
      scenePixels,
      imageData.width,
      imageData.height,
      scenario.degradation.scaleFactor,
      scenario.degradation.jpegQuality,
    );
    const dctx = degradedCanvas.getContext('2d');
    if (!dctx) {
      // 退化执行失败：按退化后无法识别处理（保守，不抛崩批量流程）
      return buildQrMatrixData({ baselineContent, scenarioContent, degraded: { content: null } });
    }
    const degradedData = dctx.getImageData(0, 0, degradedCanvas.width, degradedCanvas.height);
    const degradedContent = decodeQrPixels(degradedData.data, degradedData.width, degradedData.height);
    return buildQrMatrixData({ baselineContent, scenarioContent, degraded: { content: degradedContent } });
  } catch {
    // 编解码异常：按退化后无法识别处理（保守，不抛崩批量流程）
    return buildQrMatrixData({ baselineContent, scenarioContent, degraded: { content: null } });
  }
}

/** 判断标注是否需要二维码检测（复用单场景过滤规则） */
export { isQrAnnotation as isQrAnnotationForScenario };
