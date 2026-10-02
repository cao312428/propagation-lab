/**
 * 二维码自动发现模块。
 *
 * 用现有 jsQR 对原图真实像素做全图扫描（本地解码，不联网），
 * 从 location 四角坐标生成候选矩形（原图坐标系，加小 padding 并限制在图片边界内）。
 *
 * 候选不会静默转正：由用户在界面确认后，才通过统一的 addAnnotation
 * 生成与手动画框完全等价的普通「二维码」标注。
 * 不打开 URL、不发送网络请求、不做任何安全评级。
 */
import jsQR from 'jsqr';
import type { Annotation, Rect } from '../types';
import { intersectRect, rectArea } from './geometry';

/* ------------------------------------------------------------------
 * 候选规则参数（项目产品规则）
 * ------------------------------------------------------------------ */

/** 候选矩形四周的小 padding（像素，相对检测框） */
export const QR_CANDIDATE_PADDING_PX = 8;

/** 单次扫描的候选数量上限（避免极端图片导致长时间扫描） */
export const QR_SCAN_MAX_CANDIDATES = 8;

/** 高度重叠阈值：交集面积 / 较小面积 ≥ 该值视为与已有标注重复 */
export const QR_CANDIDATE_OVERLAP_THRESHOLD = 0.8;

/** 未发现二维码的中性提示（不是错误） */
export const QR_SCAN_NOT_FOUND_TEXT = '未检测到可解码二维码。';

/** 二维码候选（原图坐标矩形 + 解码内容） */
export interface QrCandidate {
  /** 候选矩形（原图坐标，含小 padding，已在图片边界内） */
  rect: Rect;
  /** jsQR 解码出的内容（仅展示，不自动打开 URL） */
  content: string;
}

/** jsQR location 的四角坐标（与 jsqr 库的 QRLocation 结构一致） */
export interface QrCornerLocation {
  topLeftCorner: { x: number; y: number };
  topRightCorner: { x: number; y: number };
  bottomLeftCorner: { x: number; y: number };
  bottomRightCorner: { x: number; y: number };
}

/**
 * 由 jsQR location 四角坐标计算候选矩形（纯函数，原图坐标）：
 * 取四角包围盒 → 四周加小 padding → 限制在图片边界内。
 * location 无效（包围盒退化 / 完全越界）返回 null，不生成假候选。
 */
export function qrLocationToRect(
  location: QrCornerLocation,
  padPx: number,
  imageW: number,
  imageH: number,
): Rect | null {
  const corners = [
    location.topLeftCorner,
    location.topRightCorner,
    location.bottomLeftCorner,
    location.bottomRightCorner,
  ];
  const minX = Math.min(...corners.map((c) => c.x));
  const minY = Math.min(...corners.map((c) => c.y));
  const maxX = Math.max(...corners.map((c) => c.x));
  const maxY = Math.max(...corners.map((c) => c.y));
  if (maxX <= minX || maxY <= minY) return null;
  const x = Math.max(0, minX - padPx);
  const y = Math.max(0, minY - padPx);
  const right = Math.min(imageW, maxX + padPx);
  const bottom = Math.min(imageH, maxY + padPx);
  if (right <= x || bottom <= y) return null;
  return { x, y, w: right - x, h: bottom - y };
}

/** 两个矩形的重叠比例 = 交集面积 / 较小面积（0～1） */
export function computeOverlapRatio(a: Rect, b: Rect): number {
  const inter = intersectRect(a, b);
  if (!inter) return 0;
  const minArea = Math.min(rectArea(a), rectArea(b));
  if (minArea <= 0) return 0;
  return rectArea(inter) / minArea;
}

/** 判断候选矩形是否与已有标注高度重叠（避免重复添加） */
export function isHighlyOverlapping(a: Rect, b: Rect): boolean {
  return computeOverlapRatio(a, b) >= QR_CANDIDATE_OVERLAP_THRESHOLD;
}

/**
 * 由候选生成一条普通「二维码」标注（纯函数）。
 * 结构与手动画框完全一致：仅 id / label / 原图坐标矩形，
 * 可正常参与单场景测试、多场景测试、二维码检测、风险矩阵、版本比较与风险报告。
 */
export function buildQrAnnotation(candidate: QrCandidate, id: string): Annotation {
  return {
    id,
    label: '二维码',
    x: candidate.rect.x,
    y: candidate.rect.y,
    w: candidate.rect.w,
    h: candidate.rect.h,
  };
}

/* ------------------------------------------------------------------
 * 浏览器部分：全图扫描
 * ------------------------------------------------------------------ */

/**
 * 对原图真实像素执行 jsQR 全图扫描（同步、本地、不联网）。
 * 每发现一个二维码即把该区域涂白后继续扫描，直到无结果或达到数量上限。
 * 原图本身无法解码时返回空数组（不生成假候选）。
 */
export function scanQrCandidates(image: HTMLImageElement): QrCandidate[] {
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) return [];
  ctx.drawImage(image, 0, 0);

  const candidates: QrCandidate[] = [];
  while (candidates.length < QR_SCAN_MAX_CANDIDATES) {
    let imageData: ImageData;
    try {
      imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    } catch {
      break; // 提取失败：停止扫描，返回已发现的候选
    }
    const code = jsQR(imageData.data, canvas.width, canvas.height, {
      inversionAttempts: 'attemptBoth',
    });
    if (!code) break;
    const rect = qrLocationToRect(code.location, QR_CANDIDATE_PADDING_PX, canvas.width, canvas.height);
    if (!rect) break; // location 无效：不生成假候选，同时停止避免死循环
    candidates.push({ rect, content: code.data });
    // 涂白已发现区域，继续寻找下一个二维码
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  }
  return candidates;
}
