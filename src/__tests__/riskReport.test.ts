/**
 * 传播风险报告组件的静态渲染测试（Node 环境，不引入浏览器 DOM 测试设施）。
 *
 * 用 react-dom/server 的 renderToStaticMarkup 验证报告 DOM 中的关键文案：
 * - 标题层级（产品名 + 主标题）
 * - 报告生成时间
 * - 长文件名完整渲染（显示层处理换行，业务数据不被截断）
 * - 原有报告区域内容仍然存在
 *
 * html-to-image 被 mock，不执行真实截图；真实导出效果由浏览器人工验收。
 */
import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { RiskReport } from '../components/RiskReport';
import type { ReportData } from '../utils/report';

vi.mock('html-to-image', () => ({
  toPng: vi.fn(),
}));

/** 构造一份最小报告数据（结构与 buildReportData 输出一致） */
function makeReportData(overrides: Partial<ReportData> = {}): ReportData {
  return {
    fileName: 'demo.png',
    imageWidth: 1000,
    imageHeight: 1000,
    cropRatioText: '1:1 居中裁剪',
    occlusionText: '未开启',
    degradationText: '未开启',
    degradationDetail: null,
    totalCount: 1,
    fullCount: 1,
    partialCount: 0,
    missingCount: 0,
    summary: '本次共检测1个重要信息区域，其中1个完整、0个部分可见、0个严重缺失。',
    generatedAtText: '2026-09-30 13:45',
    qrFailureCount: 0,
    multiScenarioSummary: null,
    items: [],
    ...overrides,
  };
}

/** 渲染报告并返回静态 HTML 字符串 */
function renderReport(data: ReportData): string {
  return renderToStaticMarkup(createElement(RiskReport, { data }));
}

describe('RiskReport：报告头部与基础信息', () => {
  it('报告包含「传播风险报告」主标题与「传播实验室」产品名', () => {
    const html = renderReport(makeReportData());
    expect(html).toContain('传播风险报告');
    expect(html).toContain('传播实验室');
  });

  it('报告包含「报告生成时间」及其文案', () => {
    const html = renderReport(makeReportData());
    expect(html).toContain('报告生成时间');
    expect(html).toContain('2026-09-30 13:45');
  });

  it('长文件名完整渲染到报告 DOM（数据不被截断，换行由显示层处理）', () => {
    const longName = `${'x'.repeat(120)}.png`;
    const html = renderReport(makeReportData({ fileName: longName }));
    expect(html).toContain(longName);
  });

  it('原有报告区域内容保持存在', () => {
    const html = renderReport(makeReportData());
    expect(html).toContain('问题区域列表');
    expect(html).toContain('标注区域总数');
    expect(html).toContain('检测结果分布');
    expect(html).toContain('本报告中的可见率为基于图像区域裁剪与遮挡计算得到的几何面积比例');
  });
});
