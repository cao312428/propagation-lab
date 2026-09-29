/**
 * 通用场景像素工具：按原图坐标 1:1 提取 ROI 像素，
 * 并应用「裁剪 + 界面遮挡」效果合成当前传播场景像素。
 * 二维码检测与文字 OCR 共用本模块，保证两条链路像素处理完全一致；
 * 与屏幕显示尺寸无关（不使用任何 UI 缩略尺寸）。
 */
import type { Rect } from '../types';

/** 场景合成中「被裁剪掉」的像素填充色：白色（视为空白，不参与识别） */
export const CROPPED_FILL: [number, number, number] = [255, 255, 255];

/** 场景合成中「被界面遮挡覆盖」的像素填充色：#111827（与界面遮挡的视觉颜色一致） */
export const OCCLUDED_FILL: [number, number, number] = [17, 24, 39];

/**
 * 把 ROI 对齐到整数像素网格。
 * 标注坐标来自鼠标反算，通常是浮点数；若直接用浮点 ROI：
 * - canvas.width 赋值会向零取整（浏览器规范），而下游若按四舍五入遍历，
 *   两者在小数 ≥ 0.5 时差 1px，导致整幅像素行宽错位；
 * - drawImage 的浮点源区域会触发重采样插值，不能保证 1:1 像素复制。
 * 因此提取前必须对齐：x / y 四舍五入，
 * 宽高用 round(右边界) - round(左边界) 计算，保证与像素网格严格一致。
 */
export function snapRectToPixels(rect: Rect): Rect {
  const x = Math.round(rect.x);
  const y = Math.round(rect.y);
  return {
    x,
    y,
    w: Math.round(rect.x + rect.w) - x,
    h: Math.round(rect.y + rect.h) - y,
  };
}

/**
 * 场景像素合成（纯函数）：输入提取区域的原始像素（与提取区域 1:1 对应，
 * 像素 (px, py) 的原图坐标为 extractRect.x + px / extractRect.y + py），
 * 按当前裁剪区与遮挡矩形处理：
 * - 位于裁剪区外的像素涂成白色（被裁掉，不参与识别）；
 * - 被界面遮挡覆盖的像素涂成 #111827（被遮住，不参与识别）。
 * 返回新的像素数组，不修改输入。
 *
 * 注意：extractRect 必须已用 snapRectToPixels 对齐整数像素网格（w / h 为整数），
 * 且与 pixels 的实际行宽一致；此处不再对宽高做任何取整。
 */
export function applySceneTransform(
  pixels: Uint8ClampedArray<ArrayBuffer>,
  extractRect: Rect,
  cropRect: Rect,
  occluders: Rect[] | null,
): Uint8ClampedArray<ArrayBuffer> {
  const width = extractRect.w;
  const height = extractRect.h;
  const out = pixels.slice();
  for (let py = 0; py < height; py++) {
    const gy = extractRect.y + py;
    const croppedY = gy < cropRect.y || gy >= cropRect.y + cropRect.h;
    for (let px = 0; px < width; px++) {
      const gx = extractRect.x + px;
      const i = (py * width + px) * 4;
      // 被裁剪：涂白
      if (croppedY || gx < cropRect.x || gx >= cropRect.x + cropRect.w) {
        out[i] = CROPPED_FILL[0];
        out[i + 1] = CROPPED_FILL[1];
        out[i + 2] = CROPPED_FILL[2];
        continue;
      }
      // 被界面遮挡：涂深灰（遮挡均位于裁剪区内，故先判裁剪再判遮挡）
      if (
        occluders &&
        occluders.some(
          (o) => gx >= o.x && gx < o.x + o.w && gy >= o.y && gy < o.y + o.h,
        )
      ) {
        out[i] = OCCLUDED_FILL[0];
        out[i + 1] = OCCLUDED_FILL[1];
        out[i + 2] = OCCLUDED_FILL[2];
      }
    }
  }
  return out;
}

/**
 * 从原图按 ROI（原图坐标）提取像素（1:1、无插值、无缩放）。
 * rect 必须已对齐整数像素网格（见 snapRectToPixels）。
 * 失败（无 2D 上下文 / 提取异常）返回 null，由调用方决定如何提示。
 */
export function extractRoiFromImage(image: HTMLImageElement, rect: Rect): ImageData | null {
  const canvas = document.createElement('canvas');
  canvas.width = rect.w;
  canvas.height = rect.h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  // 关闭平滑：整数源区域 1:1 复制，保证提取像素与原图逐像素一致
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(image, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
  try {
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  } catch {
    return null;
  }
}

/**
 * 把 RGBA 像素画到新 canvas 上（供只接受 canvas 输入的识别器使用）。
 */
export function imageDataToCanvas(
  data: Uint8ClampedArray<ArrayBuffer>,
  width: number,
  height: number,
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx?.putImageData(new ImageData(data, width, height), 0, 0);
  return canvas;
}
