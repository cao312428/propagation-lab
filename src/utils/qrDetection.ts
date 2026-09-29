/**
 * 二维码可识别性压力测试模块。
 *
 * 对标签为「二维码」的标注区域，用本地解码库 jsQR 实际尝试解码，
 * 对比「原图」与「当前传播场景（裁剪 + 可选界面遮挡）」两种状态。
 * 全程基于原图坐标与原图像素，与屏幕显示尺寸无关；不调用任何云端 API。
 *
 * 分层设计：
 * - 纯函数（computeQrExtractRect / applySceneTransform / buildQrConclusion / decodeQrPixels）
 *   不依赖浏览器，可在 Node 环境单元测试；
 * - detectQrForAnnotation 是浏览器入口，负责用 canvas 从原图提取标注区域像素。
 */
import jsQR from 'jsqr';
import type { Annotation, Rect } from '../types';
import { rectArea } from './geometry';
import {
  applySceneTransform,
  extractRoiFromImage,
  snapRectToPixels,
} from './scenePixels';
import { classifyDegradedQr, degradeScenePixels, type DegradedQrConclusion } from './imageDegradation';

// 保持原有导出不变（二维码测试与调用方继续从本模块引用）
export {
  applySceneTransform,
  CROPPED_FILL,
  OCCLUDED_FILL,
  snapRectToPixels,
} from './scenePixels';

/* ------------------------------------------------------------------
 * 提取区域 padding 规则（当前产品规则，非行业标准）
 * ------------------------------------------------------------------ */

/** 提取区域四周的最小 padding（像素） */
export const QR_PADDING_MIN_PX = 8;

/** padding 占标注边长的比例（10%） */
export const QR_PADDING_RATIO = 0.1;

/** padding 上限（像素），避免超大标注把提取区域扩得过大 */
export const QR_PADDING_MAX_PX = 64;

/** 识别内容在界面上的最大展示长度（超出截断） */
export const QR_CONTENT_MAX_LENGTH = 30;

/** 二维码压力测试结论 */
export type QrConclusion =
  | '当前场景下二维码仍可识别'
  | '传播处理后二维码识别失败'
  | '原图二维码未能成功识别，无法据此判断传播处理是否导致失效';

/** 一次二维码压力测试的完整结果 */
export interface QrCheckResult {
  /** 原图中是否可识别 */
  baselineReadable: boolean;
  /** 原图识别出的内容（无法识别时为空） */
  baselineContent?: string;
  /** 当前传播场景（裁剪 + 可选遮挡）中是否可识别 */
  scenarioReadable: boolean;
  /** 场景识别出的内容（无法识别时为空） */
  scenarioContent?: string;
  /** 结论（A / B / C 三种） */
  conclusion: QrConclusion;
}

/**
 * 统一 padding 函数（baseline 与 current scene 共用，不允许各写一套）：
 * 计算二维码提取区域，标注矩形四周各加 padding 补足静区，
 * 再限制在原图边界内。padding = max(最小像素, 标注边长 × 10%)，上限 64px。
 */
export function getPaddedQrRect(
  annotation: Rect,
  imageW: number,
  imageH: number,
): Rect {
  const padX = Math.min(
    QR_PADDING_MAX_PX,
    Math.max(QR_PADDING_MIN_PX, Math.round(annotation.w * QR_PADDING_RATIO)),
  );
  const padY = Math.min(
    QR_PADDING_MAX_PX,
    Math.max(QR_PADDING_MIN_PX, Math.round(annotation.h * QR_PADDING_RATIO)),
  );
  const x = Math.max(0, annotation.x - padX);
  const y = Math.max(0, annotation.y - padY);
  const right = Math.min(imageW, annotation.x + annotation.w + padX);
  const bottom = Math.min(imageH, annotation.y + annotation.h + padY);
  return { x, y, w: right - x, h: bottom - y };
}

/**
 * 用 jsQR 解码一份 RGBA 像素（纯本地计算）。
 * 返回识别出的文本内容；解码失败返回 null。
 * 注意：识别的是「当前测试图像像素」，不代表所有设备均可扫描。
 */
export function decodeQrPixels(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): string | null {
  const code = jsQR(pixels, width, height, { inversionAttempts: 'attemptBoth' });
  return code ? code.data : null;
}

/**
 * 由基线解码与场景解码结果生成结论（A / B / C）：
 * A. 原图可识别 + 场景可识别 → 当前场景下二维码仍可识别；
 * B. 原图可识别 + 场景无法识别 → 传播处理后二维码识别失败；
 * C. 原图无法识别 → 无法据此判断传播处理是否导致失效。
 * 注意：只反映解码器对测试图像像素的识别结果，不代表真实设备的扫描概率。
 */
export function buildQrConclusion(
  baselineContent: string | null,
  scenarioContent: string | null,
): QrCheckResult {
  const baselineReadable = baselineContent !== null;
  const scenarioReadable = scenarioContent !== null;
  let conclusion: QrConclusion;
  if (!baselineReadable) {
    conclusion = '原图二维码未能成功识别，无法据此判断传播处理是否导致失效';
  } else if (scenarioReadable) {
    conclusion = '当前场景下二维码仍可识别';
  } else {
    conclusion = '传播处理后二维码识别失败';
  }
  return {
    baselineReadable,
    baselineContent: baselineContent ?? undefined,
    scenarioReadable,
    scenarioContent: scenarioContent ?? undefined,
    conclusion,
  };
}

/** 截断过长的识别内容（仅用于界面展示，不自动打开 URL） */
export function formatQrContent(content: string): string {
  return content.length > QR_CONTENT_MAX_LENGTH
    ? `${content.slice(0, QR_CONTENT_MAX_LENGTH)}…`
    : content;
}

/**
 * 浏览器入口：对一条「二维码」标注执行压力测试。
 * 用 canvas 从原图按提取区域（原图坐标、1:1 像素）截取像素，
 * 先做基线解码，再应用裁剪/遮挡合成场景像素并解码，最后给出结论。
 * 不修改任何标注数据。
 */
export function detectQrForAnnotation(
  image: HTMLImageElement,
  annotation: Annotation,
  cropRect: Rect,
  occluders: Rect[] | null,
  imageW: number,
  imageH: number,
): QrCheckResult {
  // baseline 与 current scene 共用同一个 ROI：
  // 统一 padding 函数 → 对齐整数像素网格（杜绝浮点尺寸造成 canvas 行宽与
  // 遍历行宽不一致、或 drawImage 重采样插值）
  const extractRect = snapRectToPixels(getPaddedQrRect(annotation, imageW, imageH));
  const imageData = extractRoiFromImage(image, extractRect);
  if (!imageData) {
    return buildQrConclusion(null, null);
  }

  const baselineContent = decodeQrPixels(imageData.data, imageData.width, imageData.height);
  const scenarioPixels = applySceneTransform(imageData.data, extractRect, cropRect, occluders);
  const scenarioContent = decodeQrPixels(scenarioPixels, imageData.width, imageData.height);
  return buildQrConclusion(baselineContent, scenarioContent);
}

/**
 * 判断一条标注是否需要执行二维码检测（仅标签为「二维码」时）。
 * 供调用方在批量检测前过滤，避免对其他标签运行昂贵解码。
 */
export function isQrAnnotation(annotation: Annotation): boolean {
  return annotation.label === '二维码';
}

/** 判断标注的提取区域是否仍有意义（面积 > 0 才执行解码） */
export function hasValidExtractArea(extractRect: Rect): boolean {
  return rectArea(extractRect) > 0;
}

/** 二维码画质退化检测结果 */
export interface DegradedQrOutcome {
  /** 画质退化后是否仍可解码 */
  readable: boolean;
  /** 画质退化后解码出的内容（无法识别时为空） */
  content?: string;
  /** 结论（必须来自真实解码，不根据参数猜测） */
  conclusion: DegradedQrConclusion;
}

/**
 * 二维码画质退化检测（第三阶段）：
 * 复用现有 ROI 提取与场景像素合成，scene 像素经「缩小 + JPEG 编解码」后
 * 再次真实调用 jsQR 解码，与 scene 解码结果比较得出结论。
 */
export async function detectDegradedQrForAnnotation(
  image: HTMLImageElement,
  annotation: Annotation,
  cropRect: Rect,
  occluders: Rect[] | null,
  imageW: number,
  imageH: number,
  degradation: { scaleFactor: number; jpegQuality: number },
): Promise<DegradedQrOutcome> {
  const extractRect = snapRectToPixels(getPaddedQrRect(annotation, imageW, imageH));
  const imageData = extractRoiFromImage(image, extractRect);
  if (!imageData) {
    return { readable: false, conclusion: classifyDegradedQr(false, false) };
  }
  const scenePixels = applySceneTransform(imageData.data, extractRect, cropRect, occluders);
  const sceneContent = decodeQrPixels(scenePixels, imageData.width, imageData.height);
  if (sceneContent === null) {
    // scene 已无法识别：不单独归因画质退化
    return { readable: false, conclusion: classifyDegradedQr(false, false) };
  }
  try {
    const degradedCanvas = await degradeScenePixels(
      scenePixels,
      imageData.width,
      imageData.height,
      degradation.scaleFactor,
      degradation.jpegQuality,
    );
    const dctx = degradedCanvas.getContext('2d');
    if (!dctx) {
      return { readable: false, conclusion: classifyDegradedQr(true, false) };
    }
    const degradedData = dctx.getImageData(0, 0, degradedCanvas.width, degradedCanvas.height);
    const degradedContent = decodeQrPixels(degradedData.data, degradedData.width, degradedData.height);
    return {
      readable: degradedContent !== null,
      content: degradedContent ?? undefined,
      conclusion: classifyDegradedQr(true, degradedContent !== null),
    };
  } catch {
    // 编解码异常：按无法识别处理（保守，不抛崩流程）
    return { readable: false, conclusion: classifyDegradedQr(true, false) };
  }
}
