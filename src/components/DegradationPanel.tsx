/**
 * 画质退化压力测试面板：
 * 开关（默认关闭）+ 缩放比例 / JPEG 质量参数 + 实际输出尺寸 + 退化结果预览。
 * 所有参数为本项目压力测试参数，不代表任何真实平台官方规则。
 * 本组件只负责展示与交互，像素处理在 utils/imageDegradation.ts。
 */
import {
  DEGRADATION_PARAM_NOTE,
  formatJpegQualityPercent,
  formatScalePercent,
  JPEG_ENCODER_NOTE,
  JPEG_QUALITY_OPTIONS,
  SCALE_OPTIONS,
} from '../utils/imageDegradation';

interface Props {
  enabled: boolean;
  scaleFactor: number;
  jpegQuality: number;
  /** 当前场景（裁剪后）实际像素尺寸 */
  sceneWidth: number;
  sceneHeight: number;
  /** 退化后预览（未生成时为 null） */
  preview: { url: string; width: number; height: number } | null;
  onEnabledChange: (enabled: boolean) => void;
  onScaleChange: (scaleFactor: number) => void;
  onQualityChange: (jpegQuality: number) => void;
}

export function DegradationPanel({
  enabled,
  scaleFactor,
  jpegQuality,
  sceneWidth,
  sceneHeight,
  preview,
  onEnabledChange,
  onScaleChange,
  onQualityChange,
}: Props) {
  return (
    <div className="degradation-panel">
      <div className="panel-title">画质退化压力测试</div>

      {/* 开关（默认关闭；关闭时保持现有行为完全一致） */}
      <label className="degradation-toggle-label">
        <input
          type="checkbox"
          className="occlusion-toggle"
          checked={enabled}
          onChange={(e) => onEnabledChange(e.target.checked)}
        />
        启用画质退化
      </label>

      {enabled && (
        <div className="degradation-settings">
          <div className="degradation-row">
            <span className="m-label">缩放比例</span>
            <select
              className="degradation-select"
              value={scaleFactor}
              onChange={(e) => onScaleChange(Number(e.target.value))}
            >
              {SCALE_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {formatScalePercent(s)}
                </option>
              ))}
            </select>
          </div>
          <div className="degradation-row">
            <span className="m-label">JPEG质量</span>
            <select
              className="degradation-select"
              value={jpegQuality}
              onChange={(e) => onQualityChange(Number(e.target.value))}
            >
              {JPEG_QUALITY_OPTIONS.map((q) => (
                <option key={q} value={q}>
                  {formatJpegQualityPercent(q)}
                </option>
              ))}
            </select>
          </div>
          <p className="degradation-dims">
            原场景尺寸：{sceneWidth} × {sceneHeight} px
            <br />
            退化后尺寸：
            {Math.max(1, Math.round(sceneWidth * scaleFactor))} ×{' '}
            {Math.max(1, Math.round(sceneHeight * scaleFactor))} px
          </p>

          {/* 画质退化结果预览（保持正确宽高比，不拉伸到固定尺寸） */}
          {preview && (
            <div className="degradation-preview">
              <div className="degradation-preview-title">画质退化结果</div>
              <img
                className="degradation-preview-img"
                src={preview.url}
                width={preview.width}
                height={preview.height}
                alt="画质退化结果预览"
              />
              <div className="degradation-preview-dims">
                退化后尺寸：{preview.width} × {preview.height} px · JPEG质量：
                {formatJpegQualityPercent(jpegQuality)}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 参数说明（常驻） */}
      <p className="degradation-note">{DEGRADATION_PARAM_NOTE}</p>
      {enabled && <p className="degradation-note">{JPEG_ENCODER_NOTE}</p>}
    </div>
  );
}
