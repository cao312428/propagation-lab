/**
 * 检测结果概览：汇总完整 / 部分可见 / 严重缺失数量。
 * 严重缺失优先展示并强化，完整降低视觉权重（不夸张、无动画）。
 * 数量由 App 基于现有检测结果统计后传入，本组件不做计算。
 */

interface Props {
  total: number;
  full: number;
  partial: number;
  missing: number;
}

export function ResultOverview({ total, full, partial, missing }: Props) {
  return (
    <div className="result-overview">
      <div className="panel-title">
        检测结果概览
        <span className="title-tag">几何状态</span>
      </div>
      {total === 0 ? (
        <div className="list-empty">完成标注后，这里将显示检测结果分布</div>
      ) : (
        <div className="overview-badges">
          <div className="overview-badge ov-missing">
            <span className="badge level-missing">严重缺失</span>
            <span className="ov-count">{missing}</span>
          </div>
          <div className="overview-badge ov-partial">
            <span className="badge level-partial">部分可见</span>
            <span className="ov-count">{partial}</span>
          </div>
          <div className="overview-badge ov-full">
            <span className="badge level-full">完整</span>
            <span className="ov-count">{full}</span>
          </div>
        </div>
      )}
    </div>
  );
}
