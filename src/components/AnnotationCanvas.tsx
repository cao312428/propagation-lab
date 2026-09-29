/**
 * 标注画布：显示原图，支持按住鼠标拖动绘制重要信息矩形框。
 *
 * 坐标处理关键点：
 * - 画布随容器宽度缩放显示，但所有标注数据一律保存为「原图坐标」。
 * - 借助 Konva 的 Layer 缩放 + getRelativePointerPosition()，
 *   鼠标位置会被自动换算回原图坐标，界面缩放不影响数据准确性。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Image as KonvaImage, Layer, Rect, Stage, Text } from 'react-konva';
import type Konva from 'konva';
import type { Annotation, Rect as RectT } from '../types';
import { LABEL_COLORS } from '../constants';
import { clampRectToImage, normalizeRect } from '../utils/geometry';

interface Props {
  image: HTMLImageElement;
  imageW: number;
  imageH: number;
  annotations: Annotation[];
  /** 用户完成一次框选后回调（矩形已是原图坐标） */
  onAdd: (rect: RectT) => void;
}

export function AnnotationCanvas({ image, imageW, imageH, annotations, onAdd }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<Konva.Layer>(null);
  const onAddRef = useRef(onAdd);
  onAddRef.current = onAdd;

  const [containerW, setContainerW] = useState(0); // 画布容器宽度（像素）
  const [drawing, setDrawing] = useState<RectT | null>(null); // 正在绘制的框（用于渲染虚线）
  const drawingRef = useRef<RectT | null>(null); // 绘制中的真实数据（避免闭包过期）

  // 监听容器宽度变化，画布自适应缩放
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      setContainerW(entries[0].contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // 界面缩放比例 = 容器宽度 / 原图宽度
  const scale = containerW > 0 ? containerW / imageW : 1;
  const stageW = Math.max(1, imageW * scale);
  const stageH = Math.max(1, imageH * scale);

  /** 获取鼠标在原图坐标系中的位置（Layer 带缩放，Konva 自动反算） */
  const getImagePos = (): { x: number; y: number } | null => {
    const pos = layerRef.current?.getRelativePointerPosition();
    return pos ? { x: pos.x, y: pos.y } : null;
  };

  /** 结束绘制：归一化 + 限制在图片范围内，过小的框忽略 */
  const finishDrawing = useCallback(() => {
    const d = drawingRef.current;
    drawingRef.current = null;
    setDrawing(null);
    if (!d) return;
    const norm = normalizeRect(d.x, d.y, d.x + d.w, d.y + d.h);
    const clamped = clampRectToImage(norm, imageW, imageH);
    if (clamped.w >= 4 && clamped.h >= 4) onAddRef.current(clamped);
  }, [imageW, imageH]);

  // 在 window 上监听移动与松开：鼠标拖出画布后仍能正常完成绘制
  useEffect(() => {
    const onMove = () => {
      const d = drawingRef.current;
      if (!d) return;
      const pos = layerRef.current?.getRelativePointerPosition();
      if (!pos) return;
      const next = { ...d, w: pos.x - d.x, h: pos.y - d.y };
      drawingRef.current = next;
      setDrawing(next);
    };
    const onUp = () => finishDrawing();
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [finishDrawing]);

  const handleMouseDown = () => {
    const pos = getImagePos();
    if (!pos) return;
    const rect = { x: pos.x, y: pos.y, w: 0, h: 0 };
    drawingRef.current = rect;
    setDrawing(rect);
  };

  // 描边/虚线按屏幕像素恒定（除以 scale 抵消 Layer 缩放）
  const borderWidth = 2 / scale;

  return (
    <div className="canvas-area" ref={containerRef}>
      <Stage
        width={stageW}
        height={stageH}
        onMouseDown={handleMouseDown}
        style={{ cursor: 'crosshair' }}
      >
        <Layer ref={layerRef} scaleX={scale} scaleY={scale}>
          {/* 原图（覆盖整个画布） */}
          <KonvaImage image={image} width={imageW} height={imageH} />

          {/* 已保存的标注框 */}
          {annotations.map((a) => (
            <Rect
              key={`rect-${a.id}`}
              x={a.x}
              y={a.y}
              width={a.w}
              height={a.h}
              stroke={LABEL_COLORS[a.label]}
              strokeWidth={borderWidth}
              fill={`${LABEL_COLORS[a.label]}26`}
            />
          ))}
          {/* 标注标签文字：反向缩放，保证屏幕上的字号恒定 */}
          {annotations.map((a) => (
            <Text
              key={`text-${a.id}`}
              x={a.x + 4 / scale}
              y={a.y + 2 / scale}
              text={a.label}
              fontSize={12}
              fontStyle="bold"
              fill="#ffffff"
              stroke={LABEL_COLORS[a.label]}
              strokeWidth={3}
              scaleX={1 / scale}
              scaleY={1 / scale}
            />
          ))}

          {/* 正在绘制的虚线框 */}
          {drawing && (
            <Rect
              x={drawing.x}
              y={drawing.y}
              width={drawing.w}
              height={drawing.h}
              stroke="#4f46e5"
              strokeWidth={borderWidth}
              dash={[6 / scale, 4 / scale]}
            />
          )}
        </Layer>
      </Stage>
    </div>
  );
}
