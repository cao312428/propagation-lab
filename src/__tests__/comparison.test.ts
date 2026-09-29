/**
 * 版本对比逻辑的单元测试。
 * 覆盖：明显提高 → 改善 / 明显降低 → 下降 / 不足 5pp → 基本不变（含临界值）/
 *       严重缺失 → 完整 / 完整 → 严重缺失 / 二维码恢复强制改善 /
 *       二维码失去可识别性强制下降 / 标签数量不同 / 同类型按顺序匹配 /
 *       场景不一致禁止比较 / 摘要统计 / 百分点格式化 / 快照生成。
 */
import { describe, expect, it } from 'vitest';
import type { Annotation } from '../types';
import { diagnoseAnnotation } from '../utils/diagnosis';
import {
  buildComparisonResult,
  classifyRegionChange,
  createSnapshot,
  formatDeltaPp,
  pairByLabelAndOrder,
  toSnapshotAnnotations,
  QR_LOST_TEXT,
  QR_RECOVERED_TEXT,
} from '../utils/comparison';
import type {
  BaselineSnapshot,
  SnapshotAnnotation,
} from '../types/comparison';

/** 构造一条快照标注（默认完整、无问题、非二维码） */
function makeSnap(overrides: Partial<SnapshotAnnotation> = {}): SnapshotAnnotation {
  return {
    label: '其他',
    cropKeptRatio: 1,
    finalVisibleRatio: 1,
    level: '完整',
    problemSource: '无明显问题',
    cropDirection: null,
    occlusionSource: null,
    suggestion: '当前信息完整可见，无需调整。',
    qr: null,
    ...overrides,
  };
}

/** 构造一条二维码快照标注 */
function makeQrSnap(options: {
  scenarioReadable: boolean;
  baselineReadable?: boolean;
  finalVisibleRatio?: number;
}): SnapshotAnnotation {
  const baselineReadable = options.baselineReadable ?? true;
  const scenarioReadable = options.scenarioReadable;
  const conclusion = !baselineReadable
    ? '原图二维码未能成功识别，无法据此判断传播处理是否导致失效'
    : scenarioReadable
      ? '当前场景下二维码仍可识别'
      : '传播处理后二维码识别失败';
  return makeSnap({
    label: '二维码',
    finalVisibleRatio: options.finalVisibleRatio ?? 0.9,
    qr: { baselineReadable, scenarioReadable, conclusion },
  });
}

/** 默认画质退化设置（关闭） */
const DEGRADATION_OFF = { enabled: false, scaleFactor: 0.5, jpegQuality: 0.7 };

/** 构造一个修改前快照 */
function makeBaseline(overrides: Partial<BaselineSnapshot> = {}): BaselineSnapshot {
  return {
    fileName: 'before.png',
    imageWidth: 1000,
    imageHeight: 1000,
    cropRatio: '1:1',
    occlusionEnabled: false,
    degradation: DEGRADATION_OFF,
    annotations: [],
    ...overrides,
  };
}

/** 构造测试标注（原图坐标） */
function makeAnnotation(
  id: string,
  x: number,
  y: number,
  w: number,
  h: number,
  label: Annotation['label'] = '其他',
): Annotation {
  return { id, x, y, w, h, label };
}

describe('classifyRegionChange：变化分类（阈值 5 个百分点）', () => {
  it('最终可见率明显提高 → 改善，并给出分类变化文本', () => {
    const before = makeSnap({ finalVisibleRatio: 0.5, cropKeptRatio: 0.5, level: '部分可见' });
    const after = makeSnap({ finalVisibleRatio: 1.0, cropKeptRatio: 1.0, level: '完整' });
    const r = classifyRegionChange(before, after);
    expect(r.direction).toBe('改善');
    expect(r.finalDeltaPp).toBeCloseTo(50, 10);
    expect(r.cropDeltaPp).toBeCloseTo(50, 10);
    expect(r.levelChangeText).toBe('部分可见 → 完整');
  });

  it('最终可见率明显降低 → 下降', () => {
    const r = classifyRegionChange(
      makeSnap({ finalVisibleRatio: 1.0, level: '完整' }),
      makeSnap({ finalVisibleRatio: 0.3, level: '严重缺失' }),
    );
    expect(r.direction).toBe('下降');
    expect(r.finalDeltaPp).toBeCloseTo(-70, 10);
  });

  it('变化不足 5 个百分点 → 基本不变（含 ±5pp 临界值）', () => {
    const small = classifyRegionChange(
      makeSnap({ finalVisibleRatio: 0.9 }),
      makeSnap({ finalVisibleRatio: 0.92 }), // +2pp
    );
    expect(small.direction).toBe('基本不变');
    // 临界值：恰好 +5pp 改善、恰好 -5pp 下降
    const atImprove = classifyRegionChange(
      makeSnap({ finalVisibleRatio: 0.9 }),
      makeSnap({ finalVisibleRatio: 0.95 }),
    );
    expect(atImprove.direction).toBe('改善');
    const atDecline = classifyRegionChange(
      makeSnap({ finalVisibleRatio: 0.9 }),
      makeSnap({ finalVisibleRatio: 0.85 }),
    );
    expect(atDecline.direction).toBe('下降');
  });

  it('分类：严重缺失 → 完整', () => {
    const r = classifyRegionChange(
      makeSnap({ finalVisibleRatio: 0.2, level: '严重缺失' }),
      makeSnap({ finalVisibleRatio: 1.0, level: '完整' }),
    );
    expect(r.levelChangeText).toBe('严重缺失 → 完整');
    expect(r.direction).toBe('改善');
  });

  it('分类：完整 → 严重缺失', () => {
    const r = classifyRegionChange(
      makeSnap({ finalVisibleRatio: 1.0, level: '完整' }),
      makeSnap({ finalVisibleRatio: 0.2, level: '严重缺失' }),
    );
    expect(r.levelChangeText).toBe('完整 → 严重缺失');
    expect(r.direction).toBe('下降');
  });

  it('二维码无法识别 → 可识别：几何变化不足 5pp 也强制「改善」', () => {
    const r = classifyRegionChange(
      makeQrSnap({ scenarioReadable: false, finalVisibleRatio: 0.9 }),
      makeQrSnap({ scenarioReadable: true, finalVisibleRatio: 0.92 }), // 仅 +2pp
    );
    expect(r.direction).toBe('改善');
    expect(r.qrStatusText).toBe('无法识别 → 可识别');
    expect(r.qrHighlightText).toBe(QR_RECOVERED_TEXT);
  });

  it('二维码可识别 → 无法识别：几何变化不足 5pp 也强制「下降」', () => {
    const r = classifyRegionChange(
      makeQrSnap({ scenarioReadable: true, finalVisibleRatio: 0.92 }),
      makeQrSnap({ scenarioReadable: false, finalVisibleRatio: 0.9 }), // 仅 -2pp
    );
    expect(r.direction).toBe('下降');
    expect(r.qrStatusText).toBe('可识别 → 无法识别');
    expect(r.qrHighlightText).toBe(QR_LOST_TEXT);
  });

  it('二维码可识别 → 可识别：无突出文案，按几何变化分类', () => {
    const r = classifyRegionChange(
      makeQrSnap({ scenarioReadable: true, finalVisibleRatio: 0.9 }),
      makeQrSnap({ scenarioReadable: true, finalVisibleRatio: 0.92 }),
    );
    expect(r.qrStatusText).toBe('可识别 → 可识别');
    expect(r.qrHighlightText).toBeNull();
    expect(r.direction).toBe('基本不变');
  });
});

describe('pairByLabelAndOrder：标签 + 顺序配对', () => {
  it('某类标签数量不同：正常配对 + 修改后未标注 + 新增标注', () => {
    const before = [
      makeSnap({ label: '标题', finalVisibleRatio: 0.9 }),
      makeSnap({ label: '标题', finalVisibleRatio: 0.8 }),
      makeSnap({ label: '日期', finalVisibleRatio: 0.7 }),
    ];
    const after = [
      makeSnap({ label: '标题', finalVisibleRatio: 0.95 }),
      makeSnap({ label: '日期', finalVisibleRatio: 0.75 }),
      makeSnap({ label: '日期', finalVisibleRatio: 0.6 }),
    ];
    const pairs = pairByLabelAndOrder(before, after);
    expect(pairs.map((p) => p.status)).toEqual([
      '匹配',
      '修改后未标注',
      '匹配',
      '新增标注',
    ]);
    // 第一个标题对：0.9 ↔ 0.95
    expect(pairs[0].before?.finalVisibleRatio).toBe(0.9);
    expect(pairs[0].after?.finalVisibleRatio).toBe(0.95);
    // 第二个标题（修改前）：修改后未标注
    expect(pairs[1].before?.finalVisibleRatio).toBe(0.8);
    expect(pairs[1].after).toBeNull();
    // 第二个日期（修改后）：新增标注
    expect(pairs[3].before).toBeNull();
    expect(pairs[3].after?.finalVisibleRatio).toBe(0.6);
  });

  it('同类型多个标注按出现顺序一一对应（不按数值配对）', () => {
    const before = [
      makeSnap({ label: '标题', finalVisibleRatio: 0.9 }),
      makeSnap({ label: '标题', finalVisibleRatio: 0.5 }),
    ];
    const after = [
      makeSnap({ label: '标题', finalVisibleRatio: 0.4 }),
      makeSnap({ label: '标题', finalVisibleRatio: 0.7 }),
    ];
    const pairs = pairByLabelAndOrder(before, after);
    // 顺序配对：第一个 0.9 ↔ 0.4，第二个 0.5 ↔ 0.7
    expect(pairs[0].before?.finalVisibleRatio).toBe(0.9);
    expect(pairs[0].after?.finalVisibleRatio).toBe(0.4);
    expect(pairs[1].before?.finalVisibleRatio).toBe(0.5);
    expect(pairs[1].after?.finalVisibleRatio).toBe(0.7);
  });
});

describe('buildComparisonResult：场景一致性', () => {
  it('裁剪比例不一致：不生成比较结论', () => {
    const baseline = makeBaseline({ cropRatio: '1:1', annotations: [makeSnap()] });
    const result = buildComparisonResult(baseline, {
      cropRatio: '9:16',
      occlusionEnabled: false,
      degradation: DEGRADATION_OFF,
      annotations: [makeSnap()],
    });
    expect(result.scenarioMatch).toBe(false);
    expect(result.summary).toBeNull();
    expect(result.regions).toEqual([]);
  });

  it('遮挡开关不一致：同样不生成比较结论', () => {
    const baseline = makeBaseline({ occlusionEnabled: false, annotations: [makeSnap()] });
    const result = buildComparisonResult(baseline, {
      cropRatio: '1:1',
      occlusionEnabled: true,
      degradation: DEGRADATION_OFF,
      annotations: [makeSnap()],
    });
    expect(result.scenarioMatch).toBe(false);
    expect(result.summary).toBeNull();
  });

  it('画质退化缩放比例不一致：视为场景不一致，不生成比较结论', () => {
    const baseline = makeBaseline({
      degradation: { ...DEGRADATION_OFF, enabled: true, scaleFactor: 0.5 },
      annotations: [makeSnap()],
    });
    const result = buildComparisonResult(baseline, {
      cropRatio: '1:1',
      occlusionEnabled: false,
      degradation: { ...DEGRADATION_OFF, enabled: true, scaleFactor: 0.25 },
      annotations: [makeSnap()],
    });
    expect(result.scenarioMatch).toBe(false);
    expect(result.summary).toBeNull();
  });

  it('画质退化 JPEG 质量不一致：视为场景不一致，不生成比较结论', () => {
    const baseline = makeBaseline({
      degradation: { ...DEGRADATION_OFF, enabled: true, jpegQuality: 0.7 },
      annotations: [makeSnap()],
    });
    const result = buildComparisonResult(baseline, {
      cropRatio: '1:1',
      occlusionEnabled: false,
      degradation: { ...DEGRADATION_OFF, enabled: true, jpegQuality: 0.35 },
      annotations: [makeSnap()],
    });
    expect(result.scenarioMatch).toBe(false);
    expect(result.summary).toBeNull();
  });

  it('场景一致：生成对比结论与摘要', () => {
    const baseline = makeBaseline({
      annotations: [
        makeSnap({ label: '标题', finalVisibleRatio: 0.3, level: '严重缺失' }),
      ],
    });
    const result = buildComparisonResult(baseline, {
      cropRatio: '1:1',
      occlusionEnabled: false,
      degradation: DEGRADATION_OFF,
      annotations: [
        makeSnap({ label: '标题', finalVisibleRatio: 1.0, level: '完整' }),
      ],
    });
    expect(result.scenarioMatch).toBe(true);
    expect(result.regions).toHaveLength(1);
    expect(result.regions[0].direction).toBe('改善');
    expect(result.summary).toBe(
      '共比较1个匹配区域：1个区域最终几何可见率提高，0个基本不变，0个下降。严重缺失区域从1个减少到0个。',
    );
  });
});

describe('buildComparisonSummary：总体摘要（只来自实际比较数据）', () => {
  it('统计改善 / 不变 / 下降、严重缺失变化与二维码恢复数', () => {
    const before = [
      makeSnap({ label: '标题', finalVisibleRatio: 0.3, level: '严重缺失' }),
      makeSnap({ label: '日期', finalVisibleRatio: 0.3, level: '严重缺失' }),
      makeQrSnap({ scenarioReadable: false, finalVisibleRatio: 0.9 }),
      makeSnap({ label: '地点', finalVisibleRatio: 0.8 }),
    ];
    const after = [
      makeSnap({ label: '标题', finalVisibleRatio: 1.0, level: '完整' }),
      makeSnap({ label: '日期', finalVisibleRatio: 0.9, level: '完整' }),
      makeQrSnap({ scenarioReadable: true, finalVisibleRatio: 0.92 }),
      makeSnap({ label: '地点', finalVisibleRatio: 0.82 }),
    ];
    const result = buildComparisonResult(makeBaseline({ annotations: before }), {
      cropRatio: '1:1',
      occlusionEnabled: false,
      degradation: DEGRADATION_OFF,
      annotations: after,
    });
    expect(result.summary).toBe(
      '共比较4个匹配区域：3个区域最终几何可见率提高，1个基本不变，0个下降。严重缺失区域从2个减少到0个。其中1个二维码由无法识别变为可识别。',
    );
  });
});

describe('createSnapshot：快照只保存纯数据', () => {
  it('从真实诊断结果生成快照（不保存像素或对象引用）', () => {
    const crop = { x: 0, y: 0, w: 1000, h: 1000 };
    const annotation = makeAnnotation('s1', 100, 100, 200, 200, '标题');
    const diag = diagnoseAnnotation(annotation, crop, null);
    const snap = createSnapshot({
      fileName: 'a.png',
      imageWidth: 1000,
      imageHeight: 1000,
      cropRatio: '1:1',
      occlusionEnabled: false,
      degradation: DEGRADATION_OFF,
      diagnoses: [diag],
      qrResults: new Map(),
    });
    expect(snap.fileName).toBe('a.png');
    expect(snap.imageWidth).toBe(1000);
    expect(snap.annotations).toHaveLength(1);
    expect(snap.annotations[0].label).toBe('标题');
    expect(snap.annotations[0].finalVisibleRatio).toBe(1);
    expect(snap.annotations[0].problemSource).toBe('无明显问题');
    expect(snap.annotations[0].qr).toBeNull();
    // 与 toSnapshotAnnotations 输出一致
    expect(snap.annotations).toEqual(toSnapshotAnnotations([diag], new Map()));
  });
});

describe('formatDeltaPp：百分点差值格式化', () => {
  it('正数带 + 号、负数带 - 号、零不带符号，保留一位小数', () => {
    expect(formatDeltaPp(37.25)).toBe('+37.3');
    expect(formatDeltaPp(-12)).toBe('-12.0');
    expect(formatDeltaPp(0)).toBe('0.0');
    expect(formatDeltaPp(2)).toBe('+2.0');
  });
});
