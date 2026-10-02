/**
 * 二维码自动发现单元测试（Node 环境纯函数部分，不依赖网络与真实图片像素）：
 * - jsQR location 四角 → 候选矩形（原图坐标 + padding + 边界限制）
 * - 高重叠判断（不重复添加）
 * - candidate 确认后生成与手动画框完全等价的普通二维码标注（原图坐标不变）
 * - 自动生成的标注能进入多场景测试
 * - QrScanPanel 静态渲染（未发现 / 候选 / 重复禁用）
 */
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Annotation } from '../types';
import {
  buildQrAnnotation,
  computeOverlapRatio,
  isHighlyOverlapping,
  qrLocationToRect,
  QR_CANDIDATE_OVERLAP_THRESHOLD,
  QR_CANDIDATE_PADDING_PX,
  QR_SCAN_NOT_FOUND_TEXT,
  type QrCandidate,
} from '../utils/qrAutoDetect';
import { buildScenarioResults, resolveScenarios } from '../utils/multiScenario';
import { QrScanPanel } from '../components/QrScanPanel';

/** 构造一个 jsQR 风格的 location（四角坐标） */
function makeLocation(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): Parameters<typeof qrLocationToRect>[0] {
  return {
    topLeftCorner: { x: x0, y: y0 },
    topRightCorner: { x: x1, y: y0 },
    bottomLeftCorner: { x: x0, y: y1 },
    bottomRightCorner: { x: x1, y: y1 },
  };
}

/** 构造一个候选 */
function makeCandidate(x: number, y: number, w: number, h: number): QrCandidate {
  return { rect: { x, y, w, h }, content: 'https://example.com/activity' };
}

describe('qrLocationToRect：jsQR location → 候选矩形', () => {
  it('由四角包围盒计算 minX/minY/maxX/maxY 并加 padding', () => {
    // 检测框 100,100 → 200,200（100×100），padding 8 → 92,92 → 208,208
    const rect = qrLocationToRect(makeLocation(100, 100, 200, 200), 8, 1000, 800);
    expect(rect).toEqual({ x: 92, y: 92, w: 116, h: 116 });
  });

  it('矩形不超出原图边界（靠近边缘时被 clamp）', () => {
    const rect = qrLocationToRect(makeLocation(0, 0, 100, 100), 8, 1000, 800);
    expect(rect).toEqual({ x: 0, y: 0, w: 108, h: 108 });
    // 右下角贴近边界
    const rect2 = qrLocationToRect(makeLocation(950, 750, 1000, 800), 8, 1000, 800);
    expect(rect2).toEqual({ x: 942, y: 742, w: 58, h: 58 });
  });

  it('location 包围盒退化（宽或高 ≤ 0）→ null，不生成假候选', () => {
    expect(qrLocationToRect(makeLocation(100, 100, 100, 100), 8, 1000, 800)).toBeNull();
  });

  it('候选矩形永远在原图内（大 padding 也不越界）', () => {
    const rect = qrLocationToRect(makeLocation(10, 10, 60, 60), QR_CANDIDATE_PADDING_PX, 100, 100);
    expect(rect).not.toBeNull();
    expect(rect!.x).toBeGreaterThanOrEqual(0);
    expect(rect!.y).toBeGreaterThanOrEqual(0);
    expect(rect!.x + rect!.w).toBeLessThanOrEqual(100);
    expect(rect!.y + rect!.h).toBeLessThanOrEqual(100);
  });
});

describe('computeOverlapRatio / isHighlyOverlapping：高重叠判断', () => {
  it('完全重合 → 重叠比例 1，判定高度重叠', () => {
    const a = { x: 0, y: 0, w: 100, h: 100 };
    expect(computeOverlapRatio(a, a)).toBe(1);
    expect(isHighlyOverlapping(a, a)).toBe(true);
  });

  it('重叠比例 ≥ 80% → 高度重叠（含临界值）', () => {
    // b 相对 a 下移 20px：交集 100×80 = 8000，较小面积 100×100 = 10000 → 0.8
    const a = { x: 0, y: 0, w: 100, h: 100 };
    const b = { x: 0, y: 20, w: 100, h: 100 };
    expect(computeOverlapRatio(a, b)).toBeCloseTo(QR_CANDIDATE_OVERLAP_THRESHOLD, 10);
    expect(isHighlyOverlapping(a, b)).toBe(true);
  });

  it('低重叠（< 80%）→ 不判定高度重叠，允许添加', () => {
    const a = { x: 0, y: 0, w: 100, h: 100 };
    const b = { x: 50, y: 0, w: 100, h: 100 }; // 交集 50 / 100 = 50%
    expect(isHighlyOverlapping(a, b)).toBe(false);
  });

  it('不相交 → 重叠比例 0', () => {
    expect(computeOverlapRatio({ x: 0, y: 0, w: 10, h: 10 }, { x: 50, y: 50, w: 10, h: 10 })).toBe(0);
  });
});

describe('buildQrAnnotation：candidate 确认后生成普通二维码标注', () => {
  it('生成结构与手动画框完全等价：id + 二维码标签 + 原图坐标矩形', () => {
    const candidate = makeCandidate(92, 92, 116, 116);
    const annotation = buildQrAnnotation(candidate, 'auto-1');
    expect(annotation).toEqual({
      id: 'auto-1',
      label: '二维码',
      x: 92,
      y: 92,
      w: 116,
      h: 116,
    });
    // 手工标注的字段集合完全一致（无额外字段）
    const manual: Annotation = { id: 'auto-1', label: '二维码', x: 92, y: 92, w: 116, h: 116 };
    expect(annotation).toEqual(manual);
  });

  it('自动二维码标注保持原图坐标（rect 原样传递，无任何显示坐标换算）', () => {
    const candidate = makeCandidate(17, 25, 200, 200);
    const annotation = buildQrAnnotation(candidate, 'auto-2');
    expect(annotation.x).toBe(candidate.rect.x);
    expect(annotation.y).toBe(candidate.rect.y);
    expect(annotation.w).toBe(candidate.rect.w);
    expect(annotation.h).toBe(candidate.rect.h);
  });

  it('自动二维码标注能进入多场景测试（与手工标注同样参与）', () => {
    const candidate = makeCandidate(400, 400, 200, 200);
    const annotation = buildQrAnnotation(candidate, 'auto-3');
    const scenarios = resolveScenarios(['crop-1-1', 'crop-9-16'], '1:1', false, 1920, 1080);
    const results = buildScenarioResults([annotation], scenarios, new Map(), [], '1:1', false, null);
    expect(results).toHaveLength(2);
    for (const s of results) {
      expect(s.regions).toHaveLength(1);
      expect(s.regions[0].annotationId).toBe('auto-3');
      expect(s.regions[0].label).toBe('二维码');
      // 几何字段由统一诊断管线生成（复用 diagnoseAnnotation）
      expect(s.regions[0].finalVisibleRatio).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('QrScanPanel：静态渲染（Node 环境）', () => {
  const baseProps = {
    hasImage: true,
    scanning: false,
    candidates: null,
    qrAnnotations: [] as Annotation[],
    onScan: () => {},
    onAdd: () => {},
    onIgnore: () => {},
  };

  it('未发现二维码时显示中性提示（不是错误）', () => {
    const html = renderToStaticMarkup(
      createElement(QrScanPanel, { ...baseProps, candidates: [] }),
    );
    expect(html).toContain(QR_SCAN_NOT_FOUND_TEXT);
    expect(html).toContain('扫描二维码');
  });

  it('存在候选时显示二维码内容与「添加为二维码标注 / 忽略」按钮', () => {
    const html = renderToStaticMarkup(
      createElement(QrScanPanel, {
        ...baseProps,
        candidates: [makeCandidate(100, 100, 200, 200)],
      }),
    );
    expect(html).toContain('添加为二维码标注');
    expect(html).toContain('忽略');
    expect(html).toContain('https://example.com/activity'); // 内容展示，不打开链接
  });

  it('与已有二维码标注高度重叠的候选：添加按钮禁用并说明（不重复添加）', () => {
    const html = renderToStaticMarkup(
      createElement(QrScanPanel, {
        ...baseProps,
        candidates: [makeCandidate(100, 100, 200, 200)],
        qrAnnotations: [
          { id: 'existing', label: '二维码', x: 100, y: 100, w: 200, h: 200 },
        ],
      }),
    );
    expect(html).toContain('与已有二维码标注高度重叠');
    expect(html).toContain('disabled=""');
  });

  it('扫描中显示运行状态，未扫描时不显示结果区', () => {
    const scanningHtml = renderToStaticMarkup(
      createElement(QrScanPanel, { ...baseProps, scanning: true }),
    );
    expect(scanningHtml).toContain('正在扫描');
    const idleHtml = renderToStaticMarkup(createElement(QrScanPanel, baseProps));
    expect(idleHtml).not.toContain(QR_SCAN_NOT_FOUND_TEXT); // 未扫描过，不显示「未发现」
  });
});
