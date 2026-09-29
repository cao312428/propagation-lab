/**
 * 版本对比面板：保存修改前版本快照、触发对比、展示对比结果。
 * 本组件只负责展示与交互，所有统计与变化判断都在 utils/comparison.ts 中。
 */
import type { CropRatio } from '../types';
import { LABEL_COLORS } from '../constants';
import type { BaselineSnapshot, ChangeDirection, ComparisonResult } from '../types/comparison';
import { formatCropRatioText, formatOcclusionText } from '../utils/report';
import {
  PAIRING_RULE_TEXT,
  QR_RECOVERED_TEXT,
  SCENARIO_MISMATCH_TEXT,
  formatDeltaPp,
  formatPercentValue,
} from '../utils/comparison';

interface Props {
  baseline: BaselineSnapshot | null;
  currentFileName: string;
  currentCropRatio: CropRatio;
  currentOcclusionEnabled: boolean;
  /** 是否可以保存快照：已上传图片且至少存在一个标注 */
  canSave: boolean;
  /** 对比结果（点击「与修改前版本对比」后非 null，之后随当前状态实时更新） */
  result: ComparisonResult | null;
  onSave: () => void;
  onCompare: () => void;
  onClear: () => void;
}

/** 变化方向 → 徽章样式类名 */
const DIRECTION_CLASS: Record<ChangeDirection, string> = {
  改善: 'cmp-improved',
  基本不变: 'cmp-unchanged',
  下降: 'cmp-declined',
};

export function VersionComparison({
  baseline,
  currentFileName,
  currentCropRatio,
  currentOcclusionEnabled,
  canSave,
  result,
  onSave,
  onCompare,
  onClear,
}: Props) {
  return (
    <div className="version-comparison">
      {/* 用途说明 + 配对规则说明（常驻，不宣称自动识别同一元素） */}
      <p className="cmp-rule-note">验证修改前后是否改善。{PAIRING_RULE_TEXT}</p>

      {/* 操作按钮 */}
      <div className="cmp-actions">
        <button className="btn-ghost" disabled={!canSave} onClick={onSave} title="保存当前检测结果为修改前版本">
          设为修改前版本
        </button>
        <button
          className="btn-ghost"
          disabled={!baseline || !canSave}
          onClick={onCompare}
          title="将当前检测结果与修改前版本对比"
        >
          与修改前版本对比
        </button>
        <button
          className="btn-ghost cmp-danger"
          disabled={!baseline}
          onClick={onClear}
          title="清除已保存的修改前版本"
        >
          清除修改前版本
        </button>
      </div>

      {/* 已保存的修改前版本信息 */}
      {baseline && (
        <p className="cmp-baseline-info">
          修改前版本：{baseline.fileName}（{formatCropRatioText(baseline.cropRatio)}，
          界面遮挡{formatOcclusionText(baseline.occlusionEnabled)}）
        </p>
      )}

      {/* 对比结果区 */}
      {result && baseline && (
        <div className="cmp-result">
          {!result.scenarioMatch ? (
            <p className="cmp-scenario-warning">{SCENARIO_MISMATCH_TEXT}</p>
          ) : (
            <>
              {/* 修改前 / 修改后头部 */}
              <div className="cmp-headers">
                <div className="cmp-header">
                  <span className="m-label">修改前</span>
                  <div className="cmp-header-file">{baseline.fileName}</div>
                  <div className="cmp-header-scene">
                    {formatCropRatioText(baseline.cropRatio)} · 遮挡{formatOcclusionText(baseline.occlusionEnabled)}
                  </div>
                </div>
                <div className="cmp-header">
                  <span className="m-label">修改后</span>
                  <div className="cmp-header-file">{currentFileName}</div>
                  <div className="cmp-header-scene">
                    {formatCropRatioText(currentCropRatio)} · 遮挡{formatOcclusionText(currentOcclusionEnabled)}
                  </div>
                </div>
              </div>

              {/* 总体变化摘要 */}
              {result.summary && <p className="report-summary">{result.summary}</p>}

              {/* 每个标注的对比卡片 */}
              <ul className="cmp-list">
                {result.pairs.map((pair, i) => {
                  const region = result.regions.find((r) => r.pair === pair);
                  const labelColor = LABEL_COLORS[pair.label];
                  // 未配对区域
                  if (!region) {
                    return (
                      <li key={i} className="cmp-item cmp-unpaired" style={{ borderLeftColor: labelColor }}>
                        <div className="item-head">
                          <span className="diag-label">{pair.label}</span>
                          <span className="cmp-pair-note">{pair.status}</span>
                        </div>
                        {pair.before && (
                          <div className="cmp-row">
                            <span className="m-label">修改前最终可见率</span>
                            <span className="m-value">{formatPercentValue(pair.before.finalVisibleRatio)}</span>
                          </div>
                        )}
                        {pair.after && (
                          <div className="cmp-row">
                            <span className="m-label">修改后最终可见率</span>
                            <span className="m-value">{formatPercentValue(pair.after.finalVisibleRatio)}</span>
                          </div>
                        )}
                      </li>
                    );
                  }
                  // 匹配区域
                  const { before, after } = pair;
                  return (
                    <li key={i} className="cmp-item" style={{ borderLeftColor: labelColor }}>
                      <div className="item-head">
                        <span className="diag-label">{pair.label}</span>
                        <span className={`badge ${DIRECTION_CLASS[region.direction]}`}>
                          状态：{region.direction}
                        </span>
                      </div>
                      <div className="cmp-row">
                        <span className="m-label">最终可见率</span>
                        <span className="m-value">
                          {formatPercentValue(before!.finalVisibleRatio)} → {formatPercentValue(after!.finalVisibleRatio)}
                          （{formatDeltaPp(region.finalDeltaPp)} 个百分点）
                        </span>
                      </div>
                      <div className="cmp-row">
                        <span className="m-label">裁剪保留率</span>
                        <span className="m-value">
                          {formatPercentValue(before!.cropKeptRatio)} → {formatPercentValue(after!.cropKeptRatio)}
                          （{formatDeltaPp(region.cropDeltaPp)} 个百分点）
                        </span>
                      </div>
                      {region.levelChangeText && (
                        <div className="cmp-row">
                          <span className="m-label">分类变化</span>
                          <span className="m-value">{region.levelChangeText}</span>
                        </div>
                      )}
                      {region.qrStatusText && (
                        <div className="cmp-row">
                          <span className="m-label">二维码</span>
                          <span className="m-value">{region.qrStatusText}</span>
                        </div>
                      )}
                      {region.qrHighlightText && (
                        <div
                          className={
                            region.qrHighlightText === QR_RECOVERED_TEXT
                              ? 'cmp-qr-recovered'
                              : 'cmp-qr-lost'
                          }
                        >
                          {region.qrHighlightText}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
