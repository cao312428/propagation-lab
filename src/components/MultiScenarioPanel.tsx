/**
 * 多场景测试面板：选择多个传播场景，一次运行批量压力测试。
 *
 * 只负责场景选择、运行触发与状态展示；
 * 几何 / 二维码计算全部由 utils/multiScenario 中的复用逻辑完成。
 * 不改动单场景编辑器的任何行为。
 */
import type { Annotation } from '../types';
import type { MultiScenarioRunStatus, MultiScenarioSummary } from '../types/multiScenario';
import { ALL_SCENARIOS, SCENARIO_GROUPS } from '../utils/multiScenario';

interface Props {
  /** 是否已有原图（无图时运行不可执行并给出中性提示） */
  hasImage: boolean;
  /** 当前标注（无标注时运行不可执行） */
  annotations: Annotation[];
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
  status: MultiScenarioRunStatus;
  /** 二维码批量检测进度（运行中提供） */
  progress: { done: number; total: number } | null;
  /** 最近一次运行的摘要（done 状态提供） */
  summary: MultiScenarioSummary | null;
  onRun: () => void;
}

export function MultiScenarioPanel({
  hasImage,
  annotations,
  selectedIds,
  onSelectionChange,
  status,
  progress,
  summary,
  onRun,
}: Props) {
  const running = status === 'running';

  /** 切换单个场景的勾选状态 */
  const toggleScenario = (id: string) => {
    onSelectionChange(
      selectedIds.includes(id)
        ? selectedIds.filter((s) => s !== id)
        : [...selectedIds, id],
    );
  };

  const selectAll = () => onSelectionChange(ALL_SCENARIOS.map((s) => s.id));
  const clearAll = () => onSelectionChange([]);

  const noSelection = selectedIds.length === 0;
  const disabled = !hasImage || annotations.length === 0 || noSelection || running;

  return (
    <div className="multi-scenario-panel">
      <div className="panel-title">多场景测试</div>
      <p className="multi-intro">
        一次运行，对多个压力测试场景统一分析标注区域的几何可见性与二维码可识别性。
      </p>

      {/* 场景勾选（按分组） */}
      <div className="scenario-select">
        {SCENARIO_GROUPS.map((group) => (
          <div key={group.group} className="scenario-group">
            <div className="scenario-group-label">{group.label}</div>
            <div className="scenario-options">
              {group.scenarios.map((scenario) => {
                const checked = selectedIds.includes(scenario.id);
                return (
                  <label key={scenario.id} className="scenario-option">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleScenario(scenario.id)}
                      disabled={running}
                    />
                    <span>{scenario.name}</span>
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="scenario-actions">
        <button type="button" className="btn-ghost" disabled={running} onClick={selectAll}>
          全选
        </button>
        <button type="button" className="btn-ghost" disabled={running} onClick={clearAll}>
          清空
        </button>
        <button
          type="button"
          className="btn-primary"
          disabled={disabled}
          aria-busy={running}
          onClick={onRun}
        >
          {running ? '正在运行…' : '运行多场景测试'}
        </button>
      </div>

      {/* 运行条件提示（中性说明，不指责用户） */}
      {!hasImage ? (
        <p className="multi-hint">请先上传作品图片。</p>
      ) : annotations.length === 0 ? (
        <p className="multi-hint">请先在原图上标记重要信息区域。</p>
      ) : noSelection ? (
        <p className="multi-hint">请至少选择一个测试场景。</p>
      ) : null}

      {/* 运行状态 */}
      {running && progress && (
        <div className="multi-status">
          <span role="status">
            正在检测二维码（{progress.done}/{progress.total}）…
          </span>
        </div>
      )}
      {status === 'stale' && (
        <div className="multi-status stale" role="status">
          图片、标注或场景选择已变化，多场景结果已失效，请重新运行。
        </div>
      )}
      {status === 'done' && summary && (
        <div className="multi-summary">
          <div className="diag-line">
            <span className="m-label">已测试场景</span>
            <span className="m-value">{summary.testedScenarioCount} 个</span>
          </div>
          <div className="diag-line">
            <span className="m-label">存在严重缺失的场景</span>
            <span className="m-value">{summary.missingScenarioCount} 个</span>
          </div>
          <div className="diag-line">
            <span className="m-label">二维码出现无法识别的场景</span>
            <span className="m-value">{summary.qrFailureScenarioCount} 个</span>
          </div>
          <p className="multi-note">完整矩阵与单元格详情在页面下方展开。</p>
        </div>
      )}
    </div>
  );
}
