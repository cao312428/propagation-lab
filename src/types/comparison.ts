/**
 * 版本对比相关类型定义。
 * 快照只保存检测结果的数值与文字，不保存 Image 对象、Canvas 或像素数据；
 * 全部数据仅存在于浏览器当前内存中，刷新页面后丢失。
 */
import type { CropRatio, LabelType, VisibilityLevel } from '../types';
import type {
  CropDirection,
  OccluderSource,
  ProblemSource,
} from '../utils/diagnosis';
import type { QrConclusion } from '../utils/qrDetection';

/** 快照中单个标注的检测结果（从 DiagnosisResult / QrCheckResult 提取的纯数据） */
export interface SnapshotAnnotation {
  label: LabelType;
  /** 裁剪保留率（0～1） */
  cropKeptRatio: number;
  /** 最终几何可见率（0～1） */
  finalVisibleRatio: number;
  /** 分类结果（基于最终可见率） */
  level: VisibilityLevel;
  problemSource: ProblemSource;
  cropDirection: CropDirection | null;
  occlusionSource: OccluderSource | null;
  suggestion: string;
  /** 二维码检测结果（仅「二维码」标签存在，其他标签为 null） */
  qr: {
    baselineReadable: boolean;
    scenarioReadable: boolean;
    conclusion: QrConclusion;
  } | null;
}

/** 快照中的画质退化设置（参与场景一致性判断） */
export interface DegradationSnapshot {
  enabled: boolean;
  scaleFactor: number;
  jpegQuality: number;
}

/** 修改前版本快照（保存时点的完整检测状态） */
export interface BaselineSnapshot {
  fileName: string;
  imageWidth: number;
  imageHeight: number;
  cropRatio: CropRatio;
  occlusionEnabled: boolean;
  /** 保存时的画质退化设置（参与场景一致性判断） */
  degradation: DegradationSnapshot;
  /** 按保存时的标注顺序排列 */
  annotations: SnapshotAnnotation[];
}

/** 配对状态 */
export type PairStatus = '匹配' | '修改后未标注' | '新增标注';

/** 一条配对记录：同标签 + 同顺序配对，数量不齐时一方为 null */
export interface ComparisonPair {
  label: LabelType;
  status: PairStatus;
  before: SnapshotAnnotation | null;
  after: SnapshotAnnotation | null;
}

/** 区域变化分类 */
export type ChangeDirection = '改善' | '基本不变' | '下降';

/** 单个匹配区域的对比结果 */
export interface RegionComparison {
  pair: ComparisonPair;
  /** 裁剪保留率变化（百分点，after - before） */
  cropDeltaPp: number;
  /** 最终几何可见率变化（百分点，after - before） */
  finalDeltaPp: number;
  /** 分类变化文本，如「严重缺失 → 完整」；前后相同时为 null */
  levelChangeText: string | null;
  /** 二维码状态变化文本，如「可识别 → 无法识别」；非二维码标注为 null */
  qrStatusText: string | null;
  /** 二维码突出文案：「修改后二维码恢复可识别」/「修改后二维码失去可识别性」；无变化为 null */
  qrHighlightText: string | null;
  /** 综合变化分类（二维码功能性变化优先级高于几何变化） */
  direction: ChangeDirection;
}

/** 版本对比的完整结果 */
export interface ComparisonResult {
  /** 测试场景（裁剪比例 + 遮挡开关）是否一致；不一致时不生成任何结论 */
  scenarioMatch: boolean;
  /** 全部配对记录（含未配对），按标签分组顺序排列 */
  pairs: ComparisonPair[];
  /** 匹配区域的对比明细（场景一致时生成） */
  regions: RegionComparison[];
  /** 总体变化摘要（场景一致时生成；不一致为 null） */
  summary: string | null;
}
