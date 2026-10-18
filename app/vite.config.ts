import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 端口与平台约定一致：5173 留给 HR 招聘系统，本应用用 5273
export default defineConfig({
  plugins: [react()],
  server: { port: 5273, strictPort: true },
  clearScreen: false,
  build: { target: 'es2022' },
});
