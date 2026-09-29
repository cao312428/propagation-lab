/**
 * 文字识别测试面板：按钮触发批量 OCR（只在用户主动运行后执行），
 * 显示任务状态（加载模型 / 正在识别进度 / 完成 / 失败）与每个文字标注的结果卡片。
 * 本组件只负责展示与交互，OCR 逻辑在 utils/ocrEngine.ts 与 utils/textRecognition.ts。
 */
import type { Annotation } from '../types';
import { LABEL_COLORS } from '../constants';
import type { OcrRunStatus, TextRecognitionResult } from '../types/textRecognition';
import { OCR_MODEL_LOADING_HINT } from '../utils/textRecognition';

interface Props {
  status: OcrRunStatus;
  progress: { done: number; total: number } | null;
  results: TextRecognitionResult[];
  /** 文字类标注（按标注顺序，用于结果卡片显示标签） */
  targets: Annotation[];
  /** 按钮是否可用（已上传图片且至少一个文字类标注） */
  canRun: boolean;
  /** 测试参数已变化、旧结果被清除（提示用户重新运行） */
  invalidated: boolean;
  onRun: () => void;
}

/** 长文本截断（保留原始文本在 title 中） */
function truncateText(text: string, max = 60): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** 相似度格式化：0.964 → "96.4%" */
function formatSimilarity(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

const RUNNING = ['加载OCR模型', '正在识别'];

export function TextRecognitionPanel({
  status,
  progress,
  results,
  targets,
  canRun,
  invalidated,
  onRun,
}: Props) {
  const running = RUNNING.includes(status);
  const resultById = new Map(results.map((r) => [r.annotationId, r]));

  return (
    <div className="text-recognition">
      <div className="panel-title">
        文字识别测试
        {status === '完成' && <span className="title-tag">已完成</span>}
      </div>

      {/* 语言模型说明（常驻，不假装完全离线） */}
      <p className="ocr-model-hint">{OCR_MODEL_LOADING_HINT}</p>

      {/* 测试参数已变化：旧结果被清除，提示重新检测 */}
      {invalidated && status === '未检测' && (
        <p className="ocr-status ocr-invalidated">测试参数已变化，请重新运行文字识别测试。</p>
      )}

      <button
        className="btn-ghost ocr-run-btn"
        disabled={!canRun || running}
        onClick={onRun}
        title="对标题、日期、地点、其他标签的文字区域执行本地 OCR"
      >
        运行文字识别测试
      </button>

      {/* 任务状态与进度 */}
      {status === '加载OCR模型' && <p className="ocr-status">正在加载 OCR 模型…</p>}
      {status === '正在识别' && progress && (
        <p className="ocr-status">
          正在识别 {progress.done} / {progress.total} …
        </p>
      )}
      {status === '失败' && <p className="ocr-status ocr-failed">文字识别失败，请重新尝试。</p>}

      {/* 结果卡片（按标注顺序展示文字类标注） */}
      {results.length > 0 && (
        <ul className="ocr-list">
          {targets.map((a) => {
            const r = resultById.get(a.id);
            if (!r) return null;
            return (
              <li key={a.id} className="ocr-item" style={{ borderLeftColor: LABEL_COLORS[a.label] }}>
                <div className="item-head">
                  <span className="diag-label">{a.label}</span>
                </div>
                {r.error ? (
                  <div className="ocr-error">{r.error}</div>
                ) : (
                  <>
                    <div className="ocr-row">
                      <span className="m-label">原图识别</span>
                      <span className="m-value ocr-text" title={r.baselineText}>
                        {r.baselineText ? truncateText(r.baselineText) : '（无识别结果）'}
                      </span>
                    </div>
                    <div className="ocr-row">
                      <span className="m-label">当前场景识别</span>
                      <span className="m-value ocr-text" title={r.currentText || r.currentSkippedReason}>
                        {r.currentSkippedReason
                          ? r.currentSkippedReason
                          : r.currentText
                            ? truncateText(r.currentText)
                            : '（无识别结果）'}
                      </span>
                    </div>
                    <div className="ocr-row">
                      <span className="m-label">结果</span>
                      <span className="m-value">{r.status}</span>
                    </div>
                    {r.similarity !== null && (
                      <div className="ocr-row">
                        <span className="m-label">OCR文本相似度</span>
                        <span className="m-value">{formatSimilarity(r.similarity)}</span>
                      </div>
                    )}
                    {/* 画质退化后识别（scene vs degradedScene，启用画质退化时存在） */}
                    {r.degradedComparison && (
                      <>
                        <div className="ocr-row">
                          <span className="m-label">画质退化后</span>
                          <span className="m-value ocr-text" title={r.degradedText ?? ''}>
                            {r.degradedText ? truncateText(r.degradedText) : '（无识别结果）'}
                          </span>
                        </div>
                        <div className="ocr-row">
                          <span className="m-label">结果</span>
                          <span className="m-value">{r.degradedComparison.status}</span>
                        </div>
                        {r.degradedComparison.similarity !== null && (
                          <div className="ocr-row">
                            <span className="m-label">OCR文本相似度</span>
                            <span className="m-value">
                              {formatSimilarity(r.degradedComparison.similarity)}
                            </span>
                          </div>
                        )}
                      </>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
