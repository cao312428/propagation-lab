/**
 * 标注清单：展示每条标注的标签、原始区域、裁剪保留率、最终可见率与最终分类结果。
 * 最终可见率在关闭遮挡时等于裁剪保留率。
 * 支持修改标签、删除标注（删除后可在画布上重新标注）。
 * 文字类标注（标题 / 日期 / 地点 / 其他）可填写「期望文本（可选）」，
 * 供 OCR 阶段计算「与期望文本相似度」；二维码标注不使用。
 */
import type { LabelType, VisibilityLevel } from '../types';
import { LABEL_COLORS, LABEL_OPTIONS } from '../constants';
import { formatPercent, formatSize } from '../utils/format';
import { isTextOcrTarget } from '../utils/textRecognition';
import type { Analysis } from './CropPreview';

interface Props {
  analyses: Analysis[];
  onChangeLabel: (id: string, label: LabelType) => void;
  onDelete: (id: string) => void;
  /** 更新标注的期望文本（仅文字类标签的输入框触发） */
  onChangeExpectedText: (id: string, text: string) => void;
}

/** 检测结果 → 徽章样式类名 */
const LEVEL_CLASS: Record<VisibilityLevel, string> = {
  完整: 'level-full',
  部分可见: 'level-partial',
  严重缺失: 'level-missing',
};

export function AnnotationList({ analyses, onChangeLabel, onDelete, onChangeExpectedText }: Props) {
  return (
    <div className="annotation-list">
      {analyses.length === 0 ? (
        <div className="list-empty">
          暂无标注，请在左侧原图上选择标签后，拖动鼠标框选重要信息区域
        </div>
      ) : (
        <ul className="list-items">
          {analyses.map(({ annotation: a, ratio, level, finalRatio, finalLevel }) => (
            <li
              key={a.id}
              className="list-item"
              style={{ borderLeftColor: LABEL_COLORS[a.label] }}
            >
              <div className="item-head">
                <select
                  className="label-select"
                  value={a.label}
                  onChange={(e) => onChangeLabel(a.id, e.target.value as LabelType)}
                  title="修改标签"
                >
                  {LABEL_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
                <span className={`badge ${LEVEL_CLASS[finalLevel ?? level]}`} title="几何状态">
                  {finalLevel ?? level}
                </span>
                <button
                  className="icon-btn"
                  title="删除该标注"
                  aria-label="删除该标注"
                  onClick={() => onDelete(a.id)}
                >
                  ✕
                </button>
              </div>
              <div className="item-metrics">
                <div>
                  <span className="m-label">原始区域</span>
                  <span className="m-value">{formatSize(a.w, a.h)}</span>
                </div>
                <div>
                  <span className="m-label">裁剪保留率</span>
                  <span className="m-value">{formatPercent(ratio)}</span>
                </div>
                {/* 最终可见率始终显示：开启遮挡时为扣除遮挡后的比例，关闭遮挡时等于裁剪保留率 */}
                <div>
                  <span className="m-label">最终可见率</span>
                  <span className="m-value">{formatPercent(finalRatio ?? ratio)}</span>
                </div>
              </div>

              {/* 期望文本（可选）：仅文字类标签显示，供 OCR 与期望文本比较使用 */}
              {isTextOcrTarget(a.label) && (
                <label className="expected-text-field">
                  <span className="m-label">期望文本（可选）</span>
                  <input
                    type="text"
                    className="expected-text-input"
                    value={a.expectedText ?? ''}
                    placeholder="例如：2026年10月23日"
                    title="填写期望的文本内容后重新运行 OCR，可查看识别结果与期望文本的相似度"
                    onChange={(e) => onChangeExpectedText(a.id, e.target.value)}
                  />
                </label>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
