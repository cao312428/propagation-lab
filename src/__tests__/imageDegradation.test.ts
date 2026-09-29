/**
 * 画质退化（缩小 + JPEG 有损压缩）压力测试的纯逻辑单元测试。
 * 不运行真实浏览器 JPEG 编解码（由人工验收），Canvas/JPEG 浏览器 API 已与纯逻辑分离。
 * 覆盖：尺寸计算 / 参数格式化 / 关闭时无退化 / 白底合成 /
 *       二维码退化结论 / OCR 退化结论 / 退化参数变化使 OCR 结果过期。
 */
import { describe, expect, it } from 'vitest';
import {
  classifyDegradedOcr,
  classifyDegradedQr,
  compositeRgbaOnWhite,
  computeDegradedDimensions,
  formatJpegQualityPercent,
  formatScalePercent,
  resolveActiveDegradation,
  DEFAULT_DEGRADATION,
} from '../utils/imageDegradation';
import { isOcrResultStale } from '../utils/textRecognition';

describe('computeDegradedDimensions：退化后尺寸', () => {
  it('100% 缩放：尺寸保持不变', () => {
    expect(computeDegradedDimensions(608, 1080, 1)).toEqual({ w: 608, h: 1080 });
  });

  it('50% 缩放：宽高各减半', () => {
    expect(computeDegradedDimensions(608, 1080, 0.5)).toEqual({ w: 304, h: 540 });
  });

  it('25% 缩放：宽高为四分之一', () => {
    expect(computeDegradedDimensions(608, 1080, 0.25)).toEqual({ w: 152, h: 270 });
  });

  it('奇数尺寸：四舍五入取整规则稳定（0.5 向正无穷进位）', () => {
    expect(computeDegradedDimensions(601, 1081, 0.5)).toEqual({ w: 301, h: 541 });
  });

  it('过小尺寸：结果不小于 1px', () => {
    expect(computeDegradedDimensions(3, 4, 0.25)).toEqual({ w: 1, h: 1 });
  });
});

describe('参数格式化与开关', () => {
  it('JPEG 质量参数正确转换为百分比文案（0.9 → 90%）', () => {
    expect(formatJpegQualityPercent(0.9)).toBe('90%');
    expect(formatJpegQualityPercent(0.7)).toBe('70%');
    expect(formatJpegQualityPercent(0.5)).toBe('50%');
    expect(formatJpegQualityPercent(0.35)).toBe('35%');
  });

  it('缩放比例正确转换为百分比文案（0.5 → 50%）', () => {
    expect(formatScalePercent(1)).toBe('100%');
    expect(formatScalePercent(0.75)).toBe('75%');
    expect(formatScalePercent(0.5)).toBe('50%');
    expect(formatScalePercent(0.25)).toBe('25%');
  });

  it('功能关闭时返回 null（保持现有行为完全一致，不做任何退化）', () => {
    expect(resolveActiveDegradation({ ...DEFAULT_DEGRADATION, enabled: false })).toBeNull();
    const active = resolveActiveDegradation({
      enabled: true,
      scaleFactor: 0.5,
      jpegQuality: 0.7,
    });
    expect(active).toEqual({ scaleFactor: 0.5, jpegQuality: 0.7 });
  });
});

describe('compositeRgbaOnWhite：JPEG 前的白色背景合成（无透明通道）', () => {
  it('半透明像素按 alpha 与白色混合，alpha 置为 255', () => {
    const px = Uint8ClampedArray.from([255, 0, 0, 128]);
    const out = compositeRgbaOnWhite(px, 1, 1);
    expect(out[0]).toBe(255); // 红 128 + 白 127
    expect(out[1]).toBe(127);
    expect(out[2]).toBe(127);
    expect(out[3]).toBe(255);
  });

  it('全透明像素合成后为纯白', () => {
    const px = Uint8ClampedArray.from([10, 20, 30, 0]);
    const out = compositeRgbaOnWhite(px, 1, 1);
    expect(Array.from(out.slice(0, 4))).toEqual([255, 255, 255, 255]);
  });

  it('完全不透明像素保持原色', () => {
    const px = Uint8ClampedArray.from([10, 20, 30, 255]);
    const out = compositeRgbaOnWhite(px, 1, 1);
    expect(Array.from(out.slice(0, 4))).toEqual([10, 20, 30, 255]);
  });
});

describe('classifyDegradedQr：二维码画质退化结论（基于真实解码结果）', () => {
  it('scene 可识别 + degraded 可识别 → 画质退化后二维码仍可识别', () => {
    expect(classifyDegradedQr(true, true)).toBe('画质退化后二维码仍可识别');
  });

  it('scene 可识别 + degraded 无法识别 → 画质退化后二维码识别失败', () => {
    expect(classifyDegradedQr(true, false)).toBe('画质退化后二维码识别失败');
  });

  it('scene 已无法识别 → 不归因于画质退化', () => {
    expect(classifyDegradedQr(false, false)).toBe(
      '当前裁剪/遮挡场景已无法识别二维码，无法单独判断画质退化影响',
    );
    expect(classifyDegradedQr(false, true)).toBe(
      '当前裁剪/遮挡场景已无法识别二维码，无法单独判断画质退化影响',
    );
  });
});

describe('classifyDegradedOcr：OCR 画质退化结论（优先比较 scene vs degradedScene）', () => {
  it('scene 与 degradedScene 文本一致 → 画质退化后OCR文本保持一致', () => {
    const r = classifyDegradedOcr('2026年10月15日', '2026年10月15日');
    expect(r.status).toBe('画质退化后OCR文本保持一致');
    expect(r.similarity).toBe(1);
  });

  it('scene 与 degradedScene 文本不同 → 画质退化后OCR文本发生变化（附相似度）', () => {
    const r = classifyDegradedOcr('2026年10月15日', '2026年10月1日');
    expect(r.status).toBe('画质退化后OCR文本发生变化');
    expect(r.similarity).toBeCloseTo(10 / 11, 10);
  });

  it('scene 无文本 → 不归因于画质退化', () => {
    const r = classifyDegradedOcr('', '任何文本');
    expect(r.status).toBe(
      '当前裁剪/遮挡场景已无法正常识别文字，无法单独判断画质退化影响。',
    );
    expect(r.similarity).toBeNull();
  });

  it('degradedScene 无文本 → 画质退化后未能识别文字', () => {
    const r = classifyDegradedOcr('2026年10月15日', '');
    expect(r.status).toBe('画质退化后未能识别文字');
    expect(r.similarity).toBe(0);
  });
});

describe('OCR 结果过期：画质退化参数变化', () => {
  const image = {};
  const ann: unknown[] = [];
  const degA = { scaleFactor: 0.5, jpegQuality: 0.7 };
  const degB = { scaleFactor: 0.25, jpegQuality: 0.7 };

  it('退化参数未变化 → 未过期', () => {
    const fp = {
      image,
      cropRatio: '1:1' as const,
      occlusionEnabled: false,
      annotations: ann,
      degradation: degA,
    };
    expect(isOcrResultStale(fp, { ...fp })).toBe(false);
  });

  it('缩放比例变化 → 过期', () => {
    const fp = {
      image,
      cropRatio: '1:1' as const,
      occlusionEnabled: false,
      annotations: ann,
      degradation: degA,
    };
    expect(
      isOcrResultStale(fp, {
        image,
        cropRatio: '1:1',
        occlusionEnabled: false,
        annotations: ann,
        degradation: degB,
      }),
    ).toBe(true);
  });

  it('JPEG 质量变化（新引用）→ 过期', () => {
    const fp = {
      image,
      cropRatio: '1:1' as const,
      occlusionEnabled: false,
      annotations: ann,
      degradation: degA,
    };
    expect(
      isOcrResultStale(fp, {
        image,
        cropRatio: '1:1',
        occlusionEnabled: false,
        annotations: ann,
        degradation: { scaleFactor: 0.5, jpegQuality: 0.35 },
      }),
    ).toBe(true);
  });
});
