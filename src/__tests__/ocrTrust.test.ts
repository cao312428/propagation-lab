/**
 * OCR 可信度增强单元测试（Node 环境纯函数部分，不依赖网络 OCR 模型下载）：
 * - 预处理计划与像素处理（不修改输入、灰度、对比度、放大倍数）
 * - original / preprocessed 选择策略（confidence 高者胜）
 * - 低置信度提示规则
 * - expectedText 与期望文本相似度（未设置时不影响旧流程）
 * - 原「传播前后相似度」算法回归（ocrSimilarity 口径不变）
 */
import { describe, expect, it } from 'vitest';
import {
  computeOcrPreprocessPlan,
  preprocessOcrPixels,
  selectOcrRecognition,
} from '../utils/ocrPreprocess';
import {
  buildOcrResult,
  computeExpectedSimilarity,
  isLowOcrConfidence,
  LOW_OCR_CONFIDENCE_THRESHOLD,
  ocrFailedResult,
  ocrSimilarity,
} from '../utils/textRecognition';
import type { Annotation } from '../types';

/** 构造一条测试标注 */
function makeAnnotation(): Annotation {
  return { id: 'a1', label: '日期', x: 10, y: 10, w: 100, h: 40 };
}

/** 构造 2×2 的 RGBA 像素（纯色） */
function makeSolidPixels(r: number, g: number, b: number): Uint8ClampedArray<ArrayBuffer> {
  const data = new Uint8ClampedArray(4 * 4);
  for (let i = 0; i < 4; i++) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  }
  return data;
}

describe('computeOcrPreprocessPlan：小区域放大规则', () => {
  it('短边 < 80px → 3 倍放大', () => {
    expect(computeOcrPreprocessPlan(60, 200).scaleFactor).toBe(3);
    expect(computeOcrPreprocessPlan(200, 79).scaleFactor).toBe(3);
  });

  it('短边 80～159px → 2 倍放大', () => {
    expect(computeOcrPreprocessPlan(80, 300).scaleFactor).toBe(2);
    expect(computeOcrPreprocessPlan(400, 159).scaleFactor).toBe(2);
  });

  it('短边 ≥ 160px → 不放大（1x，仅灰度 + 对比度）', () => {
    expect(computeOcrPreprocessPlan(160, 160).scaleFactor).toBe(1);
    expect(computeOcrPreprocessPlan(800, 600).scaleFactor).toBe(1);
  });

  it('计划只依赖尺寸，不接触/不修改任何标注数据', () => {
    const a = makeAnnotation();
    const before = JSON.parse(JSON.stringify(a));
    const plan = computeOcrPreprocessPlan(a.w, a.h);
    // 100×40 短边 40 < 80 → 3 倍
    expect(plan).toEqual({ scaleFactor: 3, grayscale: true });
    expect(a).toEqual(before); // 标注原样不变
  });

  it('放大后输出尺寸 = 输入尺寸 × 放大倍数', () => {
    const plan = computeOcrPreprocessPlan(100, 50);
    expect(plan.scaleFactor).toBe(3);
    expect(100 * plan.scaleFactor).toBe(300);
    expect(50 * plan.scaleFactor).toBe(150);
  });
});

describe('preprocessOcrPixels：灰度化 + 对比度增强（纯函数）', () => {
  it('不修改输入数组（返回新数组）', () => {
    const input = makeSolidPixels(200, 100, 50);
    const snapshot = input.slice();
    preprocessOcrPixels(input, 2, 2);
    expect(input).toEqual(snapshot);
  });

  it('输出同尺寸 RGBA，每个像素 R=G=B（灰度）且 alpha=255', () => {
    const input = makeSolidPixels(200, 100, 50);
    const out = preprocessOcrPixels(input, 2, 2);
    expect(out.length).toBe(input.length);
    for (let i = 0; i < 4; i++) {
      expect(out[i * 4]).toBe(out[i * 4 + 1]);
      expect(out[i * 4 + 1]).toBe(out[i * 4 + 2]);
      expect(out[i * 4 + 3]).toBe(255);
    }
  });

  it('灰度值按 Rec.601 亮度公式计算（纯色输入、恒等拉伸）', () => {
    // 纯色图直方图集中在单值：不拉伸（恒等映射），输出即灰度值
    const input = makeSolidPixels(200, 100, 50);
    const out = preprocessOcrPixels(input, 2, 2);
    const expected = Math.round(0.299 * 200 + 0.587 * 100 + 0.114 * 50); // 128.2 → 128
    expect(out[0]).toBe(expected);
    expect(out[4]).toBe(expected);
  });

  it('纯黑 / 纯白输入不除零、不抛异常（恒等映射）', () => {
    expect(preprocessOcrPixels(makeSolidPixels(0, 0, 0), 2, 2)[0]).toBe(0);
    expect(preprocessOcrPixels(makeSolidPixels(255, 255, 255), 2, 2)[0]).toBe(255);
  });

  it('低对比度输入被拉伸：亮度范围扩大', () => {
    // 2×2：两个 100 亮度、两个 150 亮度（低对比度）
    const data = new Uint8ClampedArray(4 * 4);
    const values = [100, 100, 150, 150];
    values.forEach((v, i) => {
      data[i * 4] = v;
      data[i * 4 + 1] = v;
      data[i * 4 + 2] = v;
      data[i * 4 + 3] = 255;
    });
    const out = preprocessOcrPixels(data, 2, 2);
    const lows: number[] = [];
    const highs: number[] = [];
    for (let i = 0; i < 4; i++) {
      (i < 2 ? lows : highs).push(out[i * 4]);
    }
    expect(Math.max(...highs)).toBeGreaterThan(Math.min(...lows));
  });
});

describe('selectOcrRecognition：original / preprocessed 选择', () => {
  const original = (text: string, confidence: number | null = 90) => ({
    text,
    confidence,
    source: 'original' as const,
  });
  const preprocessed = (text: string, confidence: number | null = 90) => ({
    text,
    confidence,
    source: 'preprocessed' as const,
  });

  it('两者都有文本：confidence 高者胜', () => {
    expect(selectOcrRecognition(original('文本', 70), preprocessed('文本', 88)).source).toBe(
      'preprocessed',
    );
    expect(selectOcrRecognition(original('文本', 88), preprocessed('文本', 70)).source).toBe(
      'original',
    );
  });

  it('confidence 缺失（null）按较低处理，平手保留原始', () => {
    expect(selectOcrRecognition(original('文本', null), preprocessed('文本', 50)).source).toBe(
      'preprocessed',
    );
    expect(selectOcrRecognition(original('文本', 50), preprocessed('文本', null)).source).toBe(
      'original',
    );
    expect(selectOcrRecognition(original('文本', null), preprocessed('文本', null)).source).toBe(
      'original',
    );
  });

  it('一方无文本：有文本者胜', () => {
    expect(selectOcrRecognition(original('', null), preprocessed('文本', 60)).source).toBe(
      'preprocessed',
    );
    expect(selectOcrRecognition(original('文本', 90), preprocessed('', 95)).source).toBe(
      'original',
    );
  });

  it('都无文本：保留原始（与旧行为一致）', () => {
    expect(selectOcrRecognition(original('', null), preprocessed('', null)).source).toBe(
      'original',
    );
  });
});

describe('isLowOcrConfidence：低置信度提示规则', () => {
  it('低于阈值 → 提示；达到阈值 → 不提示', () => {
    expect(isLowOcrConfidence(LOW_OCR_CONFIDENCE_THRESHOLD - 1)).toBe(true);
    expect(isLowOcrConfidence(LOW_OCR_CONFIDENCE_THRESHOLD)).toBe(false);
    expect(isLowOcrConfidence(90)).toBe(false);
  });

  it('引擎未提供置信度（null）→ 不提示（不虚构，不误伤）', () => {
    expect(isLowOcrConfidence(null)).toBe(false);
  });
});

describe('computeExpectedSimilarity：与期望文本相似度', () => {
  it('完全一致 → 1（界面显示「与期望文本一致」）', () => {
    expect(computeExpectedSimilarity('2026年10月23日', '2026年10月23日')).toBe(1);
  });

  it('内容不同 → 0～1 之间的相似度（复用现有字符级算法）', () => {
    const s = computeExpectedSimilarity('2026年10月23日', '2026年10月24日');
    expect(s).not.toBeNull();
    expect(s!).toBeGreaterThan(0);
    expect(s!).toBeLessThan(1);
  });

  it('期望文本未设置 / 为空 → null（不参与比较）', () => {
    expect(computeExpectedSimilarity('文本', undefined)).toBeNull();
    expect(computeExpectedSimilarity('文本', '   ')).toBeNull();
  });

  it('识别文本为空 → null（无法比较）', () => {
    expect(computeExpectedSimilarity('', '期望')).toBeNull();
  });

  it('标准化后比较：首尾空白与连续空白不影响结果', () => {
    expect(computeExpectedSimilarity('  校园文化节  ', '校园文化节')).toBe(1);
  });
});

describe('expectedText 未设置时不影响旧流程', () => {
  it('buildOcrResult 不传 extra：新字段全部为默认值（null / original）', () => {
    const r = buildOcrResult('a1', '文本', '文本');
    expect(r.baselineConfidence).toBeNull();
    expect(r.currentConfidence).toBeNull();
    expect(r.baselineSource).toBe('original');
    expect(r.currentSource).toBe('original');
    expect(r.expectedBaselineSimilarity).toBeNull();
    expect(r.expectedCurrentSimilarity).toBeNull();
    // 原有字段与旧版一致
    expect(r.similarity).toBe(1);
    expect(r.status).toBe('识别文本保持一致');
  });

  it('buildOcrResult 传入 expectedText：计算与期望文本相似度', () => {
    const r = buildOcrResult('a1', '2026年10月23日', '2026年10月24日', undefined, {
      expectedText: '2026年10月23日',
    });
    expect(r.expectedBaselineSimilarity).toBe(1);
    expect(r.expectedCurrentSimilarity).not.toBeNull();
    expect(r.expectedCurrentSimilarity!).toBeLessThan(1);
  });

  it('ocrFailedResult：置信度 null、来源 original，字段完整', () => {
    const r = ocrFailedResult('a1', '失败原因');
    expect(r.baselineConfidence).toBeNull();
    expect(r.currentConfidence).toBeNull();
    expect(r.baselineSource).toBe('original');
    expect(r.currentSource).toBe('original');
    expect(r.error).toBe('失败原因');
    expect(r.expectedBaselineSimilarity).toBeNull();
  });
});

describe('原「传播前后 OCR 文本相似度」算法回归（口径不变）', () => {
  it('ocrSimilarity 行为保持不变', () => {
    expect(ocrSimilarity('校园文化节', '校园文化节')).toBe(1);
    expect(ocrSimilarity('abc', 'abd')).toBeCloseTo(2 / 3, 10);
    expect(ocrSimilarity('', '')).toBe(1);
    expect(ocrSimilarity('', 'x')).toBe(0);
    expect(ocrSimilarity('完全不同', '大相径庭')).toBe(0);
  });

  it('classifyOcrResult 生成的相似度与旧口径一致（buildOcrResult 内部复用）', () => {
    const same = buildOcrResult('a1', '校园文化节', '校园文化节');
    const changed = buildOcrResult('a1', '校园文化节', '校园文化日');
    expect(same.similarity).toBe(1);
    expect(changed.similarity).toBe(ocrSimilarity('校园文化节', '校园文化日'));
  });
});
