/**
 * 矩阵单元格详情面板：展示某个「区域 × 场景」的完整检测结果。
 *
 * 只展示已经存在的数据（几何诊断、二维码解码、已匹配的 OCR），
 * 不引入任何新的决策算法，不生成任何评分。
 */
import type { MultiScenarioRunResult } from '../types/multiScenario';
import { formatPercent } from '../utils/format';
import { LABEL_COLORS } from '../constants';
import { formatQrContent } from '../utils/qrDetection';

interface Props {
  run: MultiScenarioRunResult;
  scenarioId: string;
  annotationId: string;
  onClose: () => void;
}

/** 几何状态 → 徽章样式类名 */
const LEVEL_CLASS = {
  完整: 'level-full',
  部分可见: 'level-partial',
  严重缺失: 'level-missing',
} as const;

export function ScenarioDetailPanel({ run, scenarioId, annotationId, onClose }: Props) {
  const scenario = run.scenarios.find((s) => s.definition.id === scenarioId);
  const region = scenario?.regions.find((r) => r.annotationId === annotationId);
  if (!scenario || !region) return null;

  const directions = [region.cropDirection, region.occlusionSource]
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .join('、');

  return (
    <div className="scenario-detail" role="region" aria-label="区域场景详情">
      <div className="detail-head">
        <div className="detail-title">
          <span
            className="label-dot"
            style={{ background: LABEL_COLORS[region.label] }}
            aria-hidden="true"
          />
          <strong>区域：{region.label}</strong>
          <span className="detail-scenario">场景：{scenario.detail}</span>
        </div>
        <button
          type="button"
          className="icon-btn"
          title="关闭详情"
          aria-label="关闭详情"
          onClick={onClose}
        >
          ✕
        </button>
      </div>

      <div className="detail-grid">
        <div className="detail-line">
          <span className="m-label">裁剪保留率</span>
          <span className="m-value">{formatPercent(region.cropKeptRatio)}</span>
        </div>
        <div className="detail-line">
          <span className="m-label">最终几何可见率</span>
          <span className="m-value">{formatPercent(region.finalVisibleRatio)}</span>
        </div>
        <div className="detail-line">
          <span className="m-label">几何状态</span>
          <span className="m-value">
            <span className={`badge ${LEVEL_CLASS[region.level]}`}>{region.level}</span>
          </span>
        </div>
        <div className="detail-line">
          <span className="m-label">问题来源</span>
          <span className="m-value">{region.problemSource}</span>
        </div>
        {directions && (
          <div className="detail-line">
            <span className="m-label">受损方向</span>
            <span className="m-value">{directions}</span>
          </div>
        )}
      </div>

      {/* 二维码检测结果（仅二维码标注；与几何状态独立展示） */}
      {region.qr && (
        <div className="qr-check">
          <div className="diag-line">
            <span className="m-label">原图识别</span>
            <span className="m-value">{region.qr.baselineReadable ? '可识别' : '无法识别'}</span>
          </div>
          <div className="diag-line">
            <span className="m-label">当前场景</span>
            <span className="m-value">{region.qr.scenarioReadable ? '可识别' : '无法识别'}</span>
          </div>
          {region.qr.degradedChecked !== null && (
            <div className="diag-line">
              <span className="m-label">画质退化结果</span>
              <span className="m-value">
                {region.qr.degradedConclusion ?? '画质退化检测未执行'}
              </span>
            </div>
          )}
          {region.qr.scenarioContent && (
            <div className="diag-line">
              <span className="m-label">识别内容</span>
              <span className="m-value qr-content">{formatQrContent(region.qr.scenarioContent)}</span>
            </div>
          )}
          <div
            className={`qr-conclusion ${region.qr.status === '无法识别' ? 'qr-fail' : ''}`}
          >
            矩阵状态：{region.qr.status}
          </div>
        </div>
      )}

      {/* 文字 OCR 结果（仅已有且条件匹配的结果；未运行 ≠ 失败） */}
      {region.label !== '二维码' && (
        <div className="ocr-check">
          <div className="diag-line">
            <span className="m-label">OCR 状态</span>
            <span className="m-value">
              {region.ocr ? region.ocr.status : '未运行'}
            </span>
          </div>
          {region.ocr && region.ocr.similarity !== null && (
            <div className="diag-line">
              <span className="m-label">OCR 文本相似度</span>
              <span className="m-value">{formatPercent(region.ocr.similarity)}</span>
            </div>
          )}
          {region.ocr && (
            <div className="diag-line">
              <span className="m-label">原图识别文本</span>
              <span className="m-value ocr-text">{region.ocr.baselineText ?? '（无）'}</span>
            </div>
          )}
          {region.ocr && (
            <div className="diag-line">
              <span className="m-label">场景识别文本</span>
              <span className="m-value ocr-text">{region.ocr.scenarioText ?? '（无）'}</span>
            </div>
          )}
          {!region.ocr && (
            <p className="detail-hint">未运行 OCR：本阶段不自动批量执行文字识别，仅复用当前已存在且条件匹配的结果。</p>
          )}
        </div>
      )}

      <div className="diag-suggestion">
        <span className="m-label">建议</span>
        <span className="m-value">{region.suggestion}</span>
      </div>
    </div>
  );
}
