import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 由 CRA（react-scripts）迁移而来，注意两点：
// 1. 产物必须仍然输出到 build/，因为 main.go 里有 //go:embed web/build；
//    静态资源路径是相对的，router/web-router.go 用 static.Serve("/", web/build) 托管，不受影响。
// 2. semantic-ui-react 等依赖里存在 process.env.NODE_ENV，Vite 不会自动注入，需要显式 define。
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  define: {
    'process.env.NODE_ENV': JSON.stringify(mode),
  },
  build: {
    outDir: 'build',
    emptyOutDir: true,
    // Vite 默认用 lightningcss 压缩 CSS，它会拒绝 semantic-ui-css 里
    // `[data-tooltip]:after .header` 这类“伪元素后接后代选择器”的写法（浏览器能容忍、esbuild 也能）；
    // 换回 esbuild 压缩，与原来 CRA 的行为一致。
    cssMinify: 'esbuild',
  },
  server: {
    // 对应原来 CRA 的 proxy 字段：开发时把接口请求转发到本地 Go 服务
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
}));
