/**
 * 传播风险报告 PNG 导出工具（纯前端 DOM 转图片）。
 *
 * 职责边界：
 * - 只把 RiskReport 组件当前已显示的同一份报告 DOM 导出为 PNG 并本地下载；
 * - 不重新生成报告数据，不包含任何新的判断规则；
 * - 不调用后端截图服务，不调用云端 API，不上传任何数据到外部服务。
 */
import { toPng } from 'html-to-image';

/** 补零：9 → "09"（保证文件名格式稳定） */
function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * 生成报告 PNG 文件名（纯函数）。
 * 格式：传播实验室_传播风险报告_2026-09-28_1530.png
 * 日期时间不使用冒号，规避 Windows 非法文件名字符。
 */
export function buildReportPngFileName(now: Date): string {
  const date = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  const time = `${pad2(now.getHours())}${pad2(now.getMinutes())}`;
  return `传播实验室_传播风险报告_${date}_${time}.png`;
}

/** 导出结果：成功，或失败（携带错误对象，调用方据此显示提示） */
export type ExportOutcome = { ok: true } | { ok: false; error: Error };

/** 触发浏览器本地下载（仅本地数据，不经过任何外部服务） */
function triggerDownload(dataUrl: string, fileName: string): void {
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/**
 * 把报告 DOM 节点导出为 PNG 并下载。
 * - pixelRatio 2 保证清晰度（不拉伸变形，仅等比提高像素密度）；
 * - 白色不透明背景；
 * - 任何异常都转为 { ok: false } 返回，不让 React 页面崩溃。
 */
export async function exportReportToPng(
  node: HTMLElement,
  fileName: string,
): Promise<ExportOutcome> {
  try {
    const dataUrl = await toPng(node, {
      pixelRatio: 2,
      backgroundColor: '#ffffff',
    });
    triggerDownload(dataUrl, fileName);
    return { ok: true };
  } catch (error) {
    console.error('报告 PNG 导出失败：', error);
    return { ok: false, error: error instanceof Error ? error : new Error(String(error)) };
  }
}
