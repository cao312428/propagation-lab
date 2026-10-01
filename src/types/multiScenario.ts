/**
 * 多场景传播压力测试相关类型定义。
 *
 * 本模块只描述「关键信息区域 × 传播场景」的结果数据结构：
 * - 几何状态（完整 / 部分可见 / 严重缺失）与二维码 / OCR 功能性状态分开保存，
 *   绝不混成一个综合评分；
 * - 所有几何数据来自现有诊断模块（原图坐标），不新增任何判断算法。
 */
import type { Annotation, CropRatio, LabelType, Rect, VisibilityLevel } from '../types';
import type {
  CropDirection,
  OccluderSource,
  ProblemSource,
} from '../utils/diagnosis';

/** 场景分组（仅用于界面分组展示） */
export type ScenarioGroup = '裁剪' | '裁剪+遮挡' | '画质压力';

/** 场景定义（静态声明） */
export interface ScenarioDefinition {
  /** 稳定场景 id，如 'crop-4-5' / 'deg-medium' */
  id: string;
  /** 场景名称，如「4:5 居中裁剪」 */
  name: string;
  /** 界面分组 */
  group: ScenarioGroup;
  /**
   * 裁剪比例；画质退化预设为 null，
   * 表示「基于当前单场景（当前裁剪比例 + 当前遮挡开关）执行」。
   */
  cropRatio: CropRatio | null;
  /** 是否叠加通用界面遮挡（画质退化预设解析时跟随当前单场景开关） */
  occlusionEnabled: boolean;
  /** 画质退化预设参数（null = 无退化） */
  degradationPreset: { scaleFactor: number; jpegQuality: number } | null;
}

/** 解析后的场景（具备可执行的完整几何条件，均为原图坐标） */
export interface ResolvedScenario {
  definition: ScenarioDefinition;
  /** 场景完整文案，如「4:5 居中裁剪 + 通用界面遮挡」 */
  detail: string;
  /** 实际生效的遮挡开关（画质退化预设 = 解析时的当前单场景开关） */
  occlusionEnabled: boolean;
  cropRect: Rect;
  occluders: Rect[] | null;
  /** 实际生效的退化参数（null = 无退化） */
  degradation: { scaleFactor: number; jpegQuality: number } | null;
}

/** 矩阵单元格中的二维码状态（只描述解码结果，与几何状态分开保存） */
export type QrMatrixStatus = '可识别' | '无法识别' | '原图不可识别' | '未测试';

/** 矩阵单元格中的 OCR 状态（未运行 ≠ 失败） */
export type OcrMatrixStatus = '保持一致' | '发生变化' | '未能识别' | '原图未识别' | '未运行';

/** 单个区域在单个场景下的二维码数据（仅「二维码」标注存在；其他标注为 null） */
export interface QrMatrixData {
  /** 原图（未经传播处理）是否可识别 */
  baselineReadable: boolean;
  /** 该场景（裁剪 + 可选遮挡）中是否可识别 */
  scenarioReadable: boolean;
  /**
   * 退化检测是否已执行：null = 非退化场景；false = 退化场景但 scene 已无法识别，
   * 未执行退化检测；true = 已执行退化检测（degradedReadable 为真实解码结果）。
   */
  degradedChecked: boolean | null;
  /** 画质退化后是否可识别（未执行退化检测时为 false） */
  degradedReadable: boolean;
  /** 矩阵单元格状态（由上述布尔值映射，纯展示） */
  status: QrMatrixStatus;
  /** 场景识别出的内容（截断前原文，详情面板展示） */
  scenarioContent?: string;
  /** 画质退化后识别出的内容（可选） */
  degradedContent?: string;
  /** 画质退化结论文案（复用现有 classifyDegradedQr，可选） */
  degradedConclusion?: string;
}

/** 单个区域在单个场景下的 OCR 数据（仅文字标注且已有匹配结果时存在；null 显示「未运行」） */
export interface OcrMatrixData {
  status: OcrMatrixStatus;
  /** 字符级相似度（0～1）；无法比较时为 null */
  similarity: number | null;
  /** 原图识别的原始文本（详情面板展示） */
  baselineText?: string;
  /** 该场景识别的原始文本 */
  scenarioText?: string;
}

/** 单个区域在单个场景下的完整结果（几何与功能性状态分开保存） */
export interface RegionScenarioResult {
  annotationId: string;
  label: LabelType;
  /* ---- 几何部分（复用诊断模块输出，原图坐标） ---- */
  cropKeptRatio: number;
  finalVisibleRatio: number;
  level: VisibilityLevel;
  problemSource: ProblemSource;
  cropDirection: CropDirection | null;
  occlusionSource: OccluderSource | null;
  suggestion: string;
  /* ---- 功能性部分（独立保存，互不影响） ---- */
  qr: QrMatrixData | null;
  ocr: OcrMatrixData | null;
}

/** 单个场景的完整结果 */
export interface ScenarioResult {
  definition: ScenarioDefinition;
  detail: string;
  /** 按标注原始顺序排列，与所有场景一致 */
  regions: RegionScenarioResult[];
}

/** 多场景运行摘要（纯计数，不是评分） */
export interface MultiScenarioSummary {
  /** 已测试场景数 */
  testedScenarioCount: number;
  /** 存在至少一个「严重缺失」区域的场景数 */
  missingScenarioCount: number;
  /** 出现「无法识别」二维码的场景数（仅原图可识别而场景失败时计入） */
  qrFailureScenarioCount: number;
}

/** 一次多场景运行的完整结果（含失效指纹所需的输入引用） */
export interface MultiScenarioRunResult {
  /** 运行时的原图对象（引用比较，用于失效判断） */
  image: HTMLImageElement;
  /** 运行时的标注数组（引用比较，用于失效判断） */
  annotations: Annotation[];
  /** 运行时选中的场景 id（已排序副本） */
  selectedScenarioIds: string[];
  /** 运行时当前单场景裁剪比例（退化预设的基础场景） */
  currentCropRatio: CropRatio;
  /** 运行时当前单场景遮挡开关（退化预设的基础场景） */
  currentOcclusionEnabled: boolean;
  scenarios: ScenarioResult[];
  summary: MultiScenarioSummary;
}

/** 多场景运行状态 */
export type MultiScenarioRunStatus = 'idle' | 'running' | 'done' | 'stale';
