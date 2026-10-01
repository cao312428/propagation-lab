/**
 * 核心算法单元测试：1:1 居中裁剪 + 几何可见率计算。
 * 覆盖用户要求的 5 类关键场景：
 * 完全保留 / 完全裁掉 / 部分裁掉 / 边界重合 / 不同图片尺寸。
 */
import { describe, expect, it } from 'vitest';
import type { Annotation } from '../types';
import {
  classifyVisibility,
  computeCenterCrop,
  computeVisibleRatio,
} from '../utils/crop';

/** 构造一条测试标注（坐标均为原图坐标） */
function makeAnnotation(x: number, y: number, w: number, h: number): Annotation {
  return { id: 'test', x, y, w, h, label: '其他' };
}

describe('computeCenterCrop：1:1 居中裁剪区域', () => {
  it('横向图片：裁剪边长取短边，区域水平居中', () => {
    const crop = computeCenterCrop(1920, 1080);
    expect(crop.w).toBe(1080);
    expect(crop.h).toBe(1080);
    expect(crop.x).toBe(420); // (1920 - 1080) / 2
    expect(crop.y).toBe(0);
  });

  it('纵向图片：裁剪边长取短边，区域垂直居中', () => {
    const crop = computeCenterCrop(1080, 1920);
    expect(crop).toEqual({ x: 0, y: 420, w: 1080, h: 1080 });
  });

  it('正方形图片：裁剪区域与原图完全一致', () => {
    expect(computeCenterCrop(800, 800)).toEqual({ x: 0, y: 0, w: 800, h: 800 });
  });
});

describe('computeVisibleRatio：几何可见率', () => {
  // 1000×800 的横向图，裁剪区域为 (100, 0, 800, 800)
  const crop = computeCenterCrop(1000, 800);

  it('完全保留：标注整体位于裁剪区域内，可见率为 100%', () => {
    const a = makeAnnotation(300, 300, 200, 150);
    expect(computeVisibleRatio(a, crop)).toBeCloseTo(1, 10);
  });

  it('完全裁掉：标注整体位于裁剪区域外，可见率为 0%', () => {
    const a = makeAnnotation(0, 0, 60, 60); // 位于左侧被裁掉的区域
    expect(computeVisibleRatio(a, crop)).toBe(0);
  });

  it('部分裁掉：标注恰好一半在裁剪区域内，可见率为 50%', () => {
    const c = { x: 0, y: 0, w: 100, h: 100 };
    const a = makeAnnotation(50, 0, 100, 100); // 仅右半部分保留
    expect(computeVisibleRatio(a, c)).toBeCloseTo(0.5, 10);
  });

  it('边界重合：标注与裁剪区域逐像素重合，可见率为 100%', () => {
    const a = makeAnnotation(100, 0, 800, 800); // 与裁剪区域完全重合
    expect(computeVisibleRatio(a, crop)).toBeCloseTo(1, 10);
  });

  it('边界重合：标注紧贴裁剪区域边界外侧（相切无交集），可见率为 0%', () => {
    const c = { x: 0, y: 0, w: 100, h: 100 };
    const a = makeAnnotation(100, 100, 50, 50); // 与裁剪区域仅共用一个顶点
    expect(computeVisibleRatio(a, c)).toBe(0);
  });

  it('不同图片尺寸：窄高图（400×800）中标注跨越裁剪边界时计算正确', () => {
    const c = computeCenterCrop(400, 800);
    expect(c).toEqual({ x: 0, y: 200, w: 400, h: 400 });
    const a = makeAnnotation(0, 0, 400, 400); // 上半在裁剪区外、下半在内
    expect(computeVisibleRatio(a, c)).toBeCloseTo(0.5, 10);
  });
});

describe('computeCenterCrop：9:16 居中裁剪区域', () => {
  it('恰好 9:16 的竖图（1080×1920）：裁剪区域等于全图', () => {
    expect(computeCenterCrop(1080, 1920, 9, 16)).toEqual({ x: 0, y: 0, w: 1080, h: 1920 });
  });

  it('横图（1920×1080）：高度占满，宽度居中取 607.5', () => {
    const crop = computeCenterCrop(1920, 1080, 9, 16);
    expect(crop.w).toBeCloseTo(607.5, 10);
    expect(crop.h).toBeCloseTo(1080, 10);
    expect(crop.x).toBeCloseTo(656.25, 10); // (1920 - 607.5) / 2
    expect(crop.y).toBe(0);
  });

  it('正方形（800×800）：裁剪为 450×800 竖条，水平居中', () => {
    const crop = computeCenterCrop(800, 800, 9, 16);
    expect(crop.w).toBeCloseTo(450, 10);
    expect(crop.h).toBeCloseTo(800, 10);
    expect(crop.x).toBeCloseTo(175, 10);
    expect(crop.y).toBe(0);
  });

  it('更窄的原图（400×800，比例 1:2）：宽度占满，高度居中', () => {
    const crop = computeCenterCrop(400, 800, 9, 16);
    const h = (400 * 16) / 9;
    expect(crop.w).toBeCloseTo(400, 10);
    expect(crop.h).toBeCloseTo(h, 10);
    expect(crop.x).toBe(0);
    expect(crop.y).toBeCloseTo((800 - h) / 2, 10);
  });
});

describe('9:16 模式下的几何可见率', () => {
  it('横图中标注完全位于 9:16 裁剪区外，可见率为 0%', () => {
    const crop = computeCenterCrop(1920, 1080, 9, 16); // 裁剪区 x ≈ 656.25
    const a = makeAnnotation(0, 0, 300, 200);
    expect(computeVisibleRatio(a, crop)).toBe(0);
  });

  it('横图中标注横跨 9:16 裁剪边界，可见率按保留面积计算', () => {
    const crop = computeCenterCrop(1920, 1080, 9, 16);
    const a = makeAnnotation(600, 0, 200, 1080); // 部分在裁剪区内
    // 保留宽 = (600 + 200) - 656.25 = 143.75，保留比例 = 143.75 / 200
    expect(computeVisibleRatio(a, crop)).toBeCloseTo(143.75 / 200, 10);
  });
});

describe('computeCenterCrop：4:5 居中裁剪区域（多场景阶段新增）', () => {
  it('恰好 4:5 的图（800×1000）：裁剪区域等于全图', () => {
    expect(computeCenterCrop(800, 1000, 4, 5)).toEqual({ x: 0, y: 0, w: 800, h: 1000 });
  });

  it('横图（1920×1080）：宽度占满，高度居中取 1080 内最大 4:5 矩形', () => {
    // 4:5 时裁剪宽 = min(1920, 1080×4/5=864)，裁剪高 = 864×5/4 = 1080
    const crop = computeCenterCrop(1920, 1080, 4, 5);
    expect(crop.w).toBeCloseTo(864, 10);
    expect(crop.h).toBeCloseTo(1080, 10);
    expect(crop.x).toBeCloseTo((1920 - 864) / 2, 10);
    expect(crop.y).toBe(0);
  });

  it('竖图（1080×1920）：高度占满，宽度居中取 4:5', () => {
    // 裁剪高 = min(1920, 1080×5/4=1350)=1350，裁剪宽 = 1350×4/5 = 1080
    const crop = computeCenterCrop(1080, 1920, 4, 5);
    expect(crop.w).toBeCloseTo(1080, 10);
    expect(crop.h).toBeCloseTo(1350, 10);
    expect(crop.x).toBe(0);
    expect(crop.y).toBeCloseTo((1920 - 1350) / 2, 10);
  });
});

describe('computeCenterCrop：16:9 居中裁剪区域（多场景阶段新增）', () => {
  it('恰好 16:9 的横图（1920×1080）：裁剪区域等于全图', () => {
    expect(computeCenterCrop(1920, 1080, 16, 9)).toEqual({ x: 0, y: 0, w: 1920, h: 1080 });
  });

  it('竖图（1080×1920）：宽度占满，高度居中取 16:9', () => {
    // 裁剪宽 = min(1080, 1920×16/9 超出原图宽) = 1080，裁剪高 = 1080×9/16 = 607.5
    const crop = computeCenterCrop(1080, 1920, 16, 9);
    expect(crop.w).toBeCloseTo(1080, 10);
    expect(crop.h).toBeCloseTo(607.5, 10);
    expect(crop.x).toBe(0);
    expect(crop.y).toBeCloseTo((1920 - 607.5) / 2, 10);
  });

  it('正方形（800×800）：裁剪为 800×450 横条，垂直居中', () => {
    const crop = computeCenterCrop(800, 800, 16, 9);
    expect(crop.w).toBeCloseTo(800, 10);
    expect(crop.h).toBeCloseTo(450, 10);
    expect(crop.x).toBe(0);
    expect(crop.y).toBeCloseTo(175, 10);
  });
});

describe('4:5 与 16:9 模式下的几何可见率（复用同一套可见率算法）', () => {
  it('4:5 裁剪下标注横跨边界，可见率按保留面积计算', () => {
    // 1920×1080 横图，4:5 裁剪区 x=528, w=864, y=0, h=1080
    const crop = computeCenterCrop(1920, 1080, 4, 5);
    const a = makeAnnotation(500, 0, 200, 200);
    // 保留宽 = (500+200) - 528 = 172，保留比例 = 172/200
    expect(computeVisibleRatio(a, crop)).toBeCloseTo(172 / 200, 10);
  });

  it('16:9 裁剪下标注完全在裁剪区外，可见率为 0%', () => {
    // 1080×1920 竖图，16:9 裁剪区 x=0, w=1080, y≈656.25, h=607.5
    const crop = computeCenterCrop(1080, 1920, 16, 9);
    const a = makeAnnotation(0, 0, 300, 300); // 位于顶部被裁掉的区域
    expect(computeVisibleRatio(a, crop)).toBe(0);
  });

  it('16:9 裁剪下标注完全在裁剪区内，可见率为 100%', () => {
    const crop = computeCenterCrop(1080, 1920, 16, 9);
    const a = makeAnnotation(400, 700, 280, 200);
    expect(computeVisibleRatio(a, crop)).toBeCloseTo(1, 10);
  });
});

describe('classifyVisibility：检测结果分级', () => {
  it('可见率 ≥ 85% 判定为「完整」（含临界值 85%）', () => {
    expect(classifyVisibility(1)).toBe('完整');
    expect(classifyVisibility(0.85)).toBe('完整');
  });

  it('可见率 50%～85% 判定为「部分可见」（含临界值 50%）', () => {
    expect(classifyVisibility(0.84)).toBe('部分可见');
    expect(classifyVisibility(0.5)).toBe('部分可见');
  });

  it('可见率低于 50% 判定为「严重缺失」', () => {
    expect(classifyVisibility(0.499)).toBe('严重缺失');
    expect(classifyVisibility(0)).toBe('严重缺失');
  });
});
