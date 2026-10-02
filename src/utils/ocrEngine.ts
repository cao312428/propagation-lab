/**
 * OCR 引擎封装：管理 tesseract.js worker 生命周期并编排单条标注的识别。
 *
 * - tesseract.js 通过动态 import 加载，不进入首屏主 bundle；
 * - 单次检测任务共用一个 worker（不为每个标注新建），结束后 terminate 释放；
 * - 语言模型（chi_sim + eng）由 tesseract.js 按需下载，断网 / 加载失败时
 *   抛出异常，由调用方转换为可处理的失败结果，绝不让整个页面崩溃；
 * - 每次识别「原始提取 + 轻量预处理」双跑，优先选择置信度更高的结果
 *   （见 utils/ocrPreprocess），预处理不修改任何标注数据；
 * - confidence 来自 OCR 引擎自身返回值，引擎未提供时为 null，不虚构；
 * - 只比较「解码文本」，不生成任何评分。
 */
import type { Annotation, Rect } from '../types';
import type { TextRecognitionResult } from '../types/textRecognition';
import {
  buildOcrResult,
  computeExpectedSimilarity,
  computeTextOcrRect,
  normalizeOcrText,
  OCR_FAILED_MESSAGE,
  ocrFailedResult,
  ROI_TOO_SMALL_REASON,
  SCENE_SKIPPED_REASON,
  shouldSkipSceneOcr,
  TEXT_OCR_MIN_ROI_PX,
} from './textRecognition';
import {
  applySceneTransform,
  extractRoiFromImage,
  imageDataToCanvas,
  snapRectToPixels,
} from './scenePixels';
import { classifyDegradedOcr, degradeScenePixels } from './imageDegradation';
import { buildPreprocessedOcrCanvas, selectOcrRecognition, type OcrRecognition } from './ocrPreprocess';

/** 一次 OCR 识别的原始返回（文本 + 引擎置信度） */
export interface OcrRecognizeOutput {
  text: string;
  /** OCR 引擎自身置信度（0～100）；引擎未提供时为 null，不虚构 */
  confidence: number | null;
}

/** OCR 引擎接口（worker 封装） */
export interface OcrEngine {
  /** 识别一张 canvas 上的文字，返回识别文本与引擎置信度 */
  recognize(canvas: HTMLCanvasElement): Promise<OcrRecognizeOutput>;
  /** 释放 worker 与相关资源 */
  dispose(): Promise<void>;
}

/**
 * 创建 OCR 引擎：动态加载 tesseract.js，创建单一 worker 并加载 chi_sim + eng。
 * 创建失败（语言模型下载失败 / 断网 / worker 异常）时向上抛出。
 */
export async function createOcrEngine(): Promise<OcrEngine> {
  // 动态加载，避免 OCR 代码进入首屏主 bundle
  const Tesseract = await import('tesseract.js');
  const worker = await Tesseract.createWorker('chi_sim+eng');
  return {
    async recognize(canvas) {
      const result = await worker.recognize(canvas);
      // Page 级平均置信度（0～100）；引擎未提供（undefined）时置 null，不虚构
      const confidence =
        typeof result.data.confidence === 'number' ? result.data.confidence : null;
      return { text: result.data.text ?? '', confidence };
    },
    async dispose() {
      await worker.terminate();
    },
  };
}

/**
 * 一次识别：原始画布 + 预处理画布双跑，选择最终结果。
 * 预处理画布构建失败时按「预处理无文本」处理（回退原始）。
 */
async function recognizeWithPreprocess(
  engine: OcrEngine,
  canvas: HTMLCanvasElement,
): Promise<OcrRecognition> {
  const original = await engine.recognize(canvas);
  const preprocessedCanvas = buildPreprocessedOcrCanvas(canvas);
  const preprocessed = preprocessedCanvas
    ? await engine.recognize(preprocessedCanvas)
    : { text: '', confidence: null };
  return selectOcrRecognition(
    { text: original.text, confidence: original.confidence, source: 'original' },
    { text: preprocessed.text, confidence: preprocessed.confidence, source: 'preprocessed' },
  );
}

/**
 * 对一条文字标注执行完整 OCR 压力测试：
 * 原图 ROI（统一 padding + 整数对齐 + 1:1 提取）→ 基线识别（原始 + 预处理双跑）；
 * 同一像素应用裁剪/遮挡场景变换 → 场景识别（双跑）；
 * 启用画质退化时再对 scene 像素做「缩小 + JPEG 编解码」→ 退化识别（双跑），
 * 退化比较优先针对 scene vs degradedScene；
 * 完全被裁掉时跳过场景识别并记录原因；任何异常都返回可处理的失败结果。
 * 存在期望文本（annotation.expectedText）时计算各阶段与期望文本的相似度。
 */
export async function runOcrForAnnotation(
  engine: OcrEngine,
  image: HTMLImageElement,
  annotation: Annotation,
  cropRect: Rect,
  occluders: Rect[] | null,
  imageW: number,
  imageH: number,
  degradation: { scaleFactor: number; jpegQuality: number } | null = null,
): Promise<TextRecognitionResult> {
  // 统一 padding 函数 → 对齐整数像素网格（与二维码检测共用同一套像素处理）
  const roi = snapRectToPixels(computeTextOcrRect(annotation, imageW, imageH));
  if (roi.w < TEXT_OCR_MIN_ROI_PX || roi.h < TEXT_OCR_MIN_ROI_PX) {
    return ocrFailedResult(annotation.id, ROI_TOO_SMALL_REASON);
  }
  const imageData = extractRoiFromImage(image, roi);
  if (!imageData) {
    return ocrFailedResult(annotation.id);
  }
  try {
    const baseline = await recognizeWithPreprocess(
      engine,
      imageDataToCanvas(imageData.data, imageData.width, imageData.height),
    );
    // 标注完全被裁掉：跳过场景识别，直接记录原因
    if (shouldSkipSceneOcr(annotation, cropRect)) {
      return {
        ...buildOcrResult(annotation.id, baseline.text, '', SCENE_SKIPPED_REASON, {
          baselineConfidence: baseline.confidence,
          baselineSource: baseline.source,
          expectedText: annotation.expectedText,
        }),
        currentSkippedReason: SCENE_SKIPPED_REASON,
      };
    }
    const scenePixels = applySceneTransform(imageData.data, roi, cropRect, occluders);
    const sceneCanvas = imageDataToCanvas(scenePixels, imageData.width, imageData.height);
    const current = await recognizeWithPreprocess(engine, sceneCanvas);
    const base = buildOcrResult(annotation.id, baseline.text, current.text, undefined, {
      baselineConfidence: baseline.confidence,
      currentConfidence: current.confidence,
      baselineSource: baseline.source,
      currentSource: current.source,
      expectedText: annotation.expectedText,
    });
    // 画质退化第三阶段：scene 像素 → 缩小 + JPEG 编解码 → 再次识别
    if (degradation) {
      const degradedCanvas = await degradeScenePixels(
        scenePixels,
        imageData.width,
        imageData.height,
        degradation.scaleFactor,
        degradation.jpegQuality,
      );
      const degraded = await recognizeWithPreprocess(engine, degradedCanvas);
      const degradedComparison = classifyDegradedOcr(
        normalizeOcrText(current.text),
        normalizeOcrText(degraded.text),
      );
      return {
        ...base,
        degradedText: degraded.text,
        degradedConfidence: degraded.confidence,
        degradedSource: degraded.source,
        degradedComparison,
        expectedDegradedSimilarity: computeExpectedSimilarity(
          degraded.text,
          annotation.expectedText,
        ),
      };
    }
    return base;
  } catch {
    return ocrFailedResult(annotation.id, OCR_FAILED_MESSAGE);
  }
}
