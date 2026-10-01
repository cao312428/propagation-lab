/**
 * 多场景风险矩阵：行 = 用户标记的重要信息区域，列 = 传播场景。
 *
 * 单元格分三层独立展示，绝不混成一个综合评分：
 * - 几何状态（现有规则：完整 / 部分可见 / 严重缺失）；
 * - QR 状态（仅二维码标注；失败不会改写几何状态）；
 * - OCR 状态（仅文字标注且已有匹配结果；未运行 ≠ 失败）。
 *
 * 点击单元格 → 上方回调打开该「区域 × 场景」的详情面板。
 * 窄屏时只有矩阵容器内部横向滚动（页面本身不横向溢出），第一列 sticky 固定。
 */
import { LABEL_COLORS } from '../constants';
import type { MultiScenarioRunResult, OcrMatrixStatus, QrMatrixStatus } from '../types/multiScenario';
import { ocrMatrixStatusOf } from '../utils/multiScenario';

interface Props {
  run: MultiScenarioRunResult;
  selectedCell: { scenarioId: string; annotationId: string } | null;
  onSelectCell: (scenarioId: string, annotationId: string) => void;
}

/** 几何状态 → 徽章样式类名（与标注清单一致） */
const LEVEL_CLASS = {
  完整: 'level-full',
  部分可见: 'level-partial',
  严重缺失: 'level-missing',
} as const;

/** QR 状态 → 样式类名 */
const QR_CLASS: Record<QrMatrixStatus, string> = {
  可识别: 'qr-ok',
  无法识别: 'qr-fail',
  原图不可识别: 'qr-na',
  未测试: 'qr-na',
};

/** OCR 状态 → 样式类名 */
const OCR_CLASS: Record<OcrMatrixStatus, string> = {
  保持一致: 'qr-ok',
  发生变化: 'ocr-change',
  未能识别: 'qr-fail',
  原图未识别: 'qr-na',
  未运行: 'qr-na',
};

export function ScenarioMatrix({ run, selectedCell, onSelectCell }: Props) {
  // 行定义取第一个场景的区域顺序（所有场景的 regions 顺序与标注顺序一致）
  const rows = run.scenarios[0]?.regions ?? [];

  if (run.scenarios.length === 0 || rows.length === 0) {
    return <div className="list-empty">暂无多场景测试结果。</div>;
  }

  return (
    <div className="scenario-matrix-wrap" role="table" aria-label="多场景风险矩阵">
      <table className="scenario-matrix">
        <thead>
          <tr>
            <th className="sticky-col" scope="col">
              重要信息区域
            </th>
            {run.scenarios.map((s) => (
              <th key={s.definition.id} scope="col" title={s.detail}>
                {s.detail}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            // 该行（区域）在所有场景中的结果
            const regionByScenario = new Map(
              run.scenarios.map((s) => {
                const r = s.regions.find((reg) => reg.annotationId === row.annotationId);
                return [s.definition.id, r] as const;
              }),
            );
            return (
              <tr key={row.annotationId}>
                <th className="sticky-col row-label" scope="row">
                  <span
                    className="label-dot"
                    style={{ background: LABEL_COLORS[row.label] }}
                    aria-hidden="true"
                  />
                  <span className="row-label-text">{row.label}</span>
                </th>
                {run.scenarios.map((s) => {
                  const region = regionByScenario.get(s.definition.id);
                  const cellKey = `${s.definition.id}:${row.annotationId}`;
                  const selected =
                    selectedCell?.scenarioId === s.definition.id &&
                    selectedCell.annotationId === row.annotationId;
                  return (
                    <td key={cellKey}>
                      {region ? (
                        <button
                          type="button"
                          className={`matrix-cell ${selected ? 'selected' : ''}`}
                          aria-pressed={selected}
                          title="点击查看该区域在此场景下的详细结果"
                          onClick={() => onSelectCell(s.definition.id, row.annotationId)}
                        >
                          <span className={`badge ${LEVEL_CLASS[region.level]}`}>
                            {region.level}
                          </span>
                          {region.qr && (
                            <span className={`matrix-sub ${QR_CLASS[region.qr.status]}`}>
                              QR：{region.qr.status}
                            </span>
                          )}
                          {region.label !== '二维码' && (
                            <span
                              className={`matrix-sub ${OCR_CLASS[ocrMatrixStatusOf(region.ocr)]}`}
                            >
                              OCR：{ocrMatrixStatusOf(region.ocr)}
                            </span>
                          )}
                        </button>
                      ) : (
                        <span className="matrix-sub qr-na">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="matrix-note">
        几何状态只表示标注区域经过裁剪和遮挡后剩余的面积比例，不代表区域内的文字能够被准确阅读；
        QR 与 OCR 为独立的像素解码结果，不改变几何状态。
      </p>
    </div>
  );
}
