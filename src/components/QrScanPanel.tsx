/**
 * 二维码自动发现面板：
 * 点击「扫描二维码」对原图真实像素执行本地 jsQR 全图扫描，
 * 展示候选（二维码内容 + 添加 / 忽略按钮）。
 *
 * 候选确认后才转为普通「二维码」标注（与手动画框完全等价），
 * 绝不静默创建；不打开 URL、不联网、不做安全评级。
 */
import type { Annotation } from '../types';
import type { QrCandidate } from '../utils/qrAutoDetect';
import {
  isHighlyOverlapping,
  QR_SCAN_NOT_FOUND_TEXT,
} from '../utils/qrAutoDetect';
import { formatQrContent } from '../utils/qrDetection';

interface Props {
  /** 是否已有原图（无图时按钮不可用） */
  hasImage: boolean;
  /** 是否正在扫描 */
  scanning: boolean;
  /** 扫描候选（null = 尚未扫描过） */
  candidates: QrCandidate[] | null;
  /** 已有二维码标注（用于高重叠判断，避免重复添加） */
  qrAnnotations: Annotation[];
  onScan: () => void;
  onAdd: (candidate: QrCandidate) => void;
  onIgnore: (candidate: QrCandidate) => void;
}

export function QrScanPanel({
  hasImage,
  scanning,
  candidates,
  qrAnnotations,
  onScan,
  onAdd,
  onIgnore,
}: Props) {
  const scanned = candidates !== null;

  return (
    <div className="qr-scan-panel">
      <div className="panel-title">二维码自动发现</div>
      <p className="qr-scan-intro">
        对原图真实像素执行本地解码扫描，发现二维码后由你确认是否添加为标注。
      </p>

      <button
        type="button"
        className="btn-ghost qr-scan-btn"
        disabled={!hasImage || scanning}
        aria-busy={scanning}
        onClick={onScan}
      >
        {scanning ? '正在扫描…' : '扫描二维码'}
      </button>

      {scanning && (
        <p className="ocr-status" role="status">
          正在对原图像素执行二维码解码扫描…
        </p>
      )}

      {/* 扫描结果 */}
      {scanned && !scanning && (
        <div className="qr-scan-results">
          {candidates!.length === 0 ? (
            <p className="qr-scan-empty" role="status">
              {QR_SCAN_NOT_FOUND_TEXT}
            </p>
          ) : (
            <ul className="qr-candidate-list">
              {candidates!.map((candidate, i) => {
                // 与已有二维码标注高度重叠时不允许重复添加
                const duplicate = qrAnnotations.some((a) =>
                  isHighlyOverlapping(a, candidate.rect),
                );
                return (
                  <li key={`${i}-${candidate.content.slice(0, 8)}`} className="qr-candidate">
                    <div className="qr-candidate-info">
                      <span className="m-label">二维码内容</span>
                      <span className="m-value qr-content" title={candidate.content}>
                        {formatQrContent(candidate.content)}
                      </span>
                      {duplicate && (
                        <span className="qr-candidate-note">
                          与已有二维码标注高度重叠，未重复添加。
                        </span>
                      )}
                    </div>
                    <div className="qr-candidate-actions">
                      <button
                        type="button"
                        className="btn-ghost"
                        disabled={duplicate}
                        title={duplicate ? '与已有二维码标注高度重叠' : '确认后添加为普通二维码标注'}
                        onClick={() => onAdd(candidate)}
                      >
                        添加为二维码标注
                      </button>
                      <button
                        type="button"
                        className="btn-ghost"
                        title="忽略该候选"
                        onClick={() => onIgnore(candidate)}
                      >
                        忽略
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      <p className="qr-scan-note">
        扫描结果来自原图真实像素的本地解码；添加的标注与手动画框完全等价。
        二维码内容仅用于展示，不会自动打开链接。
      </p>
    </div>
  );
}
