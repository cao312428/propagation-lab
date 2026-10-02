/**
 * OCR 图像预处理模块（轻量，无 OpenCV 等重量级依赖）。
 *
 * 只做轻量预处理，提升小区域文字的可识别性：
 * - 小区域适当放大（2x / 3x）；
 * - 灰度化；
 * - 适度对比度增强（1% 百分位线性拉伸）。
 *
 * 执行策略：原始提取 OCR + 预处理 OCR 双跑，
 * 两者都有文本时优先选择置信度更高的结果；预处理更差时保留原始结果。
 * 预处理只改变「送入 OCR 的像素」，不修改任何标注数据与原图坐标。
 */

/* ------------------------------------------------------------------
 * 预处理参数（本项目压力测试产品规则，非行业标准）
 * ------------------------------------------------------------------ */

/** ROI 短边低于该值（px）时放大 3 倍 */
export const OCR_UPSCALE_3X_THRESHOLD_PX = 80;

/** ROI 短边低于该值（px）时放大 2 倍 */
export const OCR_UPSCALE_2X_THRESHOLD_PX = 160;

/** 对比度增强的百分位裁剪比例（两侧各裁 1%，抑制纯黑/纯白噪声点） */
export const OCR_CONTRAST_CLIP_RATIO = 0.01;

/** 预处理计划：放大倍数与是否灰度化（大区域也统一灰度 + 增强，保持口径一致） */
export interface OcrPreprocessPlan {
  /** 放大倍数（1 = 不放大，仅灰度 + 对比度增强） */
  scaleFactor: 1 | 2 | 3;
  /** 是否灰度化（当前策略恒为 true，保留字段便于规则调整） */
  grayscale: boolean;
}

/**
 * 按 ROI 尺寸计算预处理计划（纯函数，只依赖尺寸，不接触任何标注数据）：
 * 短边 < 80px → 3x；短边 < 160px → 2x；否则 1x。
 */
export function computeOcrPreprocessPlan(roiW: number, roiH: number): OcrPreprocessPlan {
  const minSide = Math.min(roiW, roiH);
  let scaleFactor: 1 | 2 | 3 = 1;
  if (minSide < OCR_UPSCALE_3X_THRESHOLD_PX) scaleFactor = 3;
  else if (minSide < OCR_UPSCALE_2X_THRESHOLD_PX) scaleFactor = 2;
  return { scaleFactor, grayscale: true };
}

/**
 * 灰度化 + 对比度增强（纯函数，返回新数组，不修改输入）：
 * 1. 灰度化（Rec. 601 亮度公式）；
 * 2. 计算亮度直方图的 1% / 99% 分位；
 * 3. 线性拉伸到 0～255（分位相等时跳过，避免除零）。
 */
export function preprocessOcrPixels(
  data: Uint8ClampedArray<ArrayBuffer>,
  width: number,
  height: number,
): Uint8ClampedArray<ArrayBuffer> {
  const total = width * height;
  if (total === 0) return new Uint8ClampedArray(0);

  // 第一步：灰度化，并收集亮度直方图
  const gray = new Uint8ClampedArray(total);
  const hist = new Uint32Array(256);
  for (let i = 0; i < total; i++) {
    const p = i * 4;
    const lum = Math.round(0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2]);
    gray[i] = lum;
    hist[lum] += 1;
  }

  // 第二步：1% / 99% 分位（两侧各裁 1%）
  const clipCount = total * OCR_CONTRAST_CLIP_RATIO;
  let low = 0;
  let acc = 0;
  while (low < 255 && acc + hist[low] < clipCount) {
    acc += hist[low];
    low += 1;
  }
  let high = 255;
  acc = 0;
  while (high > 0 && acc + hist[high] < clipCount) {
    acc += hist[high];
    high -= 1;
  }
  if (high <= low) {
    // 直方图几乎集中在单一亮度（如纯色图）：不拉伸，恒等映射，避免除零
    low = 0;
    high = 255;
  }

  // 第三步：线性拉伸（LUT），输出为 RGBA（灰度值填满 RGB，alpha 255）
  const lut = new Uint8ClampedArray(256);
  const range = high - low;
  for (let v = 0; v < 256; v++) {
    const clamped = Math.max(0, Math.min(255, Math.round(((v - low) * 255) / range)));
    lut[v] = clamped;
  }
  const out = new Uint8ClampedArray(data.length);
  for (let i = 0; i < total; i++) {
    const v = lut[gray[i]];
    const p = i * 4;
    out[p] = v;
    out[p + 1] = v;
    out[p + 2] = v;
    out[p + 3] = 255;
  }
  return out;
}

/* ------------------------------------------------------------------
 * 浏览器部分：构建预处理后的 OCR 画布
 * ------------------------------------------------------------------ */

/**
 * 按计划构建预处理后的识别画布：
 * 先执行灰度 + 对比度增强，再按倍数放大（drawImage 高质量缩放）。
 * 输出尺寸 = 输入尺寸 × scaleFactor（见 computeOcrPreprocessPlan）。
 * 失败（无 2D 上下文）返回 null，由调用方回退到原始画布。
 */
export function buildPreprocessedOcrCanvas(
  canvas: HTMLCanvasElement,
  plan: OcrPreprocessPlan = computeOcrPreprocessPlan(canvas.width, canvas.height),
): HTMLCanvasElement | null {
  const srcCtx = canvas.getContext('2d');
  if (!srcCtx) return null;
  const source = srcCtx.getImageData(0, 0, canvas.width, canvas.height);
  const processed = preprocessOcrPixels(source.data, source.width, source.height);

  const outW = Math.max(1, canvas.width * plan.scaleFactor);
  const outH = Math.max(1, canvas.height * plan.scaleFactor);
  const out = document.createElement('canvas');
  out.width = outW;
  out.height = outH;
  const outCtx = out.getContext('2d');
  if (!outCtx) return null;
  if (plan.scaleFactor === 1) {
    outCtx.putImageData(new ImageData(processed, outW, outH), 0, 0);
  } else {
    // 放大：先把处理后的像素放到原始尺寸画布，再高质量缩放
    const temp = document.createElement('canvas');
    temp.width = canvas.width;
    temp.height = canvas.height;
    const tempCtx = temp.getContext('2d');
    if (!tempCtx) return null;
    tempCtx.putImageData(new ImageData(processed, canvas.width, canvas.height), 0, 0);
    outCtx.imageSmoothingEnabled = true;
    outCtx.imageSmoothingQuality = 'high';
    outCtx.drawImage(temp, 0, 0, outW, outH);
  }
  return out;
}

/* ------------------------------------------------------------------
 * original / preprocessed 选择策略（纯函数）
 * ------------------------------------------------------------------ */

/** 一次 OCR 识别（文本 + 置信度 + 来源） */
export interface OcrRecognition {
  text: string;
  /** OCR 引擎置信度（0～100）；引擎未提供时为 null，不虚构 */
  confidence: number | null;
  source: 'original' | 'preprocessed';
}

/**
 * 从原始与预处理两次识别中选择最终结果（产品规则）：
 * - 两者都有文本 → 置信度高者胜；置信度缺失（null）按较低处理，平手保留原始；
 * - 一方有文本 → 有文本者胜；
 * - 都无文本 → 保留原始（保持旧行为）。
 */
export function selectOcrRecognition(
  original: OcrRecognition,
  preprocessed: OcrRecognition,
): OcrRecognition {
  const originalHasText = original.text.trim() !== '';
  const preprocessedHasText = preprocessed.text.trim() !== '';
  if (originalHasText && preprocessedHasText) {
    const a = original.confidence ?? -1;
    const b = preprocessed.confidence ?? -1;
    return b > a ? preprocessed : original;
  }
  if (!originalHasText && preprocessedHasText) return preprocessed;
  return original;
}
