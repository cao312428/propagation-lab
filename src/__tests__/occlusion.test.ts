/**
 * 通用界面遮挡模拟的单元测试（1:1 与 9:16 共用，压力测试简化参数）。
 * 覆盖：遮挡矩形生成 / 完全无遮挡 / 部分遮挡 / 完全遮挡 /
 *       裁剪与遮挡同时发生（不重复扣除）/ 遮挡矩形重叠（只扣一次）/
 *       1:1 模式下的遮挡（无遮挡、部分遮挡、完全遮挡）与比例切换重算。
 */
import { describe, expect, it } from 'vitest';
import type { Annotation } from '../types';
import { computeCenterCrop } from '../utils/crop';
import {
  analyzeWithOcclusion,
  computeOccludedArea,
  computeOccluders,
} from '../utils/occlusion';

/** 构造一条测试标注（坐标均为原图坐标） */
function makeAnnotation(x: number, y: number, w: number, h: number): Annotation {
  return { id: 'test', x, y, w, h, label: '其他' };
}

describe('computeOccluders：遮挡矩形生成（原图坐标）', () => {
  it('按比例生成三块遮挡并与裁剪区域对齐', () => {
    const crop = { x: 100, y: 0, w: 900, h: 1600 }; // 9:16 裁剪区
    const [top, bottom, right] = computeOccluders(crop);
    // 顶部：高度 10%，占满宽度
    expect(top).toEqual({ x: 100, y: 0, w: 900, h: 160 });
    // 底部：高度 18%，起点在 82% 高度处
    expect(bottom.x).toBeCloseTo(100, 10);
    expect(bottom.y).toBeCloseTo(0.82 * 1600, 10);
    expect(bottom.w).toBeCloseTo(900, 10);
    expect(bottom.h).toBeCloseTo(0.18 * 1600, 10);
    // 右侧：宽度 12%，覆盖 25%～75% 高度
    expect(right.x).toBeCloseTo(100 + 0.88 * 900, 10);
    expect(right.y).toBeCloseTo(0.25 * 1600, 10);
    expect(right.w).toBeCloseTo(0.12 * 900, 10);
    expect(right.h).toBeCloseTo(0.5 * 1600, 10);
  });
});

describe('analyzeWithOcclusion：裁剪 + 遮挡的可见性', () => {
  // 正方形原图 1000×1000，裁剪区 = 全图，便于聚焦遮挡计算
  const crop = { x: 0, y: 0, w: 1000, h: 1000 };
  // 遮挡：顶部 (0,0,1000,100)、底部 (0,820,1000,180)、右侧 (880,250,120,500)
  const occluders = computeOccluders(crop);

  it('完全无遮挡：标注不与任何遮挡相交，最终可见率 = 裁剪保留率', () => {
    const a = makeAnnotation(100, 150, 300, 300); // 避开全部遮挡
    const r = analyzeWithOcclusion(a, crop, occluders);
    expect(r.cropKeptRatio).toBeCloseTo(1, 10);
    expect(r.finalVisibleRatio).toBeCloseTo(1, 10);
    expect(r.finalLevel).toBe('完整');
  });

  it('部分遮挡：标注上半被顶部遮挡覆盖，最终可见率为 50%', () => {
    const a = makeAnnotation(200, 0, 200, 200); // y 0~200，顶部遮挡覆盖 y 0~100
    const r = analyzeWithOcclusion(a, crop, occluders);
    expect(r.cropKeptRatio).toBeCloseTo(1, 10);
    expect(r.finalVisibleRatio).toBeCloseTo(0.5, 10);
  });

  it('完全遮挡：标注整体被顶部遮挡覆盖，最终可见率为 0%', () => {
    const a = makeAnnotation(300, 0, 100, 100); // 完全位于顶部遮挡内
    const r = analyzeWithOcclusion(a, crop, occluders);
    expect(r.cropKeptRatio).toBeCloseTo(1, 10);
    expect(r.finalVisibleRatio).toBe(0);
    expect(r.finalLevel).toBe('严重缺失');
  });

  it('裁剪与遮挡同时发生：已裁掉的部分不被重复扣除', () => {
    const c = { x: 0, y: 0, w: 1000, h: 1000 };
    const a = makeAnnotation(800, 0, 400, 200); // 右半（x 1000~1200）在裁剪区外
    // 构造一块超出裁剪区右边界的遮挡（x 至 1280），验证超界部分不会被扣除
    const occ = [{ x: 880, y: 0, w: 400, h: 100 }];
    const r = analyzeWithOcclusion(a, c, occ);
    expect(r.cropKeptRatio).toBeCloseTo(0.5, 10); // 保留 200×200 / 原始 400×200
    // 可见 = 保留 (800~1000, 0~200) - 遮挡交集 (880~1000, 0~100)
    //      = 40000 - 12000 = 28000 → 28000 / 80000 = 0.35
    expect(r.finalVisibleRatio).toBeCloseTo(0.35, 10);
  });

  it('遮挡矩形重叠：重叠区域只扣除一次', () => {
    const kept = { x: 0, y: 0, w: 100, h: 100 }; // 面积 10000
    // 两个完全覆盖 kept 的重叠遮挡（重叠 y 40~60）
    const occFull = [
      { x: 0, y: 0, w: 100, h: 60 },
      { x: 0, y: 40, w: 100, h: 60 },
    ];
    expect(computeOccludedArea(kept, occFull)).toBeCloseTo(0, 10); // 并集覆盖全部
    // 部分重叠：并集覆盖 y 0~80，剩余 y 80~100（面积 2000）
    const occPart = [
      { x: 0, y: 0, w: 100, h: 60 },
      { x: 0, y: 40, w: 100, h: 40 },
    ];
    expect(computeOccludedArea(kept, occPart)).toBeCloseTo(100 * 20, 10);
  });
});

describe('1:1 模式下的通用界面遮挡（同一组参数按 1:1 裁剪画面计算）', () => {
  // 横向原图 1200×800，1:1 居中裁剪区 = (200, 0, 800, 800)
  const crop = { x: 200, y: 0, w: 800, h: 800 };
  // 遮挡（相对 1:1 裁剪画面）：
  // 顶部 (200, 0, 800, 80)、底部 (200, 656, 800, 144)、右侧 (904, 200, 96, 400)
  const occluders = computeOccluders(crop);

  it('遮挡矩形按 1:1 裁剪画面的比例生成', () => {
    const [top, bottom, right] = computeOccluders(crop);
    expect(top).toEqual({ x: 200, y: 0, w: 800, h: 80 });
    expect(bottom.x).toBeCloseTo(200, 10);
    expect(bottom.y).toBeCloseTo(0.82 * 800, 10);
    expect(bottom.w).toBeCloseTo(800, 10);
    expect(bottom.h).toBeCloseTo(0.18 * 800, 10);
    expect(right.x).toBeCloseTo(200 + 0.88 * 800, 10);
    expect(right.y).toBeCloseTo(0.25 * 800, 10);
    expect(right.w).toBeCloseTo(0.12 * 800, 10);
    expect(right.h).toBeCloseTo(0.5 * 800, 10);
  });

  it('无遮挡：标注避开全部遮挡且在裁剪区内，最终可见率 = 裁剪保留率', () => {
    const a = makeAnnotation(300, 200, 200, 150); // y 200~350、x 300~500，避开全部遮挡
    const r = analyzeWithOcclusion(a, crop, occluders);
    expect(r.cropKeptRatio).toBeCloseTo(1, 10);
    expect(r.finalVisibleRatio).toBeCloseTo(1, 10);
    expect(r.finalLevel).toBe('完整');
  });

  it('部分遮挡：标注上半被顶部遮挡覆盖，最终可见率为 60%', () => {
    const a = makeAnnotation(300, 0, 200, 200); // 顶部遮挡覆盖 y 0~80，可见 (200-80)/200
    const r = analyzeWithOcclusion(a, crop, occluders);
    expect(r.cropKeptRatio).toBeCloseTo(1, 10);
    expect(r.finalVisibleRatio).toBeCloseTo(0.6, 10);
    expect(r.finalLevel).toBe('部分可见');
  });

  it('完全遮挡：标注整体被顶部遮挡覆盖，最终可见率为 0%', () => {
    const a = makeAnnotation(300, 0, 200, 80); // 完全位于顶部遮挡内
    const r = analyzeWithOcclusion(a, crop, occluders);
    expect(r.cropKeptRatio).toBeCloseTo(1, 10);
    expect(r.finalVisibleRatio).toBe(0);
    expect(r.finalLevel).toBe('严重缺失');
  });

  it('1:1 下裁剪与遮挡同时发生：已裁掉的部分不被重复扣除', () => {
    const a = makeAnnotation(850, 0, 400, 200); // 右半（x 1000~1250）在 1:1 裁剪区外
    // 构造一块超出裁剪区右边界的遮挡（x 至 1304），验证超界部分不会被扣除
    const occ = [{ x: 904, y: 0, w: 400, h: 100 }];
    const r = analyzeWithOcclusion(a, crop, occ);
    expect(r.cropKeptRatio).toBeCloseTo(0.375, 10); // 保留 150×200 / 原始 400×200
    // 可见 = 保留 (850~1000, 0~200) - 遮挡交集 (904~1000, 0~100)
    //      = 30000 - 9600 = 20400 → 20400 / 80000 = 0.255
    expect(r.finalVisibleRatio).toBeCloseTo(0.255, 10);
  });

  it('切换裁剪比例时遮挡按各自裁剪画面重新计算（1:1 与 9:16 结果不同）', () => {
    const crop916 = computeCenterCrop(1200, 800, 9, 16); // { x: 375, y: 0, w: 450, h: 800 }
    const [t11] = computeOccluders(crop);
    const [t916] = computeOccluders(crop916);
    // 1:1 顶部遮挡占满 800 宽的裁剪画面
    expect(t11).toEqual({ x: 200, y: 0, w: 800, h: 80 });
    // 9:16 顶部遮挡随更窄的裁剪画面收缩（宽 450），同一标注下的遮挡结果因此不同
    expect(t916).toEqual({ x: 375, y: 0, w: 450, h: 80 });
  });
});
