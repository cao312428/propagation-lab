/**
 * 文字可识别性压力测试（OCR 第一版）相关类型。
 * OCR 结果只描述「解码文本的比较」，不描述阅读成功率、可读性评分等虚构指标。
 * OCR 置信度为 OCR 引擎自身置信信息，不是人类可读性评分，不是传播成功率。
 */
import type { CropRatio } from '../types';
import type { DegradedOcrStatus } from '../utils/imageDegradation';

/** 文字 OCR 任务整体状态 */
export type OcrRunStatus = '未检测' | '加载OCR模型' | '正在识别' | '完成' | '失败';

/** 单条标注的 OCR 结论（A / B / C / D） */
export type OcrResultStatus =
  | '识别文本保持一致'
  | '识别文本发生变化'
  | '传播处理后未能识别文字'
  | '原图文字未能成功识别，无法判断传播处理是否导致变化';

/** OCR 识别使用的像素来源（原始提取 vs 预处理后） */
export type OcrPixelSource = 'original' | 'preprocessed';

/** 单条文字标注的 OCR 压力测试结果 */
export interface TextRecognitionResult {
  annotationId: string;
  /** 原图识别的原始文本（未标准化，供用户查看） */
  baselineText: string;
  /** 当前传播场景识别的原始文本 */
  currentText: string;
  /** 结论（A / B / C / D） */
  status: OcrResultStatus;
  /** 字符级相似度（标准化文本比较，0～1）；无法比较时为 null */
  similarity: number | null;
  /** 场景识别被跳过时的原因（如区域已完全离开传播画面） */
  currentSkippedReason?: string;
  /** 识别失败信息（模型加载失败 / 区域过小 / Canvas 提取失败等） */
  error?: string;
  /** 画质退化后识别的原始文本（仅启用画质退化时存在） */
  degradedText?: string;
  /** 画质退化比较（scene vs degradedScene，仅启用画质退化时存在） */
  degradedComparison?: {
    status: DegradedOcrStatus;
    similarity: number | null;
  };

  /* ---- OCR 可信度增强（本阶段新增） ---- */

  /** 原图 OCR 引擎置信度（0～100；引擎未提供时为 null，不虚构） */
  baselineConfidence: number | null;
  /** 当前场景 OCR 引擎置信度（0～100；引擎未提供时为 null） */
  currentConfidence: number | null;
  /** 画质退化后 OCR 引擎置信度（0～100；仅启用画质退化且成功识别时存在） */
  degradedConfidence?: number | null;
  /** 原图识别采用的像素来源 */
  baselineSource: OcrPixelSource;
  /** 场景识别采用的像素来源 */
  currentSource: OcrPixelSource;
  /** 退化识别采用的像素来源（仅启用画质退化时存在） */
  degradedSource?: OcrPixelSource;
  /** 原图识别文本与期望文本的相似度（0～1；无期望文本或无法比较时为 null） */
  expectedBaselineSimilarity?: number | null;
  /** 场景识别文本与期望文本的相似度（0～1；无期望文本或无法比较时为 null） */
  expectedCurrentSimilarity?: number | null;
  /** 退化识别文本与期望文本的相似度（0～1；仅启用画质退化且存在期望文本时存在） */
  expectedDegradedSimilarity?: number | null;
}

/** OCR 结果对应的运行环境指纹（用于判断结果是否过期） */
export interface OcrRunFingerprint {
  image: unknown;
  cropRatio: CropRatio;
  occlusionEnabled: boolean;
  annotations: unknown;
  /** 画质退化参数（引用比较：参数变化即新引用） */
  degradation: unknown;
}
