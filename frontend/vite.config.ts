import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// 开发期把 /api 代理到本机后端，和生产环境 nginx 的行为保持一致：前端代码里永远只写相对路径
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: process.env.VITE_BACKEND_URL ?? "http://127.0.0.1:8090", changeOrigin: true },
    },
  },
  build: {
    chunkSizeWarningLimit: 900,
  },
});
