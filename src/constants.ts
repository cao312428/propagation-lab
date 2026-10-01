import type { CropRatio, LabelType } from './types';

/** 各标签的展示颜色（画布描边、列表色块、预览框共用） */
export const LABEL_COLORS: Record<LabelType, string> = {
  标题: '#6366f1', // 靛蓝
  日期: '#10b981', // 翠绿
  地点: '#f59e0b', // 琥珀
  二维码: '#ec4899', // 玫红
  其他: '#64748b', // 石板灰
};

/** 全部标签选项（顺序即界面展示顺序） */
export const LABEL_OPTIONS: LabelType[] = ['标题', '日期', '地点', '二维码', '其他'];

/** 裁剪比例选项配置（aspectW / aspectH 为裁剪宽高比，均为居中裁剪） */
export const CROP_RATIO_OPTIONS: {
  value: CropRatio;
  label: string;
  aspectW: number;
  aspectH: number;
}[] = [
  { value: '1:1', label: '1:1', aspectW: 1, aspectH: 1 },
  { value: '4:5', label: '4:5', aspectW: 4, aspectH: 5 },
  { value: '9:16', label: '9:16', aspectW: 9, aspectH: 16 },
  { value: '16:9', label: '16:9', aspectW: 16, aspectH: 9 },
];
