/**
 * UI 交互与无障碍属性测试（Node 环境静态渲染，不引入浏览器 DOM 测试设施）。
 *
 * 用 react-dom/server 的 renderToStaticMarkup 验证本轮新增的语义属性：
 * - 上传面板的可访问名称与键盘可达性标记
 * - 可折叠区块的 aria-expanded
 * - 删除按钮的 aria-label
 * - 报告导出按钮的 aria-busy 初始状态
 *
 * 只验证属性存在，不断言任何 CSS 像素与时间秒数。
 */
import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { UploadPanel } from '../components/UploadPanel';
import { CollapsibleSection } from '../components/CollapsibleSection';
import { AnnotationList } from '../components/AnnotationList';
import { RiskReport } from '../components/RiskReport';
import type { Analysis } from '../components/CropPreview';
import type { ReportData } from '../utils/report';

vi.mock('html-to-image', () => ({
  toPng: vi.fn(),
}));

describe('UploadPanel：可访问性与键盘可达', () => {
  it('上传区域具有可访问名称与键盘可达标记', () => {
    const html = renderToStaticMarkup(createElement(UploadPanel, { onFile: () => {} }));
    expect(html).toContain('role="button"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('aria-label="上传作品图片，支持点击或拖拽选择 PNG 或 JPG 文件"');
    // 文件输入仍然存在（点击与键盘操作的目标）
    expect(html).toContain('type="file"');
  });
});

describe('CollapsibleSection：展开状态语义', () => {
  it('默认展开时 aria-expanded 为 true', () => {
    const html = renderToStaticMarkup(
      createElement(CollapsibleSection, {
        title: '标注清单',
        count: 2,
        children: createElement('div', null, '内容'),
      }),
    );
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('type="button"');
  });

  it('默认收起时 aria-expanded 为 false', () => {
    const html = renderToStaticMarkup(
      createElement(CollapsibleSection, {
        title: '版本对比',
        defaultOpen: false,
        children: createElement('div', null, '内容'),
      }),
    );
    expect(html).toContain('aria-expanded="false"');
  });
});

describe('AnnotationList：删除按钮可访问名称', () => {
  it('删除按钮带有 aria-label', () => {
    const analyses: Analysis[] = [
      {
        annotation: { id: 'a1', x: 10, y: 10, w: 100, h: 100, label: '标题' },
        ratio: 1,
        level: '完整',
        finalRatio: 1,
        finalLevel: '完整',
      },
    ];
    const html = renderToStaticMarkup(
      createElement(AnnotationList, {
        analyses,
        onChangeLabel: () => {},
        onDelete: () => {},
      }),
    );
    expect(html).toContain('aria-label="删除该标注"');
    expect(html).toContain('最终可见率'); // 原有业务展示仍然存在
  });
});

describe('RiskReport：导出按钮状态语义', () => {
  it('导出按钮初始未导出（aria-busy 为 false）且文案存在', () => {
    const data: ReportData = {
      fileName: 'demo.png',
      imageWidth: 1000,
      imageHeight: 1000,
      cropRatioText: '1:1 居中裁剪',
      occlusionText: '未开启',
      degradationText: '未开启',
      degradationDetail: null,
      totalCount: 0,
      fullCount: 0,
      partialCount: 0,
      missingCount: 0,
      summary: '本次共检测0个重要信息区域，其中0个完整、0个部分可见、0个严重缺失。',
      generatedAtText: '2026-09-30 13:45',
      qrFailureCount: 0,
      multiScenarioSummary: null,
      items: [],
    };
    const html = renderToStaticMarkup(createElement(RiskReport, { data }));
    expect(html).toContain('aria-busy="false"');
    expect(html).toContain('导出报告 PNG');
    expect(html).toContain('报告生成时间');
  });
});
