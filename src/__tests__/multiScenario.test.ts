/**
 * 多场景传播压力测试核心逻辑单元测试（Node 环境纯函数部分）。
 *
 * 覆盖需求要求的 12 项：
 * 4:5 / 16:9 裁剪（见 crop.test.ts）、1:1 / 9:16 回归（见 crop.test.ts）、
 * 多场景运行返回正确场景数量、不同场景结果互不污染、
 * 原图 annotation 坐标没有被修改、遮挡场景正确复用现有逻辑、
 * 多场景结果失效规则、风险矩阵数据映射、
 * QR 状态与几何状态分开保存、未运行 OCR 正确显示为未运行。
 *
 * 不测试任何 CSS 像素与浏览器渲染。
 */
import { describe, expect, it } from 'vitest';
import type { Annotation, CropRatio } from '../types';
import type { TextRecognitionResult } from '../types/textRecognition';
import { diagnoseAnnotation } from '../utils/diagnosis';
import {
  ALL_SCENARIOS,
  buildMultiScenarioSummary,
  buildQrMatrixData,
  buildRegionScenarioResult,
  buildScenarioDetail,
  buildScenarioResults,
  isScenarioRunValid,
  mapOcrMatrixStatus,
  mapQrMatrixStatus,
  matchOcrForScenario,
  ocrMatrixStatusOf,
  resolveScenarios,
  sameScenarioIds,
} from '../utils/multiScenario';
import type { QrMatrixData, RegionScenarioResult, ScenarioResult } from '../types/multiScenario';

/** 构造一条测试标注（原图坐标） */
function makeAnnotation(id: string, label: Annotation['label'], x: number, y: number, w: number, h: number): Annotation {
  return { id, label, x, y, w, h };
}

/** 1920×1080 横向测试图 */
const IMAGE_W = 1920;
const IMAGE_H = 1080;

const TITLE = makeAnnotation('a-title', '标题', 400, 100, 400, 120);
const DATE = makeAnnotation('a-date', '日期', 100, 500, 300, 80);
const QR = makeAnnotation('a-qr', '二维码', 1600, 700, 200, 200);

/** 构造一条 OCR 结果（用于条件匹配测试） */
function makeOcrResult(overrides: Partial<TextRecognitionResult> = {}): TextRecognitionResult {
  return {
    annotationId: 'a-title',
    baselineText: '校园文化节',
    currentText: '校园文化节',
    status: '识别文本保持一致',
    similarity: 1,
    ...overrides,
  };
}

/** 构造一次最小运行结果（供失效规则测试） */
function makeRunResult(overrides: Partial<Parameters<typeof isScenarioRunValid>[0]> = {}) {
  const image = {} as HTMLImageElement;
  const annotations = [TITLE];
  return {
    image,
    annotations,
    selectedScenarioIds: ['crop-1-1'],
    currentCropRatio: '1:1' as CropRatio,
    currentOcclusionEnabled: false,
    scenarios: [],
    summary: { testedScenarioCount: 0, missingScenarioCount: 0, qrFailureScenarioCount: 0 },
    ...overrides,
  };
}

describe('ALL_SCENARIOS：场景定义完整性', () => {
  it('共 10 个场景：4 裁剪 + 4 裁剪遮挡 + 2 画质压力预设', () => {
    expect(ALL_SCENARIOS).toHaveLength(10);
    const groups = ALL_SCENARIOS.map((s) => s.group);
    expect(groups.filter((g) => g === '裁剪')).toHaveLength(4);
    expect(groups.filter((g) => g === '裁剪+遮挡')).toHaveLength(4);
    expect(groups.filter((g) => g === '画质压力')).toHaveLength(2);
  });

  it('场景 id 唯一', () => {
    const ids = ALL_SCENARIOS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('画质压力预设参数符合产品定义：中等 50%/70%，高 25%/35%', () => {
    const medium = ALL_SCENARIOS.find((s) => s.id === 'deg-medium');
    const high = ALL_SCENARIOS.find((s) => s.id === 'deg-high');
    expect(medium?.degradationPreset).toEqual({ scaleFactor: 0.5, jpegQuality: 0.7 });
    expect(high?.degradationPreset).toEqual({ scaleFactor: 0.25, jpegQuality: 0.35 });
    expect(medium?.cropRatio).toBeNull(); // 退化预设基于当前场景，不绑定固定裁剪比例
  });
});

describe('resolveScenarios：多场景解析', () => {
  it('只解析选中的场景，返回正确场景数量', () => {
    const selected = ['crop-1-1', 'crop-4-5', 'crop-9-16', 'crop-16-9'];
    const resolved = resolveScenarios(selected, '1:1', false, IMAGE_W, IMAGE_H);
    expect(resolved).toHaveLength(4);
    expect(resolved.map((s) => s.definition.id)).toEqual(selected);
  });

  it('全选 10 个场景全部解析', () => {
    const resolved = resolveScenarios(ALL_SCENARIOS.map((s) => s.id), '1:1', false, IMAGE_W, IMAGE_H);
    expect(resolved).toHaveLength(10);
  });

  it('未选中的场景不出现', () => {
    const resolved = resolveScenarios(['crop-1-1'], '1:1', false, IMAGE_W, IMAGE_H);
    expect(resolved.every((s) => s.definition.id === 'crop-1-1')).toBe(true);
  });

  it('4:5 与 16:9 场景的裁剪区域与现有 computeCenterCrop 一致', () => {
    const resolved = resolveScenarios(['crop-4-5', 'crop-16-9'], '1:1', false, IMAGE_W, IMAGE_H);
    const r45 = resolved.find((s) => s.definition.id === 'crop-4-5')!;
    const r169 = resolved.find((s) => s.definition.id === 'crop-16-9')!;
    // 4:5：宽 = 1080×4/5 = 864，高 = 1080，x = (1920-864)/2
    expect(r45.cropRect.w).toBeCloseTo(864, 10);
    expect(r45.cropRect.h).toBeCloseTo(1080, 10);
    expect(r45.cropRect.x).toBeCloseTo(528, 10);
    // 16:9：宽 = 1920，高 = 1920×9/16 = 1080，全图
    expect(r169.cropRect).toEqual({ x: 0, y: 0, w: 1920, h: 1080 });
  });

  it('遮挡场景启用遮挡并复用 computeOccluders 生成三块遮挡', () => {
    const resolved = resolveScenarios(['crop-1-1-occlusion'], '1:1', false, IMAGE_W, IMAGE_H);
    const s = resolved[0];
    expect(s.occlusionEnabled).toBe(true);
    expect(s.occluders).toHaveLength(3);
    // 顶部遮挡：覆盖裁剪画面顶部 10% 高
    expect(s.occluders![0]).toEqual({
      x: s.cropRect.x,
      y: s.cropRect.y,
      w: s.cropRect.w,
      h: s.cropRect.h * 0.1,
    });
  });

  it('画质退化预设基于当前单场景：裁剪比例与遮挡开关跟随当前值', () => {
    const resolved = resolveScenarios(['deg-medium'], '9:16', true, IMAGE_W, IMAGE_H);
    const s = resolved[0];
    // 基础场景 = 当前 9:16 + 遮挡开启
    expect(s.definition.cropRatio).toBeNull();
    expect(s.occlusionEnabled).toBe(true);
    expect(s.occluders).toHaveLength(3);
    expect(s.degradation).toEqual({ scaleFactor: 0.5, jpegQuality: 0.7 });
    // 裁剪区域与 9:16 一致
    const ref = resolveScenarios(['crop-9-16'], '9:16', true, IMAGE_W, IMAGE_H)[0];
    expect(s.cropRect).toEqual(ref.cropRect);
  });

  it('退化预设场景文案包含参数与基础场景说明，不含平台名称', () => {
    const detail = buildScenarioDetail(
      ALL_SCENARIOS.find((s) => s.id === 'deg-high')!,
      '1:1',
    );
    expect(detail).toContain('高画质压力');
    expect(detail).toContain('25%');
    expect(detail).toContain('35%');
    expect(detail).toContain('基于当前场景');
    expect(detail).not.toMatch(/微信|抖音|小红书|Instagram/i);
  });
});

describe('buildRegionScenarioResult：区域 × 场景结果（复用现有诊断）', () => {
  const scenario = resolveScenarios(['crop-1-1'], '1:1', false, IMAGE_W, IMAGE_H)[0];

  it('几何字段与 diagnoseAnnotation 完全一致（遮挡场景复用现有逻辑）', () => {
    const occlScenario = resolveScenarios(['crop-1-1-occlusion'], '1:1', true, IMAGE_W, IMAGE_H)[0];
    for (const annotation of [TITLE, DATE, QR]) {
      const region = buildRegionScenarioResult(annotation, occlScenario, null, null);
      const d = diagnoseAnnotation(annotation, occlScenario.cropRect, occlScenario.occluders);
      expect(region.cropKeptRatio).toBe(d.cropKeptRatio);
      expect(region.finalVisibleRatio).toBe(d.finalVisibleRatio);
      expect(region.level).toBe(d.level);
      expect(region.problemSource).toBe(d.problemSource);
      expect(region.cropDirection).toBe(d.cropDirection);
      expect(region.occlusionSource).toBe(d.occlusionSource);
      expect(region.suggestion).toBe(d.suggestion);
    }
  });

  it('原图 annotation 坐标没有被修改（运行前后深比较一致）', () => {
    const before = JSON.parse(JSON.stringify([TITLE, DATE, QR])) as Annotation[];
    const regions = [TITLE, DATE, QR].map((a) =>
      buildRegionScenarioResult(a, scenario, null, null),
    );
    void regions;
    expect([TITLE, DATE, QR]).toEqual(before);
    expect(TITLE).toEqual({ id: 'a-title', label: '标题', x: 400, y: 100, w: 400, h: 120 });
  });

  it('QR 状态与几何状态分开保存：QR 失败不会改写几何分类', () => {
    const qrFail = buildQrMatrixData({
      baselineContent: 'https://example.com',
      scenarioContent: null,
      degraded: 'none',
    });
    // 1:1 裁剪区为 x=420~1500；QR 标注 1600~1800 完全在裁剪区外（几何严重缺失），
    // 但 QR 失败（无法识别）不代表几何状态由 QR 决定
    const region = buildRegionScenarioResult(QR, scenario, qrFail, null);
    expect(region.qr?.status).toBe('无法识别');
    expect(region.level).toBe('严重缺失');
    // 几何字段由几何计算决定，与 qr.status 无关（带/不带 QR 数据几何完全一致）
    const noQrRegion = buildRegionScenarioResult(QR, scenario, null, null);
    expect(region.level).toBe(noQrRegion.level);
    expect(region.finalVisibleRatio).toBe(noQrRegion.finalVisibleRatio);
    expect(region.cropKeptRatio).toBe(noQrRegion.cropKeptRatio);
  });
});

describe('buildScenarioResults：批量组装', () => {
  const scenarios = resolveScenarios(
    ['crop-1-1', 'crop-9-16', 'crop-1-1-occlusion'],
    '1:1',
    false,
    IMAGE_W,
    IMAGE_H,
  );

  it('返回正确场景数量，且每个场景包含全部标注', () => {
    const results = buildScenarioResults([TITLE, DATE, QR], scenarios, new Map(), [], '1:1', false, null);
    expect(results).toHaveLength(3);
    for (const s of results) {
      expect(s.regions.map((r) => r.annotationId)).toEqual(['a-title', 'a-date', 'a-qr']);
    }
  });

  it('不同场景结果互不污染：同一标注在不同裁剪场景下数值不同且各自独立', () => {
    const results = buildScenarioResults([TITLE, DATE, QR], scenarios, new Map(), [], '1:1', false, null);
    const r11 = results[0].regions[0]; // 1:1 下的标题
    const r916 = results[1].regions[0]; // 9:16 下的标题
    // 9:16 裁剪区更窄，同一标注保留率更低（至少不高于 1:1）
    expect(r916.finalVisibleRatio).toBeLessThanOrEqual(r11.finalVisibleRatio);
    // 结果对象相互独立：修改一个场景的结果不影响其他场景
    const copy = JSON.parse(JSON.stringify(results)) as ScenarioResult[];
    copy[0].regions[0] = { ...copy[0].regions[0], finalVisibleRatio: 0 };
    expect(results[1].regions[0].finalVisibleRatio).toBe(r916.finalVisibleRatio);
    expect(results[0].regions[0].finalVisibleRatio).toBe(r11.finalVisibleRatio);
  });

  it('未运行 OCR 时文字标注的 ocr 为 null，矩阵显示为「未运行」而不是失败', () => {
    const results = buildScenarioResults([TITLE], scenarios, new Map(), [], '1:1', false, null);
    const titleRegion = results[0].regions[0];
    expect(titleRegion.label).not.toBe('二维码');
    expect(titleRegion.ocr).toBeNull();
    expect(ocrMatrixStatusOf(titleRegion.ocr)).toBe('未运行');
  });

  it('已有且条件匹配的 OCR 结果被复用（当前 1:1、无遮挡、无退化）', () => {
    const ocr = makeOcrResult();
    const results = buildScenarioResults([TITLE], scenarios, new Map(), [ocr], '1:1', false, null);
    // 只有 1:1（无遮挡）场景与当前单场景条件一致
    const r11 = results[0].regions[0];
    const r916 = results[1].regions[0];
    const rOccl = results[2].regions[0];
    expect(r11.ocr?.status).toBe('保持一致');
    expect(r916.ocr).toBeNull(); // 9:16 ≠ 当前 1:1
    expect(rOccl.ocr).toBeNull(); // 遮挡开启 ≠ 当前关闭
  });

  it('二维码标注的 ocr 恒为 null（二维码走二维码检测，不进入 OCR）', () => {
    const ocr = makeOcrResult({ annotationId: 'a-qr' });
    const results = buildScenarioResults([QR], scenarios, new Map(), [ocr], '1:1', false, null);
    expect(results[0].regions[0].ocr).toBeNull();
  });
});

describe('mapQrMatrixStatus / buildQrMatrixData：QR 矩阵状态映射', () => {
  it('原图可识别 + 场景可识别 → 可识别', () => {
    const d = buildQrMatrixData({ baselineContent: 'x', scenarioContent: 'x', degraded: 'none' });
    expect(d.status).toBe('可识别');
    expect(d.degradedChecked).toBeNull();
  });

  it('原图可识别 + 场景无法识别 → 无法识别（且不改写几何）', () => {
    const d = buildQrMatrixData({ baselineContent: 'x', scenarioContent: null, degraded: 'none' });
    expect(d.status).toBe('无法识别');
  });

  it('原图不可识别 → 原图不可识别（不归因于传播处理）', () => {
    const d = buildQrMatrixData({ baselineContent: null, scenarioContent: 'x', degraded: 'none' });
    expect(d.status).toBe('原图不可识别');
  });

  it('退化场景：退化后仍可识别 → 可识别', () => {
    const d = buildQrMatrixData({
      baselineContent: 'x',
      scenarioContent: 'x',
      degraded: { content: 'x' },
    });
    expect(d.status).toBe('可识别');
    expect(d.degradedChecked).toBe(true);
    expect(d.degradedConclusion).toBe('画质退化后二维码仍可识别');
  });

  it('退化场景：退化后无法识别 → 无法识别（结论复用现有口径）', () => {
    const d = buildQrMatrixData({
      baselineContent: 'x',
      scenarioContent: 'x',
      degraded: { content: null },
    });
    expect(d.status).toBe('无法识别');
    expect(d.degradedConclusion).toBe('画质退化后二维码识别失败');
  });

  it('退化场景：scene 已无法识别（未执行退化检测）→ 无法识别', () => {
    const d = buildQrMatrixData({
      baselineContent: 'x',
      scenarioContent: null,
      degraded: 'skipped',
    });
    expect(d.degradedChecked).toBe(false);
    expect(d.status).toBe('无法识别');
    expect(d.degradedConclusion).toBe('当前裁剪/遮挡场景已无法识别二维码，无法单独判断画质退化影响');
  });

  it('mapQrMatrixStatus 对退化执行失败（degradedChecked=true 且不可读）返回无法识别', () => {
    expect(
      mapQrMatrixStatus({
        baselineReadable: true,
        scenarioReadable: true,
        degradedChecked: true,
        degradedReadable: false,
      }),
    ).toBe('无法识别');
  });
});

describe('mapOcrMatrixStatus / ocrMatrixStatusOf：OCR 矩阵状态映射', () => {
  it('四种单场景结论映射为矩阵状态', () => {
    expect(mapOcrMatrixStatus(makeOcrResult({ status: '识别文本保持一致' }))).toBe('保持一致');
    expect(mapOcrMatrixStatus(makeOcrResult({ status: '识别文本发生变化' }))).toBe('发生变化');
    expect(mapOcrMatrixStatus(makeOcrResult({ status: '传播处理后未能识别文字' }))).toBe('未能识别');
    expect(
      mapOcrMatrixStatus(makeOcrResult({ status: '原图文字未能成功识别，无法判断传播处理是否导致变化' })),
    ).toBe('原图未识别');
  });

  it('无结果（未运行）显示为「未运行」，而不是失败', () => {
    expect(ocrMatrixStatusOf(null)).toBe('未运行');
  });

  it('OCR 失败（error 存在）的结果不被复用，视为未运行', () => {
    const scenario = resolveScenarios(['crop-1-1'], '1:1', false, IMAGE_W, IMAGE_H)[0];
    const failed = makeOcrResult({ error: '模型加载失败' });
    expect(matchOcrForScenario([failed], TITLE, scenario, '1:1', false, null)).toBeNull();
  });
});

describe('matchOcrForScenario：条件匹配', () => {
  const ocr = makeOcrResult();

  it('裁剪比例一致才复用（1:1 vs 4:5）', () => {
    const s45 = resolveScenarios(['crop-4-5'], '1:1', false, IMAGE_W, IMAGE_H)[0];
    expect(matchOcrForScenario([ocr], TITLE, s45, '1:1', false, null)).toBeNull();
  });

  it('遮挡开关一致才复用', () => {
    const sOccl = resolveScenarios(['crop-1-1-occlusion'], '1:1', false, IMAGE_W, IMAGE_H)[0];
    // 场景遮挡开启，当前遮挡关闭 → 不匹配
    expect(matchOcrForScenario([ocr], TITLE, sOccl, '1:1', false, null)).toBeNull();
    // 当前遮挡开启 → 匹配
    expect(matchOcrForScenario([ocr], TITLE, sOccl, '1:1', true, null)?.status).toBe('保持一致');
  });

  it('退化参数一致才复用（退化预设 vs 当前退化设置）', () => {
    const sDeg = resolveScenarios(['deg-medium'], '1:1', false, IMAGE_W, IMAGE_H)[0];
    // 当前未启用退化 → 不匹配
    expect(matchOcrForScenario([ocr], TITLE, sDeg, '1:1', false, null)).toBeNull();
    // 当前启用但参数不同 → 不匹配
    expect(
      matchOcrForScenario([ocr], TITLE, sDeg, '1:1', false, { scaleFactor: 0.75, jpegQuality: 0.9 }),
    ).toBeNull();
    // 当前启用且参数一致 → 匹配
    expect(
      matchOcrForScenario([ocr], TITLE, sDeg, '1:1', false, { scaleFactor: 0.5, jpegQuality: 0.7 })?.status,
    ).toBe('保持一致');
  });

  it('无对应标注结果时不复用', () => {
    const scenario = resolveScenarios(['crop-1-1'], '1:1', false, IMAGE_W, IMAGE_H)[0];
    expect(matchOcrForScenario([ocr], DATE, scenario, '1:1', false, null)).toBeNull();
  });
});

describe('buildMultiScenarioSummary：摘要计数', () => {
  function makeScenarioResult(
    id: string,
    levels: RegionScenarioResult['level'][],
    qrStatuses: (QrMatrixData['status'] | null)[] = [],
  ): ScenarioResult {
    return {
      definition: ALL_SCENARIOS.find((s) => s.id === id)!,
      detail: id,
      regions: levels.map((level, i) => ({
        annotationId: `a${i}`,
        label: '其他' as const,
        cropKeptRatio: 1,
        finalVisibleRatio: 1,
        level,
        problemSource: '无明显问题' as const,
        cropDirection: null,
        occlusionSource: null,
        suggestion: '当前信息完整可见，无需调整。',
        qr: qrStatuses[i] ? ({ status: qrStatuses[i] } as QrMatrixData) : null,
        ocr: null,
      })),
    };
  }

  it('场景数 = 结果数；严重缺失与 QR 失败按场景计数', () => {
    const scenarios = [
      makeScenarioResult('crop-1-1', ['完整', '部分可见'], [null, null]),
      makeScenarioResult('crop-9-16', ['严重缺失', '完整'], ['无法识别', null]),
      makeScenarioResult('crop-4-5', ['完整', '完整'], [null, '原图不可识别']),
    ];
    const summary = buildMultiScenarioSummary(scenarios);
    expect(summary.testedScenarioCount).toBe(3);
    expect(summary.missingScenarioCount).toBe(1); // 只有 crop-9-16
    expect(summary.qrFailureScenarioCount).toBe(1); // 只有「无法识别」计入，原图不可识别不计
  });

  it('空场景列表 → 全零摘要', () => {
    expect(buildMultiScenarioSummary([])).toEqual({
      testedScenarioCount: 0,
      missingScenarioCount: 0,
      qrFailureScenarioCount: 0,
    });
  });
});

describe('多场景结果失效规则', () => {
  it('输入完全一致 → 结果仍有效', () => {
    const run = makeRunResult();
    expect(
      isScenarioRunValid(run, run.image, run.annotations, ['crop-1-1'], '1:1', false),
    ).toBe(true);
  });

  it('原图变化 → 失效', () => {
    const run = makeRunResult();
    expect(isScenarioRunValid(run, {} as HTMLImageElement, [TITLE], ['crop-1-1'], '1:1', false)).toBe(false);
  });

  it('标注变化（新数组引用）→ 失效', () => {
    const run = makeRunResult();
    expect(isScenarioRunValid(run, run.image, [TITLE, DATE], ['crop-1-1'], '1:1', false)).toBe(false);
  });

  it('场景选择变化 → 失效', () => {
    const run = makeRunResult();
    expect(isScenarioRunValid(run, run.image, [TITLE], ['crop-4-5'], '1:1', false)).toBe(false);
  });

  it('当前裁剪比例或遮挡开关变化 → 失效', () => {
    const run = makeRunResult();
    expect(isScenarioRunValid(run, run.image, [TITLE], ['crop-1-1'], '9:16', false)).toBe(false);
    expect(isScenarioRunValid(run, run.image, [TITLE], ['crop-1-1'], '1:1', true)).toBe(false);
  });

  it('sameScenarioIds：顺序无关的集合比较', () => {
    expect(sameScenarioIds(['a', 'b'], ['b', 'a'])).toBe(true);
    expect(sameScenarioIds(['a', 'b'], ['a'])).toBe(false);
    expect(sameScenarioIds(['a', 'b'], ['a', 'c'])).toBe(false);
    expect(sameScenarioIds([], [])).toBe(true);
  });
});
