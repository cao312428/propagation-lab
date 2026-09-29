/**
 * 二维码可识别性压力测试的单元测试。
 * 测试图片由 qrcode 库程序化生成（本地固定内容，不使用网络图片）。
 * 覆盖：完整有效二维码解码 / 非二维码图片无法解码 /
 *       二维码完整处于裁剪区内（场景仍可识别）/
 *       二维码被明显裁掉一部分（场景无法识别）/
 *       二维码被大面积遮挡（场景无法识别）/
 *       基线无法识别时不误判为「传播导致失效」/
 *       提取区域 padding 规则 / 场景像素涂色 / 内容截断。
 */
import { describe, expect, it } from 'vitest';
import QRCode from 'qrcode';
import {
  applySceneTransform,
  buildQrConclusion,
  decodeQrPixels,
  formatQrContent,
  getPaddedQrRect,
  snapRectToPixels,
} from '../utils/qrDetection';
import { computeCenterCrop } from '../utils/crop';

/** 测试用二维码内容（短文本，version 2） */
const QR_TEXT = 'spread-lab-test';

/** 程序化生成一张二维码的 RGBA 像素（黑模块 = 0，白模块 = 255）。
 * 注意：qrcode 的 create() 生成的模块矩阵不含静区，这里自行补 4 模块白边。 */
function makeQrPixels(
  text: string,
  moduleSize = 6,
): { pixels: Uint8ClampedArray<ArrayBuffer>; size: number } {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const matrixSize = qr.modules.size; // 纯模块矩阵（无静区）
  const margin = 4; // 自补静区（4 模块）
  const size = (matrixSize + margin * 2) * moduleSize;
  const pixels = new Uint8ClampedArray(size * size * 4).fill(255); // 白色底
  for (let y = 0; y < matrixSize * moduleSize; y++) {
    for (let x = 0; x < matrixSize * moduleSize; x++) {
      const dark = qr.modules.get(Math.floor(y / moduleSize), Math.floor(x / moduleSize));
      if (!dark) continue;
      const i = ((y + margin * moduleSize) * size + (x + margin * moduleSize)) * 4;
      pixels[i] = 0;
      pixels[i + 1] = 0;
      pixels[i + 2] = 0;
    }
  }
  return { pixels, size };
}

describe('decodeQrPixels：本地像素解码', () => {
  it('完整有效二维码可以解码出内容', () => {
    const { pixels, size } = makeQrPixels(QR_TEXT);
    expect(decodeQrPixels(pixels, size, size)).toBe(QR_TEXT);
  });

  it('纯白图片（非二维码）无法解码', () => {
    const blank = new Uint8ClampedArray(100 * 100 * 4).fill(255);
    expect(decodeQrPixels(blank, 100, 100)).toBeNull();
  });

  it('棋盘格纹理（非二维码）无法解码', () => {
    const checker = new Uint8ClampedArray(100 * 100 * 4);
    for (let y = 0; y < 100; y++) {
      for (let x = 0; x < 100; x++) {
        const v = (x + y) % 2 === 0 ? 0 : 255;
        const i = (y * 100 + x) * 4;
        checker[i] = v;
        checker[i + 1] = v;
        checker[i + 2] = v;
        checker[i + 3] = 255;
      }
    }
    expect(decodeQrPixels(checker, 100, 100)).toBeNull();
  });
});

describe('applySceneTransform + decodeQrPixels：当前传播场景检测', () => {
  // 二维码完整像素 + 它在原图中的位置（提取区域）
  const { pixels, size } = makeQrPixels(QR_TEXT);
  const extractRect = { x: 100, y: 100, w: size, h: size };

  it('二维码完整处于裁剪区域内（无遮挡）：场景仍可识别', () => {
    // 裁剪区覆盖整个提取区域
    const crop = { x: 0, y: 0, w: size + 200, h: size + 200 };
    const scene = applySceneTransform(pixels, extractRect, crop, null);
    expect(decodeQrPixels(scene, size, size)).toBe(QR_TEXT);
  });

  it('二维码被明显裁掉一部分（右半在裁剪区外）：场景无法识别', () => {
    // 裁剪区只覆盖提取区域的左半，右半被涂白（右侧定位图案被毁）
    const crop = { x: extractRect.x, y: extractRect.y, w: size / 2, h: size };
    const scene = applySceneTransform(pixels, extractRect, crop, null);
    expect(decodeQrPixels(scene, size, size)).toBeNull();
  });

  it('二维码被大面积遮挡（右上角被界面遮挡覆盖）：场景无法识别', () => {
    const crop = { x: 0, y: 0, w: 1000, h: 1000 }; // 裁剪区覆盖整个提取区域
    // 遮挡覆盖右上角（宽 40%、高 50%），包含右上定位图案
    const occluders = [
      { x: extractRect.x + size * 0.6, y: extractRect.y, w: size * 0.4, h: size * 0.5 },
    ];
    const scene = applySceneTransform(pixels, extractRect, crop, occluders);
    expect(decodeQrPixels(scene, size, size)).toBeNull();
  });

  it('合成场景像素不修改输入数组', () => {
    const crop = { x: 0, y: 0, w: 1000, h: 1000 };
    const occluders = [{ x: extractRect.x, y: extractRect.y, w: 10, h: 10 }];
    const before = pixels.slice();
    applySceneTransform(pixels, extractRect, crop, occluders);
    expect(pixels).toEqual(before);
  });
});

describe('applySceneTransform：失效像素涂色（裁剪涂白、遮挡涂灰）', () => {
  // 4×4 像素，全为 42（灰）
  const px = new Uint8ClampedArray(4 * 4 * 4).fill(42);
  const extractRect = { x: 0, y: 0, w: 4, h: 4 };
  const crop = { x: 0, y: 0, w: 2, h: 4 }; // 右两列在裁剪区外
  const occluders = [{ x: 1, y: 2, w: 2, h: 2 }]; // 右下 2×2

  it('裁剪区外的像素涂成白色', () => {
    const out = applySceneTransform(px, extractRect, crop, occluders);
    // 像素 (2, 0)：gx = 2，在裁剪区外
    const i = (0 * 4 + 2) * 4;
    expect(out[i]).toBe(255);
    expect(out[i + 1]).toBe(255);
    expect(out[i + 2]).toBe(255);
  });

  it('遮挡覆盖的像素涂成深灰 #111827', () => {
    const out = applySceneTransform(px, extractRect, crop, occluders);
    // 像素 (1, 2)：gx = 1 在裁剪区内，且位于遮挡内
    const i = (2 * 4 + 1) * 4;
    expect(out[i]).toBe(17);
    expect(out[i + 1]).toBe(24);
    expect(out[i + 2]).toBe(39);
  });

  it('既未裁剪也未遮挡的像素保持原值', () => {
    const out = applySceneTransform(px, extractRect, crop, occluders);
    // 像素 (0, 0)：在裁剪区内、不在遮挡内
    expect(out[0]).toBe(42);
  });
});

describe('buildQrConclusion：A / B / C 结论', () => {
  it('原图可识别 + 场景可识别 → 当前场景下二维码仍可识别', () => {
    const r = buildQrConclusion('x', 'x');
    expect(r.baselineReadable).toBe(true);
    expect(r.scenarioReadable).toBe(true);
    expect(r.conclusion).toBe('当前场景下二维码仍可识别');
  });

  it('原图可识别 + 场景无法识别 → 传播处理后二维码识别失败', () => {
    const r = buildQrConclusion('x', null);
    expect(r.conclusion).toBe('传播处理后二维码识别失败');
  });

  it('原图无法识别：无论场景如何都不误判为「传播导致失效」', () => {
    const r = buildQrConclusion(null, null);
    expect(r.baselineReadable).toBe(false);
    expect(r.conclusion).toBe('原图二维码未能成功识别，无法据此判断传播处理是否导致失效');
    // 即使场景恰好解码成功（异常情况），基线失败时结论仍为 C
    const r2 = buildQrConclusion(null, 'x');
    expect(r2.conclusion).toBe('原图二维码未能成功识别，无法据此判断传播处理是否导致失效');
  });
});

describe('getPaddedQrRect：提取区域 padding 规则（baseline 与场景共用的统一函数）', () => {
  it('常规标注：四周各加边长的 10%', () => {
    const r = getPaddedQrRect({ x: 100, y: 100, w: 100, h: 100 }, 1000, 1000);
    expect(r).toEqual({ x: 90, y: 90, w: 120, h: 120 });
  });

  it('小标注：使用最小 padding 8px', () => {
    const r = getPaddedQrRect({ x: 100, y: 100, w: 20, h: 20 }, 1000, 1000);
    expect(r).toEqual({ x: 92, y: 92, w: 36, h: 36 });
  });

  it('大标注：padding 受 64px 上限限制', () => {
    const r = getPaddedQrRect({ x: 400, y: 400, w: 1000, h: 1000 }, 2000, 2000);
    expect(r).toEqual({ x: 336, y: 336, w: 1128, h: 1128 });
  });

  it('靠边标注：提取区域被限制在原图边界内', () => {
    const r = getPaddedQrRect({ x: 0, y: 0, w: 100, h: 100 }, 1000, 1000);
    expect(r).toEqual({ x: 0, y: 0, w: 110, h: 110 });
  });

  it('浮点标注坐标：padding 后仍是浮点 ROI（由 snapRectToPixels 负责对齐）', () => {
    const r = getPaddedQrRect({ x: 123.4, y: 456.7, w: 145.6, h: 180.3 }, 1000, 1000);
    expect(r.x).toBeCloseTo(123.4 - 15, 10); // round(145.6 × 10%) = 15
    expect(r.w).toBeCloseTo(145.6 + 30, 10);
  });
});

describe('snapRectToPixels：ROI 对齐整数像素网格（修复像素行宽错位）', () => {
  it('浮点 ROI 四舍五入对齐，宽高由对齐后的边界相减得出', () => {
    const snapped = snapRectToPixels({ x: 9.4, y: 9.6, w: 180.6, h: 180.4 });
    // 左边界 round(9.4)=9、上边界 round(9.6)=10；右边界 round(190.0)=190 → 宽 181
    expect(snapped).toEqual({ x: 9, y: 10, w: 181, h: 180 });
  });

  it('小数部分 ≥ 0.5 时不再出现行宽错位（canvas 向零取整 vs 四舍五入的差异）', () => {
    // 模拟旧 bug 的触发条件：w 的小数 ≥ 0.5
    const raw = { x: 100.2, y: 100.8, w: 145.6, h: 200.4 };
    const snapped = snapRectToPixels(raw);
    expect(snapped).toEqual({ x: 100, y: 101, w: 146, h: 200 });
    // canvas.width = snapped.w（整数 146），与 applySceneTransform 的遍历行宽完全一致
    expect(Number.isInteger(snapped.w)).toBe(true);
    expect(Number.isInteger(snapped.h)).toBe(true);
  });

  it('整数 ROI 对齐后保持不变', () => {
    expect(snapRectToPixels({ x: 10, y: 20, w: 100, h: 200 })).toEqual({
      x: 10,
      y: 20,
      w: 100,
      h: 200,
    });
  });
});

describe('formatQrContent：识别内容截断显示', () => {
  it('短内容原样显示', () => {
    expect(formatQrContent('short')).toBe('short');
  });

  it('超过 30 字符的内容截断并加省略号（恰好 30 字符不截断）', () => {
    const exact = 'a'.repeat(30);
    expect(formatQrContent(exact)).toBe(exact);
    expect(formatQrContent('a'.repeat(50))).toBe(`${exact}…`);
  });
});

/* ------------------------------------------------------------------
 * 回归测试：模拟真实检测流程（原图 → 统一 padding → 1:1 像素提取 ROI →
 * 场景变换 → 解码），验证 baseline 与 current scene 的一致性。
 * ------------------------------------------------------------------ */

/** 从大图像素中复制 ROI 子区域（模拟 canvas 1:1 提取） */
function extractRoiPixels(
  src: Uint8ClampedArray,
  srcW: number,
  rect: { x: number; y: number; w: number; h: number },
): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(rect.w * rect.h * 4);
  for (let py = 0; py < rect.h; py++) {
    for (let px = 0; px < rect.w; px++) {
      const si = ((rect.y + py) * srcW + (rect.x + px)) * 4;
      const di = (py * rect.w + px) * 4;
      out[di] = src[si];
      out[di + 1] = src[si + 1];
      out[di + 2] = src[si + 2];
      out[di + 3] = src[si + 3];
    }
  }
  return out;
}

/** 构造 198×imageH 竖图：白色底 + 在 offsetY 处放置二维码 */
function buildTallImage(
  qrPixels: Uint8ClampedArray,
  qrSize: number,
  imageH: number,
  offsetY: number,
): Uint8ClampedArray {
  const full = new Uint8ClampedArray(qrSize * imageH * 4).fill(255);
  for (let py = 0; py < qrSize; py++) {
    for (let px = 0; px < qrSize; px++) {
      const si = (py * qrSize + px) * 4;
      const di = ((offsetY + py) * qrSize + px) * 4;
      full[di] = qrPixels[si];
      full[di + 1] = qrPixels[si + 1];
      full[di + 2] = qrPixels[si + 2];
      full[di + 3] = qrPixels[si + 3];
    }
  }
  return full;
}

describe('回归：annotation 紧贴二维码主体（依赖统一 padding 补静区）', () => {
  const moduleSize = 6;
  const { pixels: qrPixels, size } = makeQrPixels(QR_TEXT, moduleSize);
  const marginPx = 4 * moduleSize; // 24px 静区
  const matrixPx = size - marginPx * 2; // 二维码主体 150×150
  // 标注紧贴二维码主体、不含静区（识别必须依赖 padding 补足）
  const annotation = {
    id: 'qr-tight',
    x: marginPx,
    y: marginPx,
    w: matrixPx,
    h: matrixPx,
    label: '二维码' as const,
  };

  it('1:1 完整保留、无遮挡：baseline 与场景都可识别，内容一致，像素完全一致', () => {
    const imageW = size;
    const imageH = size;
    // 统一 padding 函数 + 像素网格对齐（与真实流程一致）
    const extractRect = snapRectToPixels(getPaddedQrRect(annotation, imageW, imageH));
    // 模拟 canvas 1:1 提取
    const roi = extractRoiPixels(qrPixels, size, extractRect);
    const baseline = decodeQrPixels(roi, extractRect.w, extractRect.h);
    // annotation 无静区，能识别说明 padding 生效
    expect(baseline).toBe(QR_TEXT);
    // 1:1 居中裁剪 = 整个图像，标注 100% 在裁剪区内
    const crop = computeCenterCrop(imageW, imageH, 1, 1);
    const scenePixels = applySceneTransform(roi, extractRect, crop, null);
    // 100% 保留且无遮挡：场景像素与基线像素必须完全一致（逐字节）
    expect(scenePixels).toEqual(roi);
    const scene = decodeQrPixels(scenePixels, extractRect.w, extractRect.h);
    expect(scene).toBe(QR_TEXT);
    // 两条链路的内容一致
    expect(scene).toBe(baseline);
  });

  it('9:16 完整保留、无遮挡：场景同样可识别', () => {
    const imageW = size; // 198
    const imageH = 800; // 竖图
    const offsetY = 301; // 二维码（含静区）放在 y 301~499
    const full = buildTallImage(qrPixels, size, imageH, offsetY);
    // 标注在原图中的位置（紧贴主体）
    const a = { ...annotation, y: offsetY + marginPx };
    const extractRect = snapRectToPixels(getPaddedQrRect(a, imageW, imageH));
    const roi = extractRoiPixels(full, imageW, extractRect);
    expect(decodeQrPixels(roi, extractRect.w, extractRect.h)).toBe(QR_TEXT);
    // 9:16 居中裁剪：裁剪区 {0, 224, 198, 352}，二维码 ROI 完整落在其中
    const crop = computeCenterCrop(imageW, imageH, 9, 16);
    const scenePixels = applySceneTransform(roi, extractRect, crop, null);
    expect(decodeQrPixels(scenePixels, extractRect.w, extractRect.h)).toBe(QR_TEXT);
  });

  it('明显裁掉二维码：场景无法识别', () => {
    const imageW = size;
    const imageH = size;
    const extractRect = snapRectToPixels(getPaddedQrRect(annotation, imageW, imageH));
    const roi = extractRoiPixels(qrPixels, size, extractRect);
    expect(decodeQrPixels(roi, extractRect.w, extractRect.h)).toBe(QR_TEXT);
    // 裁剪区只覆盖 ROI 左半 → 右半涂白（右侧定位图案被毁）
    const crop = {
      x: extractRect.x,
      y: extractRect.y,
      w: extractRect.w / 2,
      h: extractRect.h,
    };
    const scenePixels = applySceneTransform(roi, extractRect, crop, null);
    expect(decodeQrPixels(scenePixels, extractRect.w, extractRect.h)).toBeNull();
  });

  it('大面积遮挡二维码：场景无法识别', () => {
    const imageW = size;
    const imageH = size;
    const extractRect = snapRectToPixels(getPaddedQrRect(annotation, imageW, imageH));
    const roi = extractRoiPixels(qrPixels, size, extractRect);
    expect(decodeQrPixels(roi, extractRect.w, extractRect.h)).toBe(QR_TEXT);
    // 无裁剪损失，但遮挡覆盖右上角（含右上定位图案）
    const crop = { x: 0, y: 0, w: imageW, h: imageH };
    const occluders = [
      {
        x: extractRect.x + extractRect.w * 0.6,
        y: extractRect.y,
        w: extractRect.w * 0.4,
        h: extractRect.h * 0.5,
      },
    ];
    const scenePixels = applySceneTransform(roi, extractRect, crop, occluders);
    expect(decodeQrPixels(scenePixels, extractRect.w, extractRect.h)).toBeNull();
  });
});
