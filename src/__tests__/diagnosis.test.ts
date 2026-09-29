/**
 * 问题诊断模块的单元测试。
 * 覆盖：无损失 / 左侧裁剪 / 右侧裁剪 / 顶部裁剪 / 底部裁剪 /
 *       顶部遮挡 / 右侧遮挡 / 裁剪与遮挡同时发生 /
 *       多方向受损 / 多处界面遮挡 / 阈值边界 / 未开启遮挡。
 */
import { describe, expect, it } from 'vitest';
import type { Annotation } from '../types';
import {
  classifyProblemSource,
  computeLosses,
  detectCropDirection,
  detectOccluderSource,
  diagnoseAnnotation,
} from '../utils/diagnosis';
import { computeOccluders } from '../utils/occlusion';

/** 构造一条测试标注（坐标均为原图坐标） */
function makeAnnotation(x: number, y: number, w: number, h: number): Annotation {
  return { id: 'test', x, y, w, h, label: '其他' };
}

describe('diagnoseAnnotation：完整诊断结果', () => {
  // 1000×1000 原图，裁剪区 = 全图，便于聚焦遮挡判断
  const cropFull = { x: 0, y: 0, w: 1000, h: 1000 };
  const occludersFull = computeOccluders(cropFull);

  it('无损失：标注避开全部遮挡且在裁剪区内，判定为无明显问题', () => {
    const a = makeAnnotation(100, 150, 300, 300); // y 150~450、x 100~400，避开全部遮挡
    const d = diagnoseAnnotation(a, cropFull, occludersFull);
    expect(d.cropKeptRatio).toBeCloseTo(1, 10);
    expect(d.finalVisibleRatio).toBeCloseTo(1, 10);
    expect(d.level).toBe('完整');
    expect(d.problemSource).toBe('无明显问题');
    expect(d.cropDirection).toBeNull();
    expect(d.occlusionSource).toBeNull();
    expect(d.suggestion).toBe('当前信息完整可见，无需调整。');
  });

  it('左侧裁剪：标注左半被裁掉，建议向中央或右侧移动', () => {
    const crop = { x: 200, y: 0, w: 600, h: 1000 };
    const a = makeAnnotation(100, 100, 200, 200); // x 100~300，左侧 100 像素被裁掉
    const d = diagnoseAnnotation(a, crop, null); // 未开启遮挡
    expect(d.cropKeptRatio).toBeCloseTo(0.5, 10);
    expect(d.finalVisibleRatio).toBeCloseTo(0.5, 10); // 未开启遮挡时 = 裁剪保留率
    expect(d.problemSource).toBe('主要受裁剪影响');
    expect(d.cropDirection).toBe('左侧受损');
    expect(d.occlusionSource).toBeNull();
    expect(d.suggestion).toBe('建议将该信息向画面中央或右侧移动。');
  });

  it('右侧裁剪：标注右半被裁掉，建议向中央或左侧移动', () => {
    const crop = { x: 0, y: 0, w: 600, h: 1000 };
    const a = makeAnnotation(500, 100, 200, 200); // x 500~700，右侧 100 像素被裁掉
    const d = diagnoseAnnotation(a, crop, null);
    expect(d.problemSource).toBe('主要受裁剪影响');
    expect(d.cropDirection).toBe('右侧受损');
    expect(d.suggestion).toBe('建议将该信息向画面中央或左侧移动。');
  });

  it('顶部裁剪：标注上半被裁掉，建议向中央或下方移动', () => {
    const crop = { x: 0, y: 200, w: 1000, h: 800 };
    const a = makeAnnotation(100, 100, 200, 200); // y 100~300，顶部 100 像素被裁掉
    const d = diagnoseAnnotation(a, crop, null);
    expect(d.problemSource).toBe('主要受裁剪影响');
    expect(d.cropDirection).toBe('顶部受损');
    expect(d.suggestion).toBe('建议将该信息向画面中央或下方移动。');
  });

  it('底部裁剪：标注下半被裁掉，建议向中央或上方移动', () => {
    const crop = { x: 0, y: 0, w: 1000, h: 800 };
    const a = makeAnnotation(100, 700, 200, 200); // y 700~900，底部 100 像素被裁掉
    const d = diagnoseAnnotation(a, crop, null);
    expect(d.problemSource).toBe('主要受裁剪影响');
    expect(d.cropDirection).toBe('底部受损');
    expect(d.suggestion).toBe('建议将该信息向画面中央或上方移动。');
  });

  it('顶部遮挡：标注上半被顶部界面遮挡覆盖，建议下移', () => {
    const a = makeAnnotation(100, 0, 300, 200); // y 0~200，顶部遮挡覆盖 y 0~100
    const d = diagnoseAnnotation(a, cropFull, occludersFull);
    expect(d.cropKeptRatio).toBeCloseTo(1, 10);
    expect(d.finalVisibleRatio).toBeCloseTo(0.5, 10);
    expect(d.problemSource).toBe('主要受界面遮挡影响');
    expect(d.cropDirection).toBeNull();
    expect(d.occlusionSource).toBe('顶部遮挡');
    expect(d.suggestion).toBe('建议将该信息下移，避开顶部界面区域。');
  });

  it('右侧遮挡：标注右部被右侧界面遮挡覆盖，建议向左侧或中央移动', () => {
    const a = makeAnnotation(800, 300, 200, 100); // 与右侧遮挡相交 (880~1000, 300~400)
    const d = diagnoseAnnotation(a, cropFull, occludersFull);
    // 相交面积 120×100，占标注 200×100 的 60% → 最终可见率 40%
    expect(d.cropKeptRatio).toBeCloseTo(1, 10);
    expect(d.finalVisibleRatio).toBeCloseTo(0.4, 10);
    expect(d.problemSource).toBe('主要受界面遮挡影响');
    expect(d.occlusionSource).toBe('右侧遮挡');
    expect(d.suggestion).toBe('建议将该信息向左侧或中央移动。');
  });

  it('裁剪与遮挡同时发生：判定为同时受影响，建议两条拼接', () => {
    const crop = { x: 200, y: 0, w: 600, h: 1000 };
    const occluders = computeOccluders(crop);
    const a = makeAnnotation(100, 0, 300, 200); // 左侧 100 像素被裁，保留区上部 100 像素被顶部遮挡
    const d = diagnoseAnnotation(a, crop, occluders);
    expect(d.cropKeptRatio).toBeCloseTo(2 / 3, 10); // 保留宽 200 / 标注宽 300
    expect(d.finalVisibleRatio).toBeCloseTo(1 / 3, 10); // 再扣除顶部遮挡 200×100
    expect(d.problemSource).toBe('同时受裁剪和界面遮挡影响');
    expect(d.cropDirection).toBe('左侧受损');
    expect(d.occlusionSource).toBe('顶部遮挡');
    expect(d.suggestion).toBe(
      '建议将该信息向画面中央或右侧移动。 同时，建议将该信息下移，避开顶部界面区域。',
    );
  });

  it('多方向受损：标注四周都被裁掉，建议缩小或重新布置', () => {
    const crop = { x: 200, y: 200, w: 600, h: 600 };
    const a = makeAnnotation(100, 100, 800, 800); // 四边都溢出裁剪区
    const d = diagnoseAnnotation(a, crop, null);
    expect(d.problemSource).toBe('主要受裁剪影响');
    expect(d.cropDirection).toBe('多方向受损');
    expect(d.suggestion).toBe('建议缩小信息区域或将其重新布置到画面安全区域。');
  });

  it('多处界面遮挡：标注同时与三块遮挡相交', () => {
    const a = makeAnnotation(850, 0, 150, 900); // x 850~1000，与顶部、底部、右侧遮挡都相交
    const d = diagnoseAnnotation(a, cropFull, occludersFull);
    expect(d.occlusionSource).toBe('多处界面遮挡');
    expect(d.problemSource).toBe('主要受界面遮挡影响');
    expect(d.suggestion).toBe('建议缩小信息区域或将其重新布置到画面安全区域。');
  });
});

describe('classifyProblemSource：阈值边界（产品规则，非行业标准）', () => {
  it('两者都低于 2% 视为无明显问题（含临界值 2%）', () => {
    expect(classifyProblemSource(0, 0)).toBe('无明显问题');
    expect(classifyProblemSource(0.02, 0.02)).toBe('无明显问题');
  });

  it('cropLoss 超过 occlusionLoss 的 2 倍视为主要受裁剪影响', () => {
    expect(classifyProblemSource(0.5, 0.1)).toBe('主要受裁剪影响');
    expect(classifyProblemSource(0.03, 0.0105)).toBe('主要受裁剪影响');
  });

  it('occlusionLoss 超过 cropLoss 的 2 倍视为主要受界面遮挡影响', () => {
    expect(classifyProblemSource(0.1, 0.5)).toBe('主要受界面遮挡影响');
  });

  it('两者都有明显损失且接近视为同时受影响（含恰好 2 倍边界）', () => {
    expect(classifyProblemSource(0.3, 0.2)).toBe('同时受裁剪和界面遮挡影响');
    expect(classifyProblemSource(0.2, 0.1)).toBe('同时受裁剪和界面遮挡影响'); // 恰好 2 倍不算主导
  });
});

describe('computeLosses：损失分解', () => {
  it('cropLoss = 1 - 裁剪保留率，occlusionLoss = 裁剪保留率 - 最终可见率', () => {
    const l = computeLosses(0.8, 0.6);
    expect(l.cropLoss).toBeCloseTo(0.2, 10);
    expect(l.occlusionLoss).toBeCloseTo(0.2, 10);
    const none = computeLosses(1, 1);
    expect(none.cropLoss).toBe(0);
    expect(none.occlusionLoss).toBe(0);
  });
});

describe('detectCropDirection：方向判断边界', () => {
  it('标注恰好与裁剪区贴边（溢出量为 0）不算受损', () => {
    const crop = { x: 0, y: 0, w: 500, h: 500 };
    expect(detectCropDirection(makeAnnotation(0, 0, 500, 500), crop)).toBeNull();
    expect(detectCropDirection(makeAnnotation(400, 0, 100, 100), crop)).toBeNull(); // 右侧贴边
  });
});

describe('detectOccluderSource：遮挡来源判断', () => {
  it('未开启遮挡（occluders 为 null）时不判断遮挡来源', () => {
    expect(detectOccluderSource(makeAnnotation(0, 0, 100, 100), null)).toBeNull();
  });
});
