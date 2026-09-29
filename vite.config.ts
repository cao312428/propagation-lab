import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Vite 构建配置 + Vitest 测试配置（共用同一份文件）
export default defineConfig({
  plugins: [react()],
  test: {
    // 本阶段的测试为纯函数几何计算，使用 Node 环境即可
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
