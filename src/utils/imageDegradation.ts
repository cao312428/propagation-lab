/**
 * 画质退化（缩小 + JPEG 有损压缩）压力测试模块。
 *
 * 传播处理顺序：原图 → 当前裁剪 → 可选界面遮挡 → 分辨率缩小 → JPEG 编码/解码。
 * 几何可见率只由「裁剪 + 遮挡」决定，缩放与 JPEG 压缩属于像素质量退化，
 * 不改变任何几何计算结果。
 *
 * 所有参数均为本项目的压力测试参数，不代表任何真实平台的官方压缩规则；
 * JPEG 结果受浏览器编码器实现影响，只用于相对压力测试。
 */
import type { Rect } from '../types';
import { ocrSimilarity } from './textRecognition';
import { applySceneTransform, extractRoiFromImage, snapRectToPixels } from './scenePixels';

/* ------------------------------------------------------------------
 * 参数定义（本项目压力测试参数，非真实平台规则）
 * ------------------------------------------------------------------ */

/** 缩放比例选项（相对当前裁剪场景真实像素尺寸） */
export const SCALE_OPTIONS = [1, 0.75, 0.5, 0.25] as const;

/** JPEG 质量选项（对应 Canvas toBlob 的 quality 参数） */
export const JPEG_QUALITY_OPTIONS = [0.9, 0.7, 0.5, 0.35] as const;

/** 画质退化设置（enabled 为 false 时不做任何退化） */
export interface DegradationSettings {
  enabled: boolean;
  scaleFactor: number;
  jpegQuality: number;
}

/** 默认设置：关闭 */
export const DEFAULT_DEGRADATION: DegradationSettings = {
  enabled: false,
  scaleFactor: 0.5,
  jpegQuality: 0.7,
};

/** 参数免责说明（界面常驻） */
export const DEGRADATION_PARAM_NOTE =
  '缩放比例和JPEG质量为本项目压力测试参数，不代表任何真实平台的官方压缩规则。';

/** JPEG 编码器说明（界面常驻） */
export const JPEG_ENCODER_NOTE =
  'JPEG结果受浏览器编码器实现影响，因此用于相对压力测试，不等同于具体平台的压缩结果。';

/* ------------------------------------------------------------------
 * 纯函数部分（可单元测试）
 * ------------------------------------------------------------------ */

/**
 * 计算退化后的目标尺寸。
 * 取整规则：四舍五入（Math.round），最小 1px，保证规则稳定可预期。
 */
export function computeDegradedDimensions(
  width: number,
  height: number,
  scaleFactor: number,
): { w: number; h: number } {
  return {
    w: Math.max(1, Math.round(width * scaleFactor)),
    h: Math.max(1, Math.round(height * scaleFactor)),
  };
}

/** 解析生效的画质退化参数：关闭时返回 null（视为无退化，保持现有行为完全一致） */
export function resolveActiveDegradation(
  settings: DegradationSettings,
): { scaleFactor: number; jpegQuality: number } | null {
  if (!settings.enabled) return null;
  return { scaleFactor: settings.scaleFactor, jpegQuality: settings.jpegQuality };
}

/** 缩放比例 → 界面文案（0.5 → "50%"） */
export function formatScalePercent(scaleFactor: number): string {
  return `${Math.round(scaleFactor * 100)}%`;
}

/** JPEG 质量 → 界面文案（0.9 → "90%"） */
export function formatJpegQualityPercent(quality: number): string {
  return `${Math.round(quality * 100)}%`;
}

/**
 * 把 RGBA 像素按 alpha 通道合成到白色背景（JPEG 不支持透明通道）。
 * 纯函数：输出与输入同尺寸、alpha 全部为 255。
 */
export function compositeRgbaOnWhite(
  data: Uint8ClampedArray<ArrayBuffer>,
  width: number,
  height: number,
): Uint8ClampedArray<ArrayBuffer> {
  void width;
  void height;
  const out = new Uint8ClampedArray(data.length);
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3] / 255;
    out[i] = Math.round(data[i] * alpha + 255 * (1 - alpha));
    out[i + 1] = Math.round(data[i + 1] * alpha + 255 * (1 - alpha));
    out[i + 2] = Math.round(data[i + 2] * alpha + 255 * (1 - alpha));
    out[i + 3] = 255;
  }
  return out;
}

/* ------------------------------------------------------------------
 * 二维码画质退化结论
 * ------------------------------------------------------------------ */

/** 二维码画质退化结论 */
export type DegradedQrConclusion =
  | '画质退化后二维码仍可识别'
  | '画质退化后二维码识别失败'
  | '当前裁剪/遮挡场景已无法识别二维码，无法单独判断画质退化影响';

/**
 * 二维码画质退化结论（必须基于真实解码结果，不根据参数猜测）：
 * A. scene 可识别 + degraded 可识别 → 画质退化后二维码仍可识别；
 * B. scene 可识别 + degraded 无法识别 → 画质退化后二维码识别失败；
 * C. scene 已无法识别 → 无法单独判断画质退化影响。
 */
export function classifyDegradedQr(
  sceneReadable: boolean,
  degradedReadable: boolean,
): DegradedQrConclusion {
  if (!sceneReadable) {
    return '当前裁剪/遮挡场景已无法识别二维码，无法单独判断画质退化影响';
  }
  return degradedReadable ? '画质退化后二维码仍可识别' : '画质退化后二维码识别失败';
}

/* ------------------------------------------------------------------
 * OCR 画质退化结论
 * ------------------------------------------------------------------ */

/** OCR 画质退化结论（优先比较 scene vs degradedScene） */
export type DegradedOcrStatus =
  | '画质退化后OCR文本保持一致'
  | '画质退化后OCR文本发生变化'
  | '画质退化后未能识别文字'
  | '当前裁剪/遮挡场景已无法正常识别文字，无法单独判断画质退化影响。';

/**
 * OCR 画质退化结论（输入为标准化后的 scene / degradedScene 文本）：
 * scene 无文本 → 不归因于画质退化；
 * 其余按「一致 / 变化 / degraded 无文本」分类，相似度沿用 OCR 文本相似度口径。
 */
export function classifyDegradedOcr(
  sceneNormalized: string,
  degradedNormalized: string,
): { status: DegradedOcrStatus; similarity: number | null } {
  if (sceneNormalized === '') {
    return {
      status: '当前裁剪/遮挡场景已无法正常识别文字，无法单独判断画质退化影响。',
      similarity: null,
    };
  }
  if (degradedNormalized === '') {
    return { status: '画质退化后未能识别文字', similarity: 0 };
  }
  if (degradedNormalized === sceneNormalized) {
    return { status: '画质退化后OCR文本保持一致', similarity: 1 };
  }
  return {
    status: '画质退化后OCR文本发生变化',
    similarity: ocrSimilarity(sceneNormalized, degradedNormalized),
  };
}

/* ------------------------------------------------------------------
 * 浏览器部分：scene 像素 → 缩小 → JPEG 编解码
 * ------------------------------------------------------------------ */

/**
 * 缩放 + JPEG 编解码：把源画布按 scaleFactor 缩小后，
 * 用浏览器原生 toBlob('image/jpeg', quality) 编码，再解码回画布像素。
 * 不增加任何额外 JPEG 编码依赖。
 */
export async function encodeDecodeJpeg(
  source: HTMLCanvasElement,
  scaleFactor: number,
  jpegQuality: number,
): Promise<HTMLCanvasElement> {
  const dims = computeDegradedDimensions(source.width, source.height, scaleFactor);
  // 缩小到目标尺寸（浏览器插值采样；100% 时不做缩放只做 JPEG 压缩）
  const scaled = document.createElement('canvas');
  scaled.width = dims.w;
  scaled.height = dims.h;
  const sctx = scaled.getContext('2d');
  if (!sctx) throw new Error('Canvas 2D 上下文不可用');
  sctx.drawImage(source, 0, 0, dims.w, dims.h);

  const blob = await new Promise<Blob | null>((resolve) =>
    scaled.toBlob((b) => resolve(b), 'image/jpeg', jpegQuality),
  );
  if (!blob) throw new Error('JPEG 编码失败');

  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('JPEG 解码失败'));
      img.src = url;
    });
    const out = document.createElement('canvas');
    out.width = img.naturalWidth;
    out.height = img.naturalHeight;
    const octx = out.getContext('2d');
    if (!octx) throw new Error('Canvas 2D 上下文不可用');
    octx.drawImage(img, 0, 0);
    return out;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * 生成退化后的场景画布：
 * scene 像素 → 白色背景合成（JPEG 无透明通道）→ 缩小 → JPEG 编解码。
 */
export async function degradeScenePixels(
  scenePixels: Uint8ClampedArray<ArrayBuffer>,
  width: number,
  height: number,
  scaleFactor: number,
  jpegQuality: number,
): Promise<HTMLCanvasElement> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D 上下文不可用');
  // 先铺白色背景再叠像素（JPEG 不支持透明通道，透明区域合成白底）
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.putImageData(new ImageData(scenePixels, width, height), 0, 0);
  return encodeDecodeJpeg(canvas, scaleFactor, jpegQuality);
}

/**
 * 生成整个当前场景的退化预览（用于「画质退化结果」展示）：
 * 从原图按裁剪区提取真实场景像素 → 应用遮挡 → 退化。
 * 不依赖右侧 UI 缩略图；返回 objectURL 与退化后尺寸。
 */
export async function buildDegradedScenePreview(
  image: HTMLImageElement,
  cropRect: Rect,
  occluders: Rect[] | null,
  scaleFactor: number,
  jpegQuality: number,
): Promise<{ url: string; width: number; height: number } | null> {
  const rect = snapRectToPixels(cropRect);
  const imageData = extractRoiFromImage(image, rect);
  if (!imageData) return null;
  const scenePixels = applySceneTransform(imageData.data, rect, cropRect, occluders);
  const canvas = await degradeScenePixels(
    scenePixels,
    imageData.width,
    imageData.height,
    scaleFactor,
    jpegQuality,
  );
  const url = canvas.toDataURL('image/jpeg');
  return { url, width: canvas.width, height: canvas.height };
}
