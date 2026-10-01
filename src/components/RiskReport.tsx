/**
 * 传播风险报告（纯展示组件）：
 * 测试概况 → 结论摘要 → 问题区域列表（按严重程度排序）→ 底部说明。
 * 所有数据来自 report.ts 整理后的 ReportData，本组件不做任何计算与判断。
 *
 * 附带「导出报告 PNG」按钮：只把报告区域当前已显示的同一份 DOM 导出为图片，
 * 不重新生成报告数据，不导出导航、上传按钮、导出按钮本身或版本对比区域。
 */
import { useRef, useState } from 'react';
import type { VisibilityLevel } from '../types';
import { LABEL_COLORS } from '../constants';
import { formatPercent, formatSize } from '../utils/format';
import type { ReportData } from '../utils/report';
import { formatQrContent } from '../utils/qrDetection';
import { buildReportPngFileName, exportReportToPng } from '../utils/reportExport';

/** 长文本截断（保留原始文本在 title 中） */
function truncateText(text: string, max = 60): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** 检测结果 → 徽章样式类名（与标注清单一致） */
const LEVEL_CLASS: Record<VisibilityLevel, string> = {
  完整: 'level-full',
  部分可见: 'level-partial',
  严重缺失: 'level-missing',
};

export function RiskReport({ data }: { data: ReportData }) {
  /** 导出目标：整个报告容器（完整高度，与网页展示完全一致） */
  const reportRef = useRef<HTMLDivElement>(null);
  /** 导出中：按钮禁用并显示进度文案，防止重复点击 */
  const [exporting, setExporting] = useState(false);
  /** 上次导出是否失败（失败时显示简单提示，不弹窗） */
  const [exportFailed, setExportFailed] = useState(false);

  /** 导出 PNG：直接复用当前显示的同一份报告 DOM，不重新生成数据与判断 */
  const handleExportPng = async () => {
    if (exporting) return; // 导出期间禁止重复点击
    const node = reportRef.current;
    if (!node) return;
    setExporting(true);
    setExportFailed(false);
    const outcome = await exportReportToPng(node, buildReportPngFileName(new Date()));
    setExporting(false);
    if (!outcome.ok) setExportFailed(true); // 失败只提示，不让页面崩溃
  };

  return (
    <div className="report-wrap">
      {/* 导出工具栏位于报告容器之外，因此按钮本身不会出现在导出的 PNG 中 */}
      <div className="report-toolbar">
        <button
          className="btn-ghost export-btn"
          disabled={exporting}
          aria-busy={exporting}
          onClick={() => void handleExportPng()}
        >
          {exporting ? '正在生成报告…' : '导出报告 PNG'}
        </button>
        {exportFailed && (
          <span className="export-error" role="status">
            报告导出失败，请重试。
          </span>
        )}
      </div>

      <div className="risk-report" ref={reportRef}>
        <div className="report-app-title">传播实验室</div>
        <div className="report-main-title">传播风险报告</div>

        {/* 一、测试概况 */}
        <div className="report-grid">
          <div className="report-cell">
            <span className="m-label">图片文件</span>
            <span className="m-value report-file-name" title={data.fileName}>
              {data.fileName}
            </span>
          </div>
          <div className="report-cell">
            <span className="m-label">原图尺寸</span>
            <span className="m-value">{formatSize(data.imageWidth, data.imageHeight)}</span>
          </div>
          <div className="report-cell">
            <span className="m-label">测试场景</span>
            <span className="m-value">{data.cropRatioText}</span>
          </div>
          <div className="report-cell">
            <span className="m-label">通用界面遮挡</span>
            <span className="m-value">{data.occlusionText}</span>
          </div>
          <div className="report-cell">
            <span className="m-label">画质退化压力测试</span>
            <span className="m-value">{data.degradationText}</span>
            {data.degradationDetail && (
              <span className="report-cell-detail">{data.degradationDetail}</span>
            )}
          </div>
          <div className="report-cell">
            <span className="m-label">标注区域总数</span>
            <span className="m-value">{data.totalCount}</span>
          </div>
          <div className="report-cell">
            <span className="m-label">检测结果分布</span>
            <span className="m-value">
              <span className="badge level-full">完整 {data.fullCount}</span>{' '}
              <span className="badge level-partial">部分可见 {data.partialCount}</span>{' '}
              <span className="badge level-missing">严重缺失 {data.missingCount}</span>
            </span>
          </div>
          <div className="report-cell">
            <span className="m-label">报告生成时间</span>
            <span className="m-value">{data.generatedAtText}</span>
          </div>
        </div>

        {/* 二、结论摘要 */}
        <p className="report-summary">{data.summary}</p>

        {/* 多场景测试摘要（仅运行过多场景测试时存在；纯计数，不是评分） */}
        {data.multiScenarioSummary && (
          <div className="report-multi-summary">
            <div className="report-section-title">多场景测试摘要</div>
            <div className="report-multi-line">
              <span className="m-label">已测试场景</span>
              <span className="m-value">{data.multiScenarioSummary.testedScenarioCount} 个</span>
            </div>
            <div className="report-multi-line">
              <span className="m-label">存在严重缺失的场景</span>
              <span className="m-value">{data.multiScenarioSummary.missingScenarioCount} 个</span>
            </div>
            <div className="report-multi-line">
              <span className="m-label">二维码出现无法识别的场景</span>
              <span className="m-value">{data.multiScenarioSummary.qrFailureScenarioCount} 个</span>
            </div>
          </div>
        )}

        {/* 三、问题区域列表 */}
        <div className="report-section-title">问题区域列表</div>
        {data.items.length === 0 ? (
          <div className="list-empty">暂无标注</div>
        ) : (
          <ul className="report-list">
            {data.items.map(({ diagnosis: d, qr, ocr, degradedQr }) => {
              const { annotation: a } = d;
              // 受影响方向：裁剪方向 + 遮挡来源合并展示
              const directions = [d.cropDirection, d.occlusionSource]
                .filter((x) => x !== null)
                .join('、');
              return (
                <li
                  key={a.id}
                  className="report-item"
                  style={{ borderLeftColor: LABEL_COLORS[a.label] }}
                >
                  <div className="item-head">
                    <span className="diag-label">{a.label}</span>
                    <span className={`badge ${LEVEL_CLASS[d.level]}`}>几何状态：{d.level}</span>
                  </div>
                  <div className="report-metrics">
                    <div>
                      <span className="m-label">原始区域</span>
                      <span className="m-value">{formatSize(a.w, a.h)}</span>
                    </div>
                    <div>
                      <span className="m-label">裁剪保留率</span>
                      <span className="m-value">{formatPercent(d.cropKeptRatio)}</span>
                    </div>
                    <div>
                      <span className="m-label">最终可见率</span>
                      <span className="m-value">{formatPercent(d.finalVisibleRatio)}</span>
                    </div>
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

                  {/* 二维码特殊结果 */}
                  {qr && (
                    <div className="qr-check">
                      <div className="diag-line">
                        <span className="m-label">原图识别</span>
                        <span className="m-value">
                          {qr.baselineReadable ? '可识别' : '无法识别'}
                        </span>
                      </div>
                      <div className="diag-line">
                        <span className="m-label">当前场景</span>
                        <span className="m-value">
                          {qr.scenarioReadable ? '可识别' : '无法识别'}
                        </span>
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
                        className={`report-qr-conclusion ${
                          qr.conclusion === '传播处理后二维码识别失败' ? 'report-qr-fail' : ''
                        }`}
                      >
                        {qr.conclusion}
                      </div>
                      {degradedQr && (
                        <div className="diag-line">
                          <span className="m-label">画质退化后识别</span>
                          <span className="m-value">{degradedQr.readable ? '可识别' : '无法识别'}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* 文字 OCR 结果（仅用户主动运行后存在） */}
                  {ocr && !ocr.error && (
                    <div className="qr-check">
                      <div className="diag-line">
                        <span className="m-label">原图文字识别</span>
                        <span className="m-value ocr-text" title={ocr.baselineText}>
                          {ocr.baselineText ? truncateText(ocr.baselineText) : '（无识别结果）'}
                        </span>
                      </div>
                      <div className="diag-line">
                        <span className="m-label">当前场景文字识别</span>
                        <span className="m-value ocr-text" title={ocr.currentText || ocr.currentSkippedReason}>
                          {ocr.currentSkippedReason
                            ? ocr.currentSkippedReason
                            : ocr.currentText
                              ? truncateText(ocr.currentText)
                              : '（无识别结果）'}
                        </span>
                      </div>
                      <div className="diag-line">
                        <span className="m-label">OCR结果</span>
                        <span className="m-value">{ocr.status}</span>
                      </div>
                      {ocr.degradedComparison && (
                        <>
                          <div className="diag-line">
                            <span className="m-label">画质退化后OCR</span>
                            <span className="m-value ocr-text" title={ocr.degradedText ?? ''}>
                              {ocr.degradedText ? truncateText(ocr.degradedText) : '（无识别结果）'}
                            </span>
                          </div>
                          <div className="diag-line">
                            <span className="m-label">画质退化结果</span>
                            <span className="m-value">{ocr.degradedComparison.status}</span>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {/* 四、底部固定说明 */}
        <div className="report-notes">
          <p>本报告中的可见率为基于图像区域裁剪与遮挡计算得到的几何面积比例，不代表文字一定能够被准确阅读。</p>
          <p>二维码结果来自当前图像像素的本地解码测试。识别成功不保证所有设备或真实平台均可扫描。</p>
          <p>OCR结果来自当前图像像素的本地文字识别测试。识别成功或一致不代表所有用户在实际设备上都能准确阅读。</p>
          <p>界面遮挡为压力测试使用的简化模型，不对应任何真实平台官方尺寸。</p>
          <p>缩放与JPEG压缩为本项目压力测试参数。浏览器JPEG编码结果不代表任何真实平台的官方压缩行为。</p>
        </div>
      </div>
    </div>
  );
}
