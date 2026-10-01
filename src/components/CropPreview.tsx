/**
 * 右侧裁剪预览（支持 1:1 与 9:16 切换）：
 * 1. 上方示意：原图缩略 + 灰显被裁掉的部分 + 裁剪框与标注框位置；
 * 2. 下方结果：按裁剪比例的实际画面（宽高比随裁剪区推导，不拉伸），
 *    并准确绘制各标注的保留区域与几何可见率。
 */
import { useEffect, useRef, useState } from 'react';
import { Group, Image as KonvaImage, Layer, Rect, Stage, Text } from 'react-konva';
import type { Annotation, CropRatio, Rect as RectT, VisibilityLevel } from '../types';
import { CROP_RATIO_OPTIONS, LABEL_COLORS } from '../constants';
import { formatPercent } from '../utils/format';
import { intersectRect } from '../utils/geometry';
import { OCCLUDER_SPECS, visiblePartsAfterOcclusion } from '../utils/occlusion';

/** 单条标注的分析结果（由 App 统一计算） */
export interface Analysis {
  annotation: Annotation;
  ratio: number; // 裁剪保留率（裁剪后保留面积 / 原始标注面积）
  level: VisibilityLevel;
  finalRatio?: number; // 最终几何可见率（开启遮挡时再扣除遮挡；关闭遮挡时等于裁剪保留率）
  finalLevel?: VisibilityLevel; // 基于最终可见率的检测结果
}

interface Props {
  image: HTMLImageElement;
  imageW: number;
  imageH: number;
  cropRect: RectT; // 居中裁剪区域（原图坐标，比例随 cropRatio 变化）
  analyses: Analysis[];
  cropRatio: CropRatio; // 当前裁剪比例（用于切换控件显示）
  onRatioChange: (ratio: CropRatio) => void;
  occlusionEnabled: boolean; // 通用界面遮挡模拟开关（1:1 与 9:16 均可）
  onOcclusionChange: (enabled: boolean) => void;
  occluders: RectT[] | null; // 遮挡矩形（原图坐标，未启用时为 null）
}

/** 缩略图与裁剪结果的画布逻辑尺寸上限（像素） */
const MAX_STAGE_W = 300;

export function CropPreview({
  image,
  imageW,
  imageH,
  cropRect,
  analyses,
  cropRatio,
  onRatioChange,
  occlusionEnabled,
  onOcclusionChange,
  occluders,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [stageW, setStageW] = useState(MAX_STAGE_W);

  // 监听容器宽度：窄屏（手机）时画布随容器缩小，避免固定 300px 把页面撑宽。
  // 只影响显示尺寸，缩略/预览均为显示层缩放，不改动任何原图坐标数据。
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? MAX_STAGE_W;
      setStageW(Math.max(1, Math.min(MAX_STAGE_W, w)));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const thumbScale = stageW / imageW;
  const thumbH = imageH * thumbScale;
  // 结果画布高度由裁剪区域宽高比推导，保证 9:16 竖屏不被拉伸成正方形
  const previewH = stageW * (cropRect.h / cropRect.w);
  const previewScale = stageW / cropRect.w;

  // 裁剪区域外四个方向的遮罩（灰显被裁掉的部分）
  const masks: RectT[] = [
    { x: 0, y: 0, w: imageW, h: cropRect.y }, // 上
    { x: 0, y: cropRect.y + cropRect.h, w: imageW, h: imageH - cropRect.y - cropRect.h }, // 下
    { x: 0, y: cropRect.y, w: cropRect.x, h: cropRect.h }, // 左
    {
      x: cropRect.x + cropRect.w,
      y: cropRect.y,
      w: imageW - cropRect.x - cropRect.w,
      h: cropRect.h,
    }, // 右
  ];

  return (
    <div className="crop-preview" ref={containerRef}>
      <div className="panel-title">
        裁剪预览
        {/* 裁剪比例切换控件 */}
        <div className="ratio-switch">
          {CROP_RATIO_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              className={`ratio-btn ${cropRatio === opt.value ? 'active' : ''}`}
              aria-pressed={cropRatio === opt.value}
              onClick={() => onRatioChange(opt.value)}
              title={`切换为 ${opt.label} 居中裁剪`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* 场景说明：裁剪模拟为居中裁剪 */}
      <p className="scene-note">当前为居中裁剪模拟。</p>

      {/* 通用界面遮挡模拟开关（1:1 与 9:16 模式均可用） */}
      <div className="occlusion-bar">
        <label className="occlusion-label">
          <input
            type="checkbox"
            className="occlusion-toggle"
            checked={occlusionEnabled}
            onChange={(e) => onOcclusionChange(e.target.checked)}
          />
          通用界面遮挡模拟
        </label>
        <span className="occlusion-hint">用于压力测试的简化参数，不对应任何真实平台官方尺寸</span>
      </div>

      {/* 示意：原图 + 灰显遮罩 + 裁剪框 + 标注框 */}
      <Stage width={stageW} height={thumbH}>
        <Layer>
          <KonvaImage image={image} width={stageW} height={thumbH} />
          {masks.map((m, i) => (
            <Rect
              key={i}
              x={m.x * thumbScale}
              y={m.y * thumbScale}
              width={Math.max(0, m.w * thumbScale)}
              height={Math.max(0, m.h * thumbScale)}
              fill="#111827"
              opacity={0.55}
            />
          ))}
          <Rect
            x={cropRect.x * thumbScale}
            y={cropRect.y * thumbScale}
            width={cropRect.w * thumbScale}
            height={cropRect.h * thumbScale}
            stroke="#4f46e5"
            strokeWidth={2}
          />
          {analyses.map(({ annotation: a }) => (
            <Rect
              key={a.id}
              x={a.x * thumbScale}
              y={a.y * thumbScale}
              width={a.w * thumbScale}
              height={a.h * thumbScale}
              stroke={LABEL_COLORS[a.label]}
              strokeWidth={1}
            />
          ))}
          {/* 通用界面遮挡（仅开启时显示，位置与计算共用同一组数据） */}
          {occluders &&
            occluders.map((o, i) => (
              <Rect
                key={`thumb-occ-${i}`}
                x={o.x * thumbScale}
                y={o.y * thumbScale}
                width={o.w * thumbScale}
                height={o.h * thumbScale}
                fill="#111827"
                opacity={0.4}
              />
            ))}
        </Layer>
      </Stage>
      <div className="panel-caption">紫色框为 {cropRatio} 裁剪区域，灰色部分将被裁掉</div>

      {/* 结果：1:1 裁剪画面 + 各标注保留区域与可见率 */}
      <div className="crop-result">
        <Stage width={stageW} height={previewH}>
          <Layer clip={{ x: 0, y: 0, width: stageW, height: previewH }}>
            {/* 从原图裁剪出中心区域并铺满画布（宽高比与裁剪区域一致，不拉伸） */}
            <KonvaImage
              image={image}
              crop={{ x: cropRect.x, y: cropRect.y, width: cropRect.w, height: cropRect.h }}
              width={stageW}
              height={previewH}
            />
            {analyses.map(({ annotation: a, ratio, finalRatio }) => {
              const kept = intersectRect(a, cropRect); // 裁剪保留部分（原图坐标）
              if (!kept) return null;
              // 开启遮挡时绘制「扣除遮挡后的可见部分」；未开启时绘制整个保留部分
              const parts = occluders ? visiblePartsAfterOcclusion(kept, occluders) : [kept];
              const displayRatio = occluders ? (finalRatio ?? 0) : ratio;
              // 标签放在第一块可见部分（完全被遮挡时退回保留区左上角）
              const labelRef = parts[0] ?? kept;
              const lx = (labelRef.x - cropRect.x) * previewScale;
              const ly = (labelRef.y - cropRect.y) * previewScale;
              return (
                <Group key={a.id}>
                  {parts.map((p, i) => (
                    <Rect
                      key={i}
                      x={(p.x - cropRect.x) * previewScale}
                      y={(p.y - cropRect.y) * previewScale}
                      width={p.w * previewScale}
                      height={p.h * previewScale}
                      stroke={LABEL_COLORS[a.label]}
                      strokeWidth={2}
                      fill={`${LABEL_COLORS[a.label]}2e`}
                    />
                  ))}
                  <Text
                    x={lx + 5}
                    y={ly + 4}
                    text={`${a.label} ${formatPercent(displayRatio)}`}
                    fontSize={11}
                    fontStyle="bold"
                    fill="#ffffff"
                    stroke={LABEL_COLORS[a.label]}
                    strokeWidth={3}
                  />
                </Group>
              );
            })}
            {/* 通用界面遮挡绘制（最上层，与计算共用同一组遮挡数据） */}
            {occluders &&
              occluders.map((o, i) => {
                const px = (o.x - cropRect.x) * previewScale;
                const py = (o.y - cropRect.y) * previewScale;
                const pw = o.w * previewScale;
                const ph = o.h * previewScale;
                return (
                  <Group key={`occ-${i}`}>
                    <Rect
                      x={px}
                      y={py}
                      width={pw}
                      height={ph}
                      fill="#111827"
                      opacity={0.45}
                      stroke="#4b5563"
                      strokeWidth={1}
                      dash={[3, 2]}
                    />
                    <Text
                      x={px}
                      y={py + ph / 2 - 6}
                      width={pw}
                      align="center"
                      text={OCCLUDER_SPECS[i].name}
                      fontSize={10}
                      fill="#e5e7eb"
                    />
                  </Group>
                );
              })}
          </Layer>
        </Stage>
      </div>
      <div className="panel-caption">{cropRatio} 裁剪结果：各区域保留部分与几何可见率</div>
      {/* 遮挡生效时的声明（仅在真正应用遮挡时显示） */}
      {occluders && (
        <p className="occlusion-note">
          注：通用界面遮挡模拟为用于压力测试的简化参数，不对应任何真实平台官方尺寸，
          也不代表区域内文字仍能被准确阅读。
        </p>
      )}
    </div>
  );
}
