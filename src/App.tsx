/**
 * 应用主组件：管理全局状态（图片、标注列表），
 * 并把核心计算（裁剪区域、可见率）交给 utils 中的纯函数完成。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Annotation, CropRatio, LabelType, Rect } from './types';
import { CROP_RATIO_OPTIONS, LABEL_COLORS, LABEL_OPTIONS } from './constants';
import { analyzeAnnotation, computeCenterCrop } from './utils/crop';
import { analyzeWithOcclusion, computeOccluders } from './utils/occlusion';
import { diagnoseAnnotation } from './utils/diagnosis';
import { detectQrForAnnotation, isQrAnnotation, type QrCheckResult } from './utils/qrDetection';
import { buildReportData } from './utils/report';
import { buildComparisonResult, createSnapshot, toSnapshotAnnotations } from './utils/comparison';
import type { BaselineSnapshot } from './types/comparison';
import { createOcrEngine, runOcrForAnnotation } from './utils/ocrEngine';
import { isTextOcrTarget, OCR_FAILED_MESSAGE, ocrFailedResult } from './utils/textRecognition';
import type { OcrRunStatus, TextRecognitionResult } from './types/textRecognition';
import { buildDegradedScenePreview, DEFAULT_DEGRADATION } from './utils/imageDegradation';
import { detectDegradedQrForAnnotation, type DegradedQrOutcome } from './utils/qrDetection';
import { formatSize } from './utils/format';
import { UploadPanel } from './components/UploadPanel';
import { AnnotationCanvas } from './components/AnnotationCanvas';
import { CropPreview, type Analysis } from './components/CropPreview';
import { AnnotationList } from './components/AnnotationList';
import { DiagnosisPanel } from './components/DiagnosisPanel';
import { RiskReport } from './components/RiskReport';
import { VersionComparison } from './components/VersionComparison';
import { StepsNav } from './components/StepsNav';
import { ResultOverview } from './components/ResultOverview';
import { CollapsibleSection } from './components/CollapsibleSection';
import { TextRecognitionPanel } from './components/TextRecognitionPanel';
import { DegradationPanel } from './components/DegradationPanel';

let idSeq = 0;
/** 生成标注 ID（时间戳 + 自增序号，避免依赖浏览器 API） */
function nextId(): string {
  idSeq += 1;
  return `${Date.now().toString(36)}-${idSeq}`;
}

export default function App() {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [imageW, setImageW] = useState(0); // 原图宽（像素）
  const [imageH, setImageH] = useState(0); // 原图高（像素）
  const [fileName, setFileName] = useState('');
  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [activeLabel, setActiveLabel] = useState<LabelType>('标题'); // 新标注使用的标签
  const [cropRatio, setCropRatio] = useState<CropRatio>('1:1'); // 裁剪比例：1:1 或 9:16
  const [occlusionEnabled, setOcclusionEnabled] = useState(false); // 通用界面遮挡模拟开关（1:1 与 9:16 均可）
  const [reportOpen, setReportOpen] = useState(false); // 传播风险报告是否展开
  const [baseline, setBaseline] = useState<BaselineSnapshot | null>(null); // 修改前版本快照（仅内存）
  const [comparisonVisible, setComparisonVisible] = useState(false); // 是否显示对比结果
  const [ocrStatus, setOcrStatus] = useState<OcrRunStatus>('未检测'); // OCR 任务状态
  const [ocrProgress, setOcrProgress] = useState<{ done: number; total: number } | null>(null);
  const [ocrResults, setOcrResults] = useState<TextRecognitionResult[]>([]); // OCR 结果（过期即清除）
  const [ocrInvalidated, setOcrInvalidated] = useState(false); // 参数变化导致旧结果被清除的提示
  const ocrRunIdRef = useRef(0); // 递增作废进行中的 OCR 任务（如场景已变化）
  const [degradationEnabled, setDegradationEnabled] = useState(DEFAULT_DEGRADATION.enabled);
  const [scaleFactor, setScaleFactor] = useState(DEFAULT_DEGRADATION.scaleFactor);
  const [jpegQuality, setJpegQuality] = useState(DEFAULT_DEGRADATION.jpegQuality);
  const [degradedQrResults, setDegradedQrResults] = useState<Map<string, DegradedQrOutcome>>(new Map());
  const [degradationPreview, setDegradationPreview] = useState<{
    url: string;
    width: number;
    height: number;
  } | null>(null);
  const reuploadRef = useRef<HTMLInputElement>(null);

  /** 上传处理：校验格式；重新上传前确认清空标注 */
  const handleFile = (file: File) => {
    if (!/^image\/(png|jpeg)$/.test(file.type)) {
      window.alert('仅支持 PNG 或 JPG 格式的图片');
      return;
    }
    if (image && annotations.length > 0 && !window.confirm('重新上传将清空已有标注，确定继续吗？')) {
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      setImage(img);
      setImageW(img.naturalWidth);
      setImageH(img.naturalHeight);
      setFileName(file.name);
      setAnnotations([]); // 清空原有标注
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      window.alert('图片加载失败，请换一张图片重试');
    };
    img.src = url;
  };

  /** 新增标注（坐标已是原图坐标） */
  const addAnnotation = (rect: Rect) => {
    setAnnotations((prev) => [...prev, { ...rect, id: nextId(), label: activeLabel }]);
  };

  /** 删除标注 */
  const deleteAnnotation = (id: string) => {
    setAnnotations((prev) => prev.filter((a) => a.id !== id));
  };

  /** 修改标注标签 */
  const changeLabel = (id: string, label: LabelType) => {
    setAnnotations((prev) => prev.map((a) => (a.id === id ? { ...a, label } : a)));
  };

  /** 居中裁剪区域（原图坐标），比例由 cropRatio 决定；切换比例不改变标注数据 */
  const cropRect = useMemo(() => {
    if (!image) return null;
    const ratio = CROP_RATIO_OPTIONS.find((o) => o.value === cropRatio) ?? CROP_RATIO_OPTIONS[0];
    return computeCenterCrop(imageW, imageH, ratio.aspectW, ratio.aspectH);
  }, [image, imageW, imageH, cropRatio]);

  /** 通用界面遮挡矩形（原图坐标）。开关开启时按当前裁剪画面计算，
   * 切换 1:1 / 9:16 时 cropRect 变化，遮挡随之自动重算 */
  const occluders = useMemo(() => {
    if (!cropRect || !occlusionEnabled) return null;
    return computeOccluders(cropRect);
  }, [cropRect, occlusionEnabled]);

  /** 每条标注的可见率分析结果。
   * 始终提供最终可见率与最终分类：开启遮挡时为扣除遮挡后的结果；
   * 关闭遮挡时最终可见率 = 裁剪保留率（即遮挡不生效时的默认值）。 */
  const analyses: Analysis[] = useMemo(() => {
    if (!cropRect) return [];
    return annotations.map((annotation) => {
      const base = analyzeAnnotation(annotation, cropRect);
      if (!occluders) {
        return {
          annotation,
          ...base,
          finalRatio: base.ratio,
          finalLevel: base.level,
        };
      }
      const occ = analyzeWithOcclusion(annotation, cropRect, occluders);
      return {
        annotation,
        ...base,
        finalRatio: occ.finalVisibleRatio,
        finalLevel: occ.finalLevel,
      };
    });
  }, [annotations, cropRect, occluders]);

  /** 每条标注的问题诊断结果（复用几何可见率计算，不涉及任何 AI 分析） */
  const diagnoses = useMemo(() => {
    if (!cropRect) return [];
    return annotations.map((annotation) => diagnoseAnnotation(annotation, cropRect, occluders));
  }, [annotations, cropRect, occluders]);

  /** 二维码标注的可识别性压力测试结果。
   * 仅「二维码」标签执行解码；结果只在图片、标注、裁剪比例或遮挡状态变化时重新检测，
   * 避免重复执行昂贵的画布像素处理。 */
  const qrResults = useMemo(() => {
    const map = new Map<string, QrCheckResult>();
    if (!image || !cropRect) return map;
    for (const a of annotations) {
      if (!isQrAnnotation(a)) continue;
      map.set(a.id, detectQrForAnnotation(image, a, cropRect, occluders, imageW, imageH));
    }
    return map;
  }, [image, imageW, imageH, annotations, cropRect, occluders]);

  /** 当前生效的画质退化设置（关闭时为 null；仅参数值变化时产生新引用） */
  const degradation = useMemo(
    () => (degradationEnabled ? { scaleFactor, jpegQuality } : null),
    [degradationEnabled, scaleFactor, jpegQuality],
  );

  /** 快照用画质退化设置 */
  const degradationSnapshot = useMemo(
    () => ({ enabled: degradationEnabled, scaleFactor, jpegQuality }),
    [degradationEnabled, scaleFactor, jpegQuality],
  );

  /** 传播风险报告数据：全部从现有诊断与二维码检测结果派生，不做新计算 */
  const reportData = useMemo(() => {
    if (!image || !cropRect) return null;
    return buildReportData({
      fileName,
      imageWidth: imageW,
      imageHeight: imageH,
      cropRatio,
      occlusionEnabled,
      degradation: degradationSnapshot,
      sceneWidth: Math.round(cropRect.w),
      sceneHeight: Math.round(cropRect.h),
      degradedQrResults,
      diagnoses,
      qrResults,
      ocrResults: new Map(ocrResults.map((r) => [r.annotationId, r])),
    });
  }, [image, cropRect, fileName, imageW, imageH, cropRatio, occlusionEnabled, degradationSnapshot, degradedQrResults, diagnoses, qrResults, ocrResults]);

  /** 版本对比：快照存在时按当前状态实时生成对比结果；
   * 场景（裁剪比例 + 遮挡开关 + 画质退化设置）不一致时不生成结论。 */
  const comparisonResult = useMemo(() => {
    if (!baseline) return null;
    return buildComparisonResult(baseline, {
      cropRatio,
      occlusionEnabled,
      degradation: degradationSnapshot,
      annotations: toSnapshotAnnotations(diagnoses, qrResults),
    });
  }, [baseline, cropRatio, occlusionEnabled, degradationSnapshot, diagnoses, qrResults]);

  /** 保存修改前版本快照（需已上传图片且至少一个标注） */
  const handleSaveBaseline = () => {
    if (!image || !cropRect || annotations.length === 0) return;
    setBaseline(
      createSnapshot({
        fileName,
        imageWidth: imageW,
        imageHeight: imageH,
        cropRatio,
        occlusionEnabled,
        degradation: degradationSnapshot,
        diagnoses,
        qrResults,
      }),
    );
  };

  /** 清除修改前版本快照（重新上传不会清快照，只有这里才清） */
  const handleClearBaseline = () => {
    setBaseline(null);
    setComparisonVisible(false);
  };

  /** 需要执行 OCR 的文字类标注（二维码走二维码检测，不进入 OCR） */
  const ocrTargets = useMemo(() => annotations.filter((a) => isTextOcrTarget(a.label)), [annotations]);

  /** 图片 / 标注 / 裁剪比例 / 遮挡开关 / 画质退化参数任一变化 → 旧 OCR 结果过期：
   * 清空结果并作废进行中的任务，绝不静默展示过期检测结果。 */
  useEffect(() => {
    ocrRunIdRef.current += 1;
    // 有旧结果被清除时提示用户重新检测
    if (ocrResults.length > 0 || ocrStatus === '完成') setOcrInvalidated(true);
    setOcrResults([]);
    setOcrStatus('未检测');
    setOcrProgress(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [image, annotations, cropRatio, occlusionEnabled, degradation]);

  /** 运行文字识别测试：单个 worker 批量识别，结束后释放；任何异常不崩溃页面 */
  const handleRunOcr = async () => {
    if (!image || !cropRect || ocrTargets.length === 0) return;
    const runId = ++ocrRunIdRef.current;
    setOcrInvalidated(false);
    setOcrStatus('加载OCR模型');
    setOcrProgress({ done: 0, total: ocrTargets.length });
    setOcrResults([]);
    let engine: Awaited<ReturnType<typeof createOcrEngine>> | null = null;
    try {
      engine = await createOcrEngine();
      if (runId !== ocrRunIdRef.current) return; // 场景已变化，丢弃本次任务
      setOcrStatus('正在识别');
      const results: TextRecognitionResult[] = [];
      for (let i = 0; i < ocrTargets.length; i++) {
        if (runId !== ocrRunIdRef.current) return; // 中断
        const r = await runOcrForAnnotation(
          engine,
          image,
          ocrTargets[i],
          cropRect,
          occluders,
          imageW,
          imageH,
          degradation,
        );
        results.push(r);
        setOcrProgress({ done: i + 1, total: ocrTargets.length });
      }
      if (runId === ocrRunIdRef.current) {
        setOcrResults(results);
        setOcrStatus('完成');
      }
    } catch {
      // 模型加载失败 / 断网 / worker 异常：转为可处理的失败结果，不崩溃页面
      if (runId === ocrRunIdRef.current) {
        setOcrStatus('失败');
        setOcrResults(ocrTargets.map((a) => ocrFailedResult(a.id, OCR_FAILED_MESSAGE)));
      }
    } finally {
      try {
        await engine?.dispose();
      } catch {
        // 释放失败可忽略
      }
    }
  };

  /** 二维码画质退化检测（第三阶段）：仅在启用退化、图片/场景/参数变化时重算。
   * 异步执行（JPEG 编解码），用取消标记避免过期任务覆盖新结果。 */
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setDegradedQrResults(new Map());
      if (!image || !cropRect || !degradation) return;
      const map = new Map<string, DegradedQrOutcome>();
      for (const a of annotations) {
        if (a.label !== '二维码') continue;
        try {
          const outcome = await detectDegradedQrForAnnotation(
            image,
            a,
            cropRect,
            occluders,
            imageW,
            imageH,
            degradation,
          );
          if (cancelled) return;
          map.set(a.id, outcome);
        } catch {
          // 单条失败忽略（由检测函数内部已兜底，这里再兜一次）
        }
      }
      if (!cancelled) setDegradedQrResults(map);
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [image, imageW, imageH, annotations, cropRect, occluders, degradation]);

  /** 画质退化结果预览：仅在启用退化时生成（scene 全图 → 缩小 + JPEG） */
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setDegradationPreview(null);
      if (!image || !cropRect || !degradation) return;
      try {
        const preview = await buildDegradedScenePreview(
          image,
          cropRect,
          occluders,
          degradation.scaleFactor,
          degradation.jpegQuality,
        );
        if (!cancelled && preview) setDegradationPreview(preview);
      } catch {
        // 预览失败不阻塞任何检测流程
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [image, cropRect, occluders, degradation]);

  /** 检测结果概览计数（按最终分类统计，供结果概览卡片展示） */
  const overview = useMemo(() => {
    const counts = { 完整: 0, 部分可见: 0, 严重缺失: 0 };
    for (const a of analyses) counts[a.finalLevel ?? a.level] += 1;
    return { total: analyses.length, ...counts };
  }, [analyses]);

  /** 流程导航当前步骤（简单规则，仅用于高亮，不影响业务逻辑）：
   * 未上传 → 1 上传作品；无标注 → 2 标记信息；有标注 → 3 设置传播场景；
   * 报告展开 → 4 查看风险；已保存修改前版本 → 5 修改后验证 */
  const currentStep = !image
    ? 1
    : annotations.length === 0
      ? 2
      : reportOpen
        ? 4
        : baseline
          ? 5
          : 3;

  return (
    <div className="app">
      {/* 顶部标题栏 */}
      <header className="app-header">
        <div className="logo">◆</div>
        <div className="header-text">
          <h1>传播实验室</h1>
          <p>数字内容关键信息传播压力测试</p>
        </div>
        <span className="stage-badge">演示版</span>
      </header>

      {/* 产品说明 + 5 步流程导航（仅帮助理解流程，不影响业务逻辑） */}
      <div className="app-intro">
        <p className="intro-text">
          标记必须传达的重要信息，模拟裁剪与界面遮挡，检查信息在传播过程中是否发生缺失或功能失效。
        </p>
        <StepsNav currentStep={currentStep} />
      </div>

      <main className="app-main">
        {/* 左侧：上传 / 标注画布 */}
        <section className="left-panel">
          {image ? (
            <div className="card canvas-card">
              <div className="card-toolbar">
                <div className="file-info">
                  <span className="file-name" title={fileName}>{fileName}</span>
                  <span className="file-size">{formatSize(imageW, imageH)}（原图尺寸）</span>
                </div>
                <button className="btn-ghost" onClick={() => reuploadRef.current?.click()}>
                  重新上传
                </button>
                <input
                  ref={reuploadRef}
                  type="file"
                  accept="image/png,image/jpeg"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleFile(f);
                    e.target.value = '';
                  }}
                />
              </div>

              {/* 新标注的标签选择 */}
              <div className="label-picker">
                <span className="picker-label">新标注标签：</span>
                {LABEL_OPTIONS.map((opt) => (
                  <button
                    key={opt}
                    className={`label-chip ${activeLabel === opt ? 'active' : ''}`}
                    style={
                      activeLabel === opt
                        ? { background: LABEL_COLORS[opt], borderColor: LABEL_COLORS[opt] }
                        : undefined
                    }
                    onClick={() => setActiveLabel(opt)}
                  >
                    {opt}
                  </button>
                ))}
              </div>

              <AnnotationCanvas
                image={image}
                imageW={imageW}
                imageH={imageH}
                annotations={annotations}
                onAdd={addAnnotation}
              />
              <div className="canvas-hint">
                选择标签后，在原图上拖动鼠标框选必须传达的信息。
                {annotations.length === 0 && '建议优先标记标题、日期、地点、二维码等关键信息。'}
              </div>
            </div>
          ) : (
            <div className="card upload-card">
              <UploadPanel onFile={handleFile} />
            </div>
          )}
        </section>

        {/* 右侧：传播场景 / 结果概览 / 标注清单 / 问题诊断 / 报告 / 检测规则 / 版本对比 */}
        <aside className="right-panel">
          {image && cropRect ? (
            <>
              {/* 1. 传播场景（裁剪比例 / 界面遮挡 / 裁剪预览） */}
              <div className="card">
                <CropPreview
                  image={image}
                  imageW={imageW}
                  imageH={imageH}
                  cropRect={cropRect}
                  analyses={analyses}
                  cropRatio={cropRatio}
                  onRatioChange={setCropRatio}
                  occlusionEnabled={occlusionEnabled}
                  onOcclusionChange={setOcclusionEnabled}
                  occluders={occluders}
                />
              </div>

              {/* 画质退化压力测试（缩小 + JPEG 有损压缩） */}
              <div className="card">
                <DegradationPanel
                  enabled={degradationEnabled}
                  scaleFactor={scaleFactor}
                  jpegQuality={jpegQuality}
                  sceneWidth={cropRect ? Math.round(cropRect.w) : 0}
                  sceneHeight={cropRect ? Math.round(cropRect.h) : 0}
                  preview={degradationPreview}
                  onEnabledChange={setDegradationEnabled}
                  onScaleChange={setScaleFactor}
                  onQualityChange={setJpegQuality}
                />
              </div>

              {/* 2. 检测结果概览（严重缺失优先展示） */}
              <div className="card">
                <ResultOverview
                  total={overview.total}
                  full={overview['完整']}
                  partial={overview['部分可见']}
                  missing={overview['严重缺失']}
                />
              </div>

              {/* 3. 标注清单（可折叠，默认折叠，点击标题展开） */}
              <div className="card">
                <CollapsibleSection
                  title="标注清单"
                  count={annotations.length}
                  defaultOpen={false}
                >
                  <AnnotationList
                    analyses={analyses}
                    onChangeLabel={changeLabel}
                    onDelete={deleteAnnotation}
                  />
                </CollapsibleSection>
              </div>

              {/* 4. 问题诊断（可折叠） */}
              <div className="card">
                <CollapsibleSection title="问题诊断" count={diagnoses.length}>
                  <DiagnosisPanel
                    diagnoses={diagnoses}
                    qrResults={qrResults}
                    ocrResults={ocrResults}
                    degradedQrResults={degradedQrResults}
                  />
                </CollapsibleSection>
              </div>

              {/* 文字识别测试（OCR 第一版：仅在用户主动运行后执行） */}
              <div className="card">
                <TextRecognitionPanel
                  status={ocrStatus}
                  progress={ocrProgress}
                  results={ocrResults}
                  targets={ocrTargets}
                  canRun={!!image && !!cropRect && ocrTargets.length > 0}
                  invalidated={ocrInvalidated}
                  onRun={handleRunOcr}
                />
              </div>

              {/* 5. 查看检测报告（入口按钮；报告在页面下方宽版展开） */}
              <div className="report-entry">
                <button
                  className="btn-ghost report-toggle-btn"
                  onClick={() => setReportOpen((open) => !open)}
                >
                  {reportOpen ? '收起检测报告' : '查看检测报告'}
                </button>
                <p className="entry-hint">汇总当前传播场景中的问题，报告将在页面下方展开</p>
              </div>
            </>
          ) : (
            /* 空状态：未上传图片时只显示流程引导，不显示空白检测面板 */
            <div className="card guide-card">
              <div className="panel-title">从这里开始</div>
              <p className="guide-text">
                上传一张 PNG 或 JPG 作品后，将逐步显示标注、场景设置与风险检查工具。
              </p>
              <ol className="guide-steps">
                <li>1 上传作品</li>
                <li>2 标记信息</li>
                <li>3 设置传播场景</li>
                <li>4 查看风险</li>
                <li>5 修改后验证</li>
              </ol>
            </div>
          )}

          {image && cropRect && (
            <>
              {/* 检测规则说明 */}
              <div className="card threshold-card">
                <div className="panel-title">检测规则</div>
                <ul className="threshold-list">
                  <li><span className="badge level-full">完整</span>几何可见率 ≥ 85%</li>
                  <li><span className="badge level-partial">部分可见</span>50% ～ 85%</li>
                  <li><span className="badge level-missing">严重缺失</span>低于 50%</li>
                </ul>
                <p className="threshold-note">
                  注：几何可见率仅表示标注区域被裁剪后剩余的面积比例，
                  <strong>不代表区域内的文字能被准确阅读</strong>。
                </p>
              </div>

              {/* 6. 版本对比（可折叠，默认折叠，点击标题展开） */}
              <div className="card">
                <CollapsibleSection title="版本对比" defaultOpen={false}>
                  <VersionComparison
                    baseline={baseline}
                    currentFileName={fileName}
                    currentCropRatio={cropRatio}
                    currentOcclusionEnabled={occlusionEnabled}
                    canSave={!!image && !!cropRect && annotations.length > 0}
                    result={comparisonVisible ? comparisonResult : null}
                    onSave={handleSaveBaseline}
                    onCompare={() => setComparisonVisible(true)}
                    onClear={handleClearBaseline}
                  />
                </CollapsibleSection>
              </div>
            </>
          )}
        </aside>
      </main>

      {/* 宽版传播风险报告：点击「查看检测报告」后在主编辑区下方展开，
          复用现有 RiskReport 组件与数据，不做任何新的报告逻辑 */}
      {reportOpen && reportData && (
        <section className="wide-report">
          <div className="card">
            <RiskReport data={reportData} />
          </div>
        </section>
      )}
    </div>
  );
}
