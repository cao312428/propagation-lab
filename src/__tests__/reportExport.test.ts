/**
 * 报告 PNG 导出工具的单元测试。
 * 只测试纯逻辑（文件名生成、失败错误处理），不在 Node 环境执行真实 DOM 截图：
 * - html-to-image 被 mock；
 * - 真实导出效果在浏览器中人工验收。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toPng } from 'html-to-image';
import { buildReportPngFileName, exportReportToPng } from '../utils/reportExport';

// mock 第三方库：避免在 Node 测试环境执行真实浏览器截图
vi.mock('html-to-image', () => ({
  toPng: vi.fn(),
}));

describe('buildReportPngFileName：文件名生成', () => {
  it('文件名包含「传播实验室」', () => {
    const name = buildReportPngFileName(new Date(2026, 8, 28, 15, 30));
    expect(name).toContain('传播实验室');
  });

  it('文件名包含「传播风险报告」', () => {
    const name = buildReportPngFileName(new Date(2026, 8, 28, 15, 30));
    expect(name).toContain('传播风险报告');
  });

  it('文件名不包含 Windows 非法字符（\\ / : * ? " < > |）', () => {
    // 覆盖补零与边界：1 月 5 日 9 点 5 分、12 月 31 日 23 点 59 分
    const times = [
      new Date(2026, 8, 28, 15, 30),
      new Date(2026, 0, 5, 9, 5),
      new Date(2030, 11, 31, 23, 59),
    ];
    for (const t of times) {
      expect(buildReportPngFileName(t)).not.toMatch(/[\\/:*?"<>|]/);
    }
  });

  it('文件名以 .png 结尾', () => {
    const name = buildReportPngFileName(new Date(2026, 8, 28, 15, 30));
    expect(name.endsWith('.png')).toBe(true);
  });

  it('固定时间生成的文件名格式稳定', () => {
    expect(buildReportPngFileName(new Date(2026, 8, 28, 15, 30))).toBe(
      '传播实验室_传播风险报告_2026-09-28_1530.png',
    );
  });

  it('不同时间生成的文件名遵循同一格式', () => {
    const a = buildReportPngFileName(new Date(2026, 8, 28, 15, 30));
    const b = buildReportPngFileName(new Date(2027, 0, 5, 9, 5));
    const pattern = /^传播实验室_传播风险报告_\d{4}-\d{2}-\d{2}_\d{4}\.png$/;
    expect(a).toMatch(pattern);
    expect(b).toMatch(pattern);
    expect(a).not.toBe(b);
  });
});

describe('exportReportToPng：错误处理', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('导出失败时返回可处理的错误状态（不抛出异常）', async () => {
    vi.mocked(toPng).mockRejectedValueOnce(new Error('mock 导出失败'));
    // 静音 console.error，避免测试输出噪音
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // 失败路径不会触发下载，无需真实 DOM；成功路径（含下载）由浏览器人工验收
    const outcome = await exportReportToPng({} as HTMLElement, '测试.png');
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error).toBeInstanceOf(Error);
      expect(outcome.error.message).toBe('mock 导出失败');
    }
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
