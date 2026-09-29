/**
 * 问题诊断面板：每个标注一张卡片，展示标签、几何状态、
 * 问题来源、受影响方向与修改建议。
 * （裁剪保留率 / 最终可见率在标注清单与结果概览中展示，此处不重复。）
 * 「二维码」标注额外显示可识别性压力测试结果（原图识别 / 当前场景 / 结论），
 * 识别失败时即使几何分类仍为「完整」也单独突出显示。
 * 排序：严重缺失 → 部分可见 → 完整（同级别保持标注原有顺序）。
 */
import type { VisibilityLevel } from '../types';
import { LABEL_COLORS } from '../constants';
import type { CropDirection, DiagnosisResult, OccluderSource } from '../utils/diagnosis';
import { formatQrContent, type DegradedQrOutcome, type QrCheckResult } from '../utils/qrDetection';
import type { TextRecognitionResult } from '../types/textRecognition';

interface Props {
  diagnoses: DiagnosisResult[];
  /** 二维码标注的检测结果（key 为标注 id，仅「二维码」标签存在） */
  qrResults: Map<string, QrCheckResult>;
  /** 文字 OCR 结果（用户主动运行后存在；场景变化后由 App 清除） */
  ocrResults: TextRecognitionResult[];
  /** 二维码画质退化检测结果（仅启用画质退化时存在） */
  degradedQrResults: Map<string, DegradedQrOutcome>;
}

/** 排序权重：严重缺失排最前，完整排最后 */
const LEVEL_ORDER: Record<VisibilityLevel, number> = { 严重缺失: 0, 部分可见: 1, 完整: 2 };

/** 检测结果 → 徽章样式类名（与标注清单一致） */
const LEVEL_CLASS: Record<VisibilityLevel, string> = {
  完整: 'level-full',
  部分可见: 'level-partial',
  严重缺失: 'level-missing',
};

export function DiagnosisPanel({ diagnoses, qrResults, ocrResults, degradedQrResults }: Props) {
  const sorted = [...diagnoses].sort(
    (a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level],
  );

  return (
    <div className="diagnosis-panel">
      {sorted.length === 0 ? (
        <div className="list-empty">暂无标注，完成标注后将在这里显示问题诊断</div>
      ) : (
        <ul className="diagnosis-list">
          {sorted.map((d) => {
            const { annotation: a } = d;
            // 受影响方向：裁剪方向 + 遮挡来源合并展示
            const directions = [d.cropDirection, d.occlusionSource]
              .filter((x): x is CropDirection | OccluderSource => x !== null)
              .join('、');
            // 二维码标注的可识别性压力测试结果
            const qr = qrResults.get(a.id);
            // 二维码画质退化检测结果（仅启用画质退化时存在）
            const degradedQr = degradedQrResults.get(a.id);
            // 文字标注的 OCR 结果（用户主动运行后存在）
            const ocr = ocrResults.find((r) => r.annotationId === a.id);
            return (
              <li
                key={a.id}
                className="diagnosis-item"
                style={{ borderLeftColor: LABEL_COLORS[a.label] }}
              >
                <div className="item-head">
                  <span className="diag-label">{a.label}</span>
                  <span className={`badge ${LEVEL_CLASS[d.level]}`} title="几何状态">
                    {d.level}
                  </span>
                </div>
                <div className="diag-line">
                  <span className="m-label">问题来源</span>
                  <span className="m-value">{d.problemSource}</span>
                </div>
                {directions && (
                  <div className="diag-line">
                    <span className="m-label">受影响方向</span>
                    <span className="m-value">{directions}</span>
                  </div>
                )}
                <div className="diag-suggestion">
                  <span className="m-label">建议</span>
                  <span className="m-value">{d.suggestion}</span>
                </div>

                {/* 二维码功能性诊断：即使几何分类为「完整」也单独显示识别结果 */}
                {qr && (
                  <div className="qr-check">
                    <div className="diag-line">
                      <span className="m-label">原图识别</span>
                      <span className="m-value">{qr.baselineReadable ? '可识别' : '无法识别'}</span>
                    </div>
                    <div className="diag-line">
                      <span className="m-label">当前场景</span>
                      <span className="m-value">{qr.scenarioReadable ? '可识别' : '无法识别'}</span>
                    </div>
                    {(qr.baselineContent ?? qr.scenarioContent) && (
                      <div className="diag-line">
                        <span className="m-label">识别内容</span>
                        <span className="m-value qr-content">
                          {formatQrContent(qr.baselineContent ?? qr.scenarioContent ?? '')}
                        </span>
                      </div>
                    )}
                    <div
                      className={`qr-conclusion ${
                        qr.conclusion === '传播处理后二维码识别失败' ? 'qr-fail' : ''
                      }`}
                    >
                      诊断：{qr.conclusion}
                    </div>
                    {/* 功能性退化结果（画质退化启用时存在） */}
                    {degradedQr && (
                      <div className="diag-line">
                        <span className="m-label">画质退化结果</span>
                        <span className="m-value">{degradedQr.conclusion}</span>
                      </div>
                    )}
                  </div>
                )}

                {/* 文字 OCR 功能性结果（独立的解码比较，不改变几何状态） */}
                {ocr && !ocr.error && (
                  <div className="ocr-check">
                    <div className="diag-line">
                      <span className="m-label">OCR结果</span>
                      <span className="m-value">{ocr.status}</span>
                    </div>
                    {(ocr.status === '识别文本发生变化' ||
                      ocr.status === '传播处理后未能识别文字') && (
                      <div className="diag-ocr-warning">
                        当前传播场景中的文字识别结果发生变化。
                      </div>
                    )}
                    {/* 画质退化结果（scene vs degradedScene） */}
                    {ocr.degradedComparison && (
                      <div className="diag-line">
                        <span className="m-label">画质退化结果</span>
                        <span className="m-value">{ocr.degradedComparison.status}</span>
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* 二维码本地解码测试的免责说明（仅存在二维码标注时显示） */}
      {qrResults.size > 0 && (
        <p className="qr-disclaimer">
          二维码识别结果来自当前图像像素的本地解码测试。识别成功不保证所有设备和实际传播平台均可扫描；
          识别失败表示当前测试图像未能被解码器识别。
        </p>
      )}
    </div>
  );
}
