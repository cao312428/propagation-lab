/** 格式化工具函数 */

/** 百分比格式化：0.8533 → "85.3%" */
export function formatPercent(ratio: number, digits = 1): string {
  return `${(ratio * 100).toFixed(digits)}%`;
}

/** 像素尺寸显示：1920 × 1080 px */
export function formatSize(w: number, h: number): string {
  return `${Math.round(w)} × ${Math.round(h)} px`;
}

/** 补零：9 → "09" */
function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * 报告生成时间文案：2026-09-30 13:45（本地时间，分钟级）。
 * 仅供报告展示，不参与任何检测计算。
 */
export function formatReportTime(now: Date): string {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())} ${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
}
