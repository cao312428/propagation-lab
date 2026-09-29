import { useRef, useState } from 'react';
import type { DragEvent } from 'react';

interface Props {
  /** 用户选择文件后回调（格式校验由上层 App 负责） */
  onFile: (file: File) => void;
}

/** 上传面板：点击或拖拽选择 PNG / JPG 图片 */
export function UploadPanel({ onFile }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false); // 是否正在拖拽悬停

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) onFile(file);
  };

  return (
    <div
      className={`upload-panel ${dragging ? 'dragging' : ''}`}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      <div className="upload-icon">
        {/* 图片占位图标（内联 SVG，无外部资源） */}
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#4f46e5" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="3" />
          <circle cx="9" cy="9" r="2" />
          <path d="M21 15l-5-5-8 8" />
        </svg>
      </div>
      <div className="upload-title">上传一张 PNG 或 JPG 作品开始测试</div>
      <div className="upload-hint">点击选择文件，或将图片拖拽到此处</div>
      <div className="upload-formats">支持 PNG / JPG 格式</div>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          e.target.value = ''; // 允许连续选择同一文件
        }}
      />
    </div>
  );
}
