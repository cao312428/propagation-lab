/**
 * 文字可识别性压力测试（OCR 第一版）的纯逻辑单元测试。
 * 不依赖网络、不启动真实 Tesseract 模型（真实 OCR 由浏览器人工验收）。
 * 覆盖：文本标准化 / A B C D 结论 / 相似度边界 / 目标标签过滤 /
 *       padding 左右边界 / 完全被裁掉跳过 / 结果过期判断 / 可处理的失败结果。
 */
import { describe, expect, it } from 'vitest';
import {
  buildOcrResult,
  classifyOcrResult,
  computeTextOcrRect,
  isOcrResultStale,
  isTextOcrTarget,
  normalizeOcrText,
  ocrFailedResult,
  ocrSimilarity,
  shouldSkipSceneOcr,
  OCR_FAILED_MESSAGE,
  SCENE_SKIPPED_REASON,
} from '../utils/textRecognition';

describe('normalizeOcrText：轻量标准化', () => {
  it('去除首尾空白', () => {
    expect(normalizeOcrText('  校园创意设计大赛  ')).toBe('校园创意设计大赛');
    expect(normalizeOcrText('')).toBe('');
  });

  it('统一换行为空格并合并连续空白（不做任何纠错）', () => {
    expect(normalizeOcrText('第一行\n\n第二行\t\t结尾')).toBe('第一行 第二行 结尾');
    expect(normalizeOcrText('  a\r\n   b ')).toBe('a b');
  });
});

describe('classifyOcrResult：A / B / C / D 结论', () => {
  it('A：baseline 与 current 标准化后完全一致 → 识别文本保持一致', () => {
    const r = classifyOcrResult('校园创意设计大赛', ' 校园创意设计大赛 ');
    expect(r.status).toBe('识别文本保持一致');
    expect(r.similarity).toBe(1);
  });

  it('B：baseline 与 current 都有文本但内容不同 → 识别文本发生变化', () => {
    const r = classifyOcrResult('2026年10月15日', '2026年10月1日');
    expect(r.status).toBe('识别文本发生变化');
    // 距离 1，相似度 = 1 - 1/11
    expect(r.similarity).toBeCloseTo(10 / 11, 10);
  });

  it('C：baseline 有文本、current 为空 → 传播处理后未能识别文字', () => {
    const r = classifyOcrResult('校园创意设计大赛', '');
    expect(r.status).toBe('传播处理后未能识别文字');
    expect(r.similarity).toBe(0);
  });

  it('D：baseline 本身为空 → 不宣称传播导致失败', () => {
    const r = classifyOcrResult('', '任意文本');
    expect(r.status).toBe('原图文字未能成功识别，无法判断传播处理是否导致变化');
    expect(r.similarity).toBeNull();
  });
});

describe('ocrSimilarity：字符级相似度边界', () => {
  it('相同文本为 1，完全不同为 0', () => {
    expect(ocrSimilarity('abc', 'abc')).toBe(1);
    expect(ocrSimilarity('abc', 'def')).toBe(0);
  });

  it('一个为空为 0，两个都为空为 1', () => {
    expect(ocrSimilarity('abc', '')).toBe(0);
    expect(ocrSimilarity('', 'abc')).toBe(0);
    expect(ocrSimilarity('', '')).toBe(1);
  });
});

describe('isTextOcrTarget：OCR 目标标签过滤', () => {
  it('标题 / 日期 / 地点 / 其他进入 OCR 任务', () => {
    expect(isTextOcrTarget('标题')).toBe(true);
    expect(isTextOcrTarget('日期')).toBe(true);
    expect(isTextOcrTarget('地点')).toBe(true);
    expect(isTextOcrTarget('其他')).toBe(true);
  });

  it('二维码不进入 OCR 任务（继续使用二维码检测模块）', () => {
    expect(isTextOcrTarget('二维码')).toBe(false);
  });
});

describe('computeTextOcrRect：padding 与边界限制', () => {
  it('靠近左边界：提取区域被限制在原图边界内', () => {
    const r = computeTextOcrRect({ x: 3, y: 10, w: 100, h: 50 }, 1000, 800);
    expect(r.x).toBe(0);
    expect(r.y).toBe(6);
    expect(r.w).toBe(108); // 3 + 100 + 5
    expect(r.h).toBe(58); // 10 + 50 + 4 - 6
  });

  it('靠近右边界：提取区域右边界不超过原图宽', () => {
    const r = computeTextOcrRect({ x: 950, y: 10, w: 100, h: 50 }, 1000, 800);
    expect(r.x).toBe(945);
    expect(r.x + r.w).toBe(1000);
  });

  it('居中标注：四周按 5% padding 扩展', () => {
    const r = computeTextOcrRect({ x: 100, y: 100, w: 200, h: 100 }, 1000, 1000);
    expect(r).toEqual({ x: 90, y: 95, w: 220, h: 110 });
  });
});

describe('shouldSkipSceneOcr：完全被裁掉的标注跳过 OCR', () => {
  it('标注完全在裁剪区外 → 跳过场景识别', () => {
    const crop = { x: 0, y: 0, w: 500, h: 500 };
    expect(shouldSkipSceneOcr({ x: 600, y: 600, w: 100, h: 100 }, crop)).toBe(true);
  });

  it('标注与裁剪区有交集 → 不跳过', () => {
    const crop = { x: 0, y: 0, w: 500, h: 500 };
    expect(shouldSkipSceneOcr({ x: 450, y: 450, w: 100, h: 100 }, crop)).toBe(false);
  });
});

describe('isOcrResultStale：OCR 结果过期判断', () => {
  const imageA = {};
  const imageB = {};
  const annA: unknown[] = [];
  const annB: unknown[] = [];
  const deg = { scaleFactor: 0.5, jpegQuality: 0.7 };

  it('没有任何指纹（从未运行）→ 视为过期', () => {
    expect(
      isOcrResultStale(null, {
        image: imageA,
        cropRatio: '1:1',
        occlusionEnabled: false,
        annotations: annA,
        degradation: deg,
      }),
    ).toBe(true);
  });

  it('环境未变化 → 未过期', () => {
    const fp = {
      image: imageA,
      cropRatio: '1:1' as const,
      occlusionEnabled: false,
      annotations: annA,
      degradation: deg,
    };
    expect(isOcrResultStale(fp, { ...fp })).toBe(false);
  });

  it('裁剪比例 / 遮挡开关 / 标注 / 图片 / 退化参数任一变化 → 过期', () => {
    const fp = {
      image: imageA,
      cropRatio: '1:1' as const,
      occlusionEnabled: false,
      annotations: annA,
      degradation: deg,
    };
    expect(isOcrResultStale(fp, { image: imageA, cropRatio: '9:16', occlusionEnabled: false, annotations: annA, degradation: deg })).toBe(true);
    expect(isOcrResultStale(fp, { image: imageA, cropRatio: '1:1', occlusionEnabled: true, annotations: annA, degradation: deg })).toBe(true);
    expect(isOcrResultStale(fp, { image: imageA, cropRatio: '1:1', occlusionEnabled: false, annotations: annB, degradation: deg })).toBe(true);
    expect(isOcrResultStale(fp, { image: imageB, cropRatio: '1:1', occlusionEnabled: false, annotations: annA, degradation: deg })).toBe(true);
    expect(isOcrResultStale(fp, { image: imageA, cropRatio: '1:1', occlusionEnabled: false, annotations: annA, degradation: { scaleFactor: 0.25, jpegQuality: 0.7 } })).toBe(true);
  });
});

describe('失败与跳过的可处理结果', () => {
  it('ocrFailedResult：返回带 error 的结果而不是抛异常', () => {
    const r = ocrFailedResult('a1');
    expect(r.annotationId).toBe('a1');
    expect(r.error).toBe(OCR_FAILED_MESSAGE);
    expect(r.status).toBe('原图文字未能成功识别，无法判断传播处理是否导致变化');
    expect(r.similarity).toBeNull();
  });

  it('buildOcrResult：完全被裁掉时记录跳过原因且不报错', () => {
    const r = buildOcrResult('a2', '校园创意设计大赛', '', SCENE_SKIPPED_REASON);
    expect(r.status).toBe('传播处理后未能识别文字');
    expect(r.currentSkippedReason).toBe(SCENE_SKIPPED_REASON);
    expect(r.currentText).toBe('');
  });
});
