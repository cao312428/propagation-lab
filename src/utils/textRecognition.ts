/**
 * 文字可识别性压力测试的纯逻辑模块。
 *
 * - padding 提取区域（独立函数，限制在原图边界内）；
 * - 文本轻量标准化（trim / 合并空白 / 统一换行，不做任何纠错）；
 * - A / B / C / D 结论分类与字符级相似度（只比较解码文本，不生成任何评分）；
 * - OCR 结果过期判断（环境指纹比较）；
 * - 可处理的错误结果（不抛崩整个流程）。
 * 全部为纯函数，不依赖浏览器与 tesseract.js，便于单元测试。
 */
import type { LabelType, Rect } from '../types';
import type {
  OcrResultStatus,
  OcrRunFingerprint,
  TextRecognitionResult,
} from '../types/textRecognition';
import { intersectRect } from './geometry';

/* ------------------------------------------------------------------
 * ROI padding 规则（当前产品规则，非行业标准）
 * ------------------------------------------------------------------ */

/** 提取区域四周的最小 padding（像素） */
export const TEXT_OCR_PADDING_MIN_PX = 4;

/** padding 占标注边长的比例（5%，文字区域 padding 比二维码小） */
export const TEXT_OCR_PADDING_RATIO = 0.05;

/** padding 上限（像素） */
export const TEXT_OCR_PADDING_MAX_PX = 32;

/** ROI 最小尺寸（像素）：宽或高低于该值视为过小，跳过识别 */
export const TEXT_OCR_MIN_ROI_PX = 16;

/* ------------------------------------------------------------------
 * 文案常量
 * ------------------------------------------------------------------ */

/** OCR 识别失败的统一提示 */
export const OCR_FAILED_MESSAGE = '文字识别失败，请重新尝试。';

/** 标注区域已完全离开当前传播画面的说明 */
export const SCENE_SKIPPED_REASON = '区域已完全离开当前传播画面。';

/** ROI 过小的说明 */
export const ROI_TOO_SMALL_REASON = '文字区域过小，无法进行识别。';

/** 语言模型加载提示（界面常驻说明） */
export const OCR_MODEL_LOADING_HINT = '首次文字识别可能需要加载 OCR 语言模型，请稍候。';

/* ------------------------------------------------------------------
 * 目标判断与 ROI 计算
 * ------------------------------------------------------------------ */

/** 判断标注是否需要执行 OCR：文字类标签执行，二维码继续走二维码检测 */
export function isTextOcrTarget(label: LabelType): boolean {
  return label === '标题' || label === '日期' || label === '地点' || label === '其他';
}

/**
 * 统一 padding 函数（baseline 与 current scene 共用）：
 * 文字标注四周各加少量 padding（防止框选过紧），再限制在原图边界内。
 * padding = max(最小像素, 标注边长 × 5%)，上限 32px。
 */
export function computeTextOcrRect(
  annotation: Rect,
  imageW: number,
  imageH: number,
): Rect {
  const padX = Math.min(
    TEXT_OCR_PADDING_MAX_PX,
    Math.max(TEXT_OCR_PADDING_MIN_PX, Math.round(annotation.w * TEXT_OCR_PADDING_RATIO)),
  );
  const padY = Math.min(
    TEXT_OCR_PADDING_MAX_PX,
    Math.max(TEXT_OCR_PADDING_MIN_PX, Math.round(annotation.h * TEXT_OCR_PADDING_RATIO)),
  );
  const x = Math.max(0, annotation.x - padX);
  const y = Math.max(0, annotation.y - padY);
  const right = Math.min(imageW, annotation.x + annotation.w + padX);
  const bottom = Math.min(imageH, annotation.y + annotation.h + padY);
  return { x, y, w: right - x, h: bottom - y };
}

/**
 * 判断标注是否已完全离开当前裁剪画面：
 * 完全被裁掉时不必浪费 OCR 计算，直接跳过场景识别。
 */
export function shouldSkipSceneOcr(annotation: Rect, cropRect: Rect): boolean {
  return intersectRect(annotation, cropRect) === null;
}

/* ------------------------------------------------------------------
 * 文本标准化
 * ------------------------------------------------------------------ */

/**
 * 轻量标准化：trim、统一换行为空格、合并连续空白。
 * 不做数字修改、错别字猜测或任何自动纠错。
 */
export function normalizeOcrText(text: string): string {
  return text.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/* ------------------------------------------------------------------
 * 字符级相似度（normalized Levenshtein similarity）
 * ------------------------------------------------------------------ */

/** 计算两个标准化文本的字符级相似度（0～1）。两者都为空 → 1；一空 → 0。 */
export function ocrSimilarity(a: string, b: string): number {
  if (a === '' && b === '') return 1;
  if (a === '' || b === '') return 0;
  const dist = levenshteinDistance(a, b);
  return 1 - dist / Math.max(a.length, b.length);
}

/** 经典 Levenshtein 编辑距离（O(n·m) 滚动数组实现） */
function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

/* ------------------------------------------------------------------
 * 结论分类（A / B / C / D）
 * ------------------------------------------------------------------ */

/**
 * 由基线文本与场景文本生成结论（先标准化再比较）：
 * A. 两者都有文本且完全一致 → 识别文本保持一致；
 * B. 两者都有文本但内容不同 → 识别文本发生变化；
 * C. 基线有文本、场景无识别结果 → 传播处理后未能识别文字；
 * D. 基线本身无识别结果 → 无法判断传播处理是否导致变化（不归因于传播）。
 */
export function classifyOcrResult(
  baselineRaw: string,
  currentRaw: string,
): { status: OcrResultStatus; similarity: number | null } {
  const baseline = normalizeOcrText(baselineRaw);
  const current = normalizeOcrText(currentRaw);
  if (baseline === '') {
    return {
      status: '原图文字未能成功识别，无法判断传播处理是否导致变化',
      similarity: null,
    };
  }
  if (current === '') {
    return { status: '传播处理后未能识别文字', similarity: 0 };
  }
  if (baseline === current) {
    return { status: '识别文本保持一致', similarity: 1 };
  }
  return {
    status: '识别文本发生变化',
    similarity: ocrSimilarity(baseline, current),
  };
}

/** 由识别文本组装一条完整结果（含结论与相似度） */
export function buildOcrResult(
  annotationId: string,
  baselineText: string,
  currentText: string,
  currentSkippedReason?: string,
): TextRecognitionResult {
  const { status, similarity } = classifyOcrResult(baselineText, currentText);
  return {
    annotationId,
    baselineText,
    currentText,
    status,
    similarity,
    currentSkippedReason,
  };
}

/** 生成一条「可处理的失败结果」（不抛异常，界面显示提示文案） */
export function ocrFailedResult(
  annotationId: string,
  message: string = OCR_FAILED_MESSAGE,
): TextRecognitionResult {
  return {
    annotationId,
    baselineText: '',
    currentText: '',
    status: '原图文字未能成功识别，无法判断传播处理是否导致变化',
    similarity: null,
    error: message,
  };
}

/* ------------------------------------------------------------------
 * OCR 结果过期判断
 * ------------------------------------------------------------------ */

/**
 * 判断 OCR 结果是否已过期：图片、裁剪比例、遮挡开关或标注任一变化即过期。
 * 使用运行时的环境指纹（引用 / 原始值比较），不依赖时间。
 */
export function isOcrResultStale(
  fingerprint: OcrRunFingerprint | null,
  current: OcrRunFingerprint,
): boolean {
  if (!fingerprint) return true;
  return (
    fingerprint.image !== current.image ||
    fingerprint.cropRatio !== current.cropRatio ||
    fingerprint.occlusionEnabled !== current.occlusionEnabled ||
    fingerprint.annotations !== current.annotations ||
    fingerprint.degradation !== current.degradation
  );
}
