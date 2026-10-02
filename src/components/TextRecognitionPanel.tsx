/**
 * 文字识别测试面板：按钮触发批量 OCR（只在用户主动运行后执行），
 * 显示任务状态（加载模型 / 正在识别进度 / 完成 / 失败）与每个文字标注的结果卡片。
 * 本组件只负责展示与交互，OCR 逻辑在 utils/ocrEngine.ts 与 utils/textRecognition.ts。
 *
 * 结果卡片顺序（本阶段整理）：
 * 期望文本（如果有）→ 原图识别 + 置信度 → 当前场景识别 + 置信度 →
 * 传播前后 OCR 文本相似度 → 与期望文本相似度 → 结果 → 画质退化部分。
 */
import type { Annotation } from '../types';
import { LABEL_COLORS } from '../constants';
import type { OcrRunStatus, TextRecognitionResult } from '../types/textRecognition';
import {
  isLowOcrConfidence,
  LOW_OCR_CONFIDENCE_NOTICE,
  OCR_CONFIDENCE_NOTE,
  OCR_MODEL_LOADING_HINT,
  OCR_SIMILARITY_NOTE,
} from '../utils/textRecognition';

interface Props {
  status: OcrRunStatus;
  progress: { done: number; total: number } | null;
  results: TextRecognitionResult[];
  /** 文字类标注（按标注顺序，用于结果卡片显示标签与期望文本） */
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

/** 置信度格式化：87.52 → "87.5"（OCR 引擎 0～100 原始数值，不换算成百分比评分） */
function formatConfidence(value: number): string {
  return `${Math.round(value * 10) / 10}`;
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
            // 低置信度：中性提示，不判定失败
            const lowConfidence = isLowOcrConfidence(r.baselineConfidence);
            return (
              <li key={a.id} className="ocr-item" style={{ borderLeftColor: LABEL_COLORS[a.label] }}>
                <div className="item-head">
                  <span className="diag-label">类型：{a.label}</span>
                  {a.expectedText && <span className="expected-tag">含期望文本</span>}
                </div>
                {r.error ? (
                  <div className="ocr-error">{r.error}</div>
                ) : (
                  <>
                    {/* 期望文本（用户填写，可选） */}
                    {a.expectedText && (
                      <div className="ocr-row">
                        <span className="m-label">期望文本</span>
                        <span className="m-value ocr-text" title={a.expectedText}>
                          {truncateText(a.expectedText)}
                        </span>
                      </div>
                    )}

                    {/* 原图识别 + 置信度 */}
                    <div className="ocr-row">
                      <span className="m-label">原图识别</span>
                      <span className="m-value ocr-text" title={r.baselineText}>
                        {r.baselineText ? truncateText(r.baselineText) : '（无识别结果）'}
                      </span>
                      {r.baselineConfidence !== null && (
                        <span className="m-value ocr-confidence">
                          OCR置信度：{formatConfidence(r.baselineConfidence)}
                        </span>
                      )}
                    </div>
                    {/* 低置信度中性提示（仅提示，不判定失败） */}
                    {lowConfidence && (
                      <p className="ocr-low-confidence" role="status">
                        {LOW_OCR_CONFIDENCE_NOTICE}
                      </p>
                    )}

                    {/* 当前场景识别 + 置信度 */}
                    <div className="ocr-row">
                      <span className="m-label">当前场景识别</span>
                      <span className="m-value ocr-text" title={r.currentText || r.currentSkippedReason}>
                        {r.currentSkippedReason
                          ? r.currentSkippedReason
                          : r.currentText
                            ? truncateText(r.currentText)
                            : '（无识别结果）'}
                      </span>
                      {r.currentConfidence !== null && (
                        <span className="m-value ocr-confidence">
                          OCR置信度：{formatConfidence(r.currentConfidence)}
                        </span>
                      )}
                    </div>

                    {/* 传播前后 OCR 文本相似度（口径：一致程度，非识别正确率） */}
                    {r.similarity !== null && (
                      <div className="ocr-row">
                        <span className="m-label">传播前后 OCR 文本相似度</span>
                        <span className="m-value">{formatSimilarity(r.similarity)}</span>
                      </div>
                    )}

                    {/* 与期望文本相似度（不用「准确率」表述） */}
                    {r.expectedBaselineSimilarity !== null &&
                      r.expectedBaselineSimilarity !== undefined && (
                        <div className="ocr-row">
                          <span className="m-label">原图与期望文本相似度</span>
                          <span className="m-value">
                            {r.expectedBaselineSimilarity === 1
                              ? '与期望文本一致'
                              : formatSimilarity(r.expectedBaselineSimilarity)}
                          </span>
                        </div>
                      )}
                    {r.expectedCurrentSimilarity !== null &&
                      r.expectedCurrentSimilarity !== undefined && (
                        <div className="ocr-row">
                          <span className="m-label">当前场景与期望文本相似度</span>
                          <span className="m-value">
                            {r.expectedCurrentSimilarity === 1
                              ? '与期望文本一致'
                              : formatSimilarity(r.expectedCurrentSimilarity)}
                          </span>
                        </div>
                      )}

                    {/* 结果 */}
                    <div className="ocr-row">
                      <span className="m-label">结果</span>
                      <span className="m-value">{r.status}</span>
                    </div>

                    {/* 画质退化后识别（scene vs degradedScene，启用画质退化时存在） */}
                    {r.degradedComparison && (
                      <>
                        <div className="ocr-row">
                          <span className="m-label">画质退化后</span>
                          <span className="m-value ocr-text" title={r.degradedText ?? ''}>
                            {r.degradedText ? truncateText(r.degradedText) : '（无识别结果）'}
                          </span>
                          {r.degradedConfidence !== null && r.degradedConfidence !== undefined && (
                            <span className="m-value ocr-confidence">
                              OCR置信度：{formatConfidence(r.degradedConfidence)}
                            </span>
                          )}
                        </div>
                        <div className="ocr-row">
                          <span className="m-label">结果</span>
                          <span className="m-value">{r.degradedComparison.status}</span>
                        </div>
                        {r.degradedComparison.similarity !== null && (
                          <div className="ocr-row">
                            <span className="m-label">传播前后 OCR 文本相似度</span>
                            <span className="m-value">
                              {formatSimilarity(r.degradedComparison.similarity)}
                            </span>
                          </div>
                        )}
                        {r.expectedDegradedSimilarity !== null &&
                          r.expectedDegradedSimilarity !== undefined && (
                            <div className="ocr-row">
                              <span className="m-label">退化后与期望文本相似度</span>
                              <span className="m-value">
                                {r.expectedDegradedSimilarity === 1
                                  ? '与期望文本一致'
                                  : formatSimilarity(r.expectedDegradedSimilarity)}
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

      {/* 口径说明（常驻，与报告一致） */}
      {results.length > 0 && (
        <div className="ocr-notes">
          <p>{OCR_SIMILARITY_NOTE}</p>
          <p>{OCR_CONFIDENCE_NOTE}</p>
        </div>
      )}
    </div>
  );
}
