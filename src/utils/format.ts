/** 格式化工具函数 */

/** 百分比格式化：0.8533 → "85.3%" */
export function formatPercent(ratio: number, digits = 1): string {
  return `${(ratio * 100).toFixed(digits)}%`;
}

/** 像素尺寸显示：1920 × 1080 px */
export function formatSize(w: number, h: number): string {
  return `${Math.round(w)} × ${Math.round(h)} px`;
}
