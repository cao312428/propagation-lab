/**
 * 传播风险报告数据整理的单元测试。
 * 诊断结果全部用真实的 diagnoseAnnotation 生成（不写第二套判断算法），
 * 覆盖：全部完整 / 三种状态混合 / 严重缺失排最前 / 同级别顺序稳定 /
 *       开启遮挡与 9:16 场景文案 / 二维码传播失败（B）/ 原图无法识别不误判（C）。
 */
import { describe, expect, it } from 'vitest';
import type { Annotation, CropRatio } from '../types';
import { diagnoseAnnotation } from '../utils/diagnosis';
import type { QrCheckResult } from '../utils/qrDetection';
import {
  buildReportData,
  buildSummary,
  formatCropRatioText,
  formatOcclusionText,
  type ReportInput,
} from '../utils/report';

/** 构造一条测试标注（坐标均为原图坐标） */
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

/** 构造报告输入（默认无标注、1:1、无遮挡、无画质退化） */
function makeInput(overrides: Partial<ReportInput>): ReportInput {
  return {
    fileName: 'demo.png',
    imageWidth: 1000,
    imageHeight: 1000,
    cropRatio: '1:1' as CropRatio,
    occlusionEnabled: false,
    degradation: { enabled: false, scaleFactor: 0.5, jpegQuality: 0.7 },
    sceneWidth: 1000,
    sceneHeight: 1000,
    degradedQrResults: new Map(),
    diagnoses: [],
    qrResults: new Map(),
    ocrResults: new Map(),
    ...overrides,
  };
}

describe('buildReportData：数量统计与摘要', () => {
  it('所有区域完整：数量统计与摘要正确', () => {
    const crop = { x: 0, y: 0, w: 1000, h: 1000 };
    const diagnoses = [
      diagnoseAnnotation(makeAnnotation('a1', 100, 150, 300, 300, '标题'), crop, null),
      diagnoseAnnotation(makeAnnotation('a2', 500, 500, 200, 200, '日期'), crop, null),
      diagnoseAnnotation(makeAnnotation('a3', 700, 700, 100, 100, '地点'), crop, null),
    ];
    const data = buildReportData(makeInput({ diagnoses }));
    expect(data.totalCount).toBe(3);
    expect(data.fullCount).toBe(3);
    expect(data.partialCount).toBe(0);
    expect(data.missingCount).toBe(0);
    expect(data.summary).toBe('本次共检测3个重要信息区域，其中3个完整、0个部分可见、0个严重缺失。');
    expect(data.qrFailureCount).toBe(0);
  });

  it('同时存在完整 / 部分可见 / 严重缺失：数量统计与摘要正确', () => {
    const crop = { x: 0, y: 0, w: 500, h: 1000 };
    const full = diagnoseAnnotation(
      makeAnnotation('full', 100, 100, 300, 200, '标题'),
      crop,
      null,
    );
    const partial = diagnoseAnnotation(
      makeAnnotation('partial', 400, 100, 200, 200, '日期'), // 保留率 0.5
      crop,
      null,
    );
    const missing = diagnoseAnnotation(
      makeAnnotation('missing', 450, 100, 200, 200, '地点'), // 保留率 0.25
      crop,
      null,
    );
    const data = buildReportData(makeInput({ diagnoses: [partial, full, missing] }));
    expect(data.fullCount).toBe(1);
    expect(data.partialCount).toBe(1);
    expect(data.missingCount).toBe(1);
    expect(data.summary).toBe('本次共检测3个重要信息区域，其中1个完整、1个部分可见、1个严重缺失。');
  });
});

describe('buildReportData：列表排序', () => {
  const crop = { x: 0, y: 0, w: 500, h: 1000 };

  it('严重缺失排在最前，其次部分可见，最后完整（不受输入顺序影响）', () => {
    const full = diagnoseAnnotation(makeAnnotation('full', 100, 100, 300, 200), crop, null);
    const partial = diagnoseAnnotation(makeAnnotation('partial', 400, 100, 200, 200), crop, null);
    const missing = diagnoseAnnotation(makeAnnotation('missing', 450, 100, 200, 200), crop, null);
    // 故意打乱输入顺序
    const data = buildReportData(makeInput({ diagnoses: [partial, full, missing] }));
    expect(data.items.map((i) => i.diagnosis.annotation.id)).toEqual([
      'missing',
      'partial',
      'full',
    ]);
    expect(data.items[0].diagnosis.level).toBe('严重缺失');
    expect(data.items[1].diagnosis.level).toBe('部分可见');
    expect(data.items[2].diagnosis.level).toBe('完整');
  });

  it('同级别保持原有顺序（稳定排序）', () => {
    const cropFull = { x: 0, y: 0, w: 1000, h: 1000 };
    const b1 = diagnoseAnnotation(makeAnnotation('b1', 100, 100, 200, 200), cropFull, null);
    const b2 = diagnoseAnnotation(makeAnnotation('b2', 400, 100, 200, 200), cropFull, null);
    const b3 = diagnoseAnnotation(makeAnnotation('b3', 700, 100, 200, 200), cropFull, null);
    const data = buildReportData(makeInput({ diagnoses: [b3, b1, b2] }));
    expect(data.items.map((i) => i.diagnosis.annotation.id)).toEqual(['b3', 'b1', 'b2']);
  });
});

describe('buildReportData：测试场景信息', () => {
  it('9:16 + 开启遮挡：场景与遮挡文案正确', () => {
    const data = buildReportData(
      makeInput({ cropRatio: '9:16', occlusionEnabled: true }),
    );
    expect(data.cropRatioText).toBe('9:16 居中裁剪');
    expect(data.occlusionText).toBe('已开启');
  });

  it('1:1 + 未开启遮挡：场景与遮挡文案正确', () => {
    const data = buildReportData(makeInput({}));
    expect(data.cropRatioText).toBe('1:1 居中裁剪');
    expect(data.occlusionText).toBe('未开启');
  });
});

describe('buildReportData：二维码特殊结果', () => {
  const crop = { x: 0, y: 0, w: 1000, h: 1000 };
  const qrDiag = diagnoseAnnotation(
    makeAnnotation('qr1', 100, 100, 300, 300, '二维码'),
    crop,
    null,
  );

  it('baseline 可识别 + 当前场景失败：计入二维码失效并在摘要中说明', () => {
    const qrResults = new Map<string, QrCheckResult>([
      [
        'qr1',
        {
          baselineReadable: true,
          baselineContent: 'https://example.com',
          scenarioReadable: false,
          conclusion: '传播处理后二维码识别失败',
        },
      ],
    ]);
    const data = buildReportData(makeInput({ diagnoses: [qrDiag], qrResults }));
    expect(data.qrFailureCount).toBe(1);
    expect(data.summary).toBe(
      '本次共检测1个重要信息区域，其中1个完整、0个部分可见、0个严重缺失。其中1个二维码在当前传播场景下无法被本地解码器识别。',
    );
    expect(data.items[0].qr?.conclusion).toBe('传播处理后二维码识别失败');
  });

  it('baseline 无法识别：不计入二维码失效，不宣称「传播导致失效」', () => {
    const qrResults = new Map<string, QrCheckResult>([
      [
        'qr1',
        {
          baselineReadable: false,
          scenarioReadable: false,
          conclusion: '原图二维码未能成功识别，无法据此判断传播处理是否导致失效',
        },
      ],
    ]);
    const data = buildReportData(makeInput({ diagnoses: [qrDiag], qrResults }));
    expect(data.qrFailureCount).toBe(0);
    // 摘要中不出现二维码失效的补充句
    expect(data.summary).toBe(
      '本次共检测1个重要信息区域，其中1个完整、0个部分可见、0个严重缺失。',
    );
  });

  it('多种二维码结论并存：只统计真正「传播导致失效」的数量', () => {
    const diagA = diagnoseAnnotation(makeAnnotation('qrA', 100, 100, 200, 200, '二维码'), crop, null);
    const diagB = diagnoseAnnotation(makeAnnotation('qrB', 400, 100, 200, 200, '二维码'), crop, null);
    const diagC = diagnoseAnnotation(makeAnnotation('qrC', 700, 100, 200, 200, '二维码'), crop, null);
    const qrResults = new Map<string, QrCheckResult>([
      ['qrA', { baselineReadable: true, scenarioReadable: true, conclusion: '当前场景下二维码仍可识别' }],
      ['qrB', { baselineReadable: true, scenarioReadable: false, conclusion: '传播处理后二维码识别失败' }],
      ['qrC', { baselineReadable: false, scenarioReadable: false, conclusion: '原图二维码未能成功识别，无法据此判断传播处理是否导致失效' }],
    ]);
    const data = buildReportData(
      makeInput({ diagnoses: [diagA, diagB, diagC], qrResults }),
    );
    expect(data.qrFailureCount).toBe(1);
    expect(data.summary).toBe(
      '本次共检测3个重要信息区域，其中3个完整、0个部分可见、0个严重缺失。其中1个二维码在当前传播场景下无法被本地解码器识别。',
    );
  });
});

describe('buildSummary 与文案函数', () => {
  it('无二维码失效时摘要只包含区域统计', () => {
    expect(buildSummary(5, 2, 2, 1, 0)).toBe(
      '本次共检测5个重要信息区域，其中2个完整、2个部分可见、1个严重缺失。',
    );
  });

  it('有二维码失效时摘要追加失效说明', () => {
    expect(buildSummary(5, 2, 2, 1, 1)).toBe(
      '本次共检测5个重要信息区域，其中2个完整、2个部分可见、1个严重缺失。其中1个二维码在当前传播场景下无法被本地解码器识别。',
    );
  });

  it('裁剪比例文案', () => {
    expect(formatCropRatioText('1:1')).toBe('1:1 居中裁剪');
    expect(formatCropRatioText('9:16')).toBe('9:16 居中裁剪');
  });

  it('遮挡开关文案', () => {
    expect(formatOcclusionText(true)).toBe('已开启');
    expect(formatOcclusionText(false)).toBe('未开启');
  });
});
