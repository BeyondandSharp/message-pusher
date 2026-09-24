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
    // 默认切分会把 node_modules 里的依赖和应用代码混成两个 600+ kB 的大 chunk，
    // Vite 因此告警。这里按库拆开：每个 chunk 都在 500 kB 以下，浏览器可并行下载，
    // 而且依赖变动频率远低于业务代码，升级依赖时业务 chunk 的缓存依然有效。
    rolldownOptions: {
      output: {
        // 注意：rolldown 里这个选项的新名字是 codeSplitting，
        // 旧的 advancedChunks 会打印 “option is deprecated” 警告。
        codeSplitting: {
          groups: [
            {
              name: 'react',
              test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/,
            },
            {
              name: 'antd-icons',
              test: /[\\/]node_modules[\\/]@ant-design[\\/]/,
            },
            // antd 本体压缩后有 700+ kB，按最重的组件族再拆一层，
            // 让每个 chunk 都落在 Vite 的 500 kB 告警阈值以下。
            {
              name: 'rc-table',
              test: /[\\/]node_modules[\\/]@rc-component[\\/]table[\\/]/,
            },
            {
              name: 'antd-table',
              test: /[\\/]node_modules[\\/]antd[\\/](es|lib)[\\/]table[\\/]/,
            },
            {
              name: 'antd-form',
              test: /[\\/]node_modules[\\/](antd[\\/](es|lib)[\\/](form|input|select|checkbox|radio|switch|input-number)|@rc-component[\\/](form|input|select|checkbox|radio|switch|input-number))[\\/]/,
            },
            {
              name: 'antd',
              test: /[\\/]node_modules[\\/](antd|@rc-component|rc-[a-z-]+)[\\/]/,
            },
            { name: 'vendor', test: /[\\/]node_modules[\\/]/ },
          ],
        },
      },
    },
  },
  server: {
    // 对应原来 CRA 的 proxy 字段：开发时把接口请求转发到本地 Go 服务
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
}));
