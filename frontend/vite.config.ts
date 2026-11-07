import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Docker Compose에서는 브라우저가 /api를 Vite 개발 서버로 보내고,
// Vite는 콘텐츠 경로만 Content로, 인증·CSRF·상태 확인은 Core로 전달한다.
// 네이티브 기본 대상은 Core localhost:8080 / Content localhost:8081이다.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const usePolling = env.CHOKIDAR_USEPOLLING === 'true'

  return {
    plugins: [react(), tailwindcss()],
    // 발표용 목업(`--mode mockup`): 상대 경로·단일 JS/CSS로 묶고 scripts/inline-mockup.mjs가 한 HTML로 합칩니다.
    ...(mode === 'mockup' && {
      base: './',
      build: {
        outDir: 'dist/mockup',
        assetsInlineLimit: Number.MAX_SAFE_INTEGER,
        cssCodeSplit: false,
        rolldownOptions: { output: { codeSplitting: false } },
      },
    }),
    server: {
      host: env.VITE_DEV_SERVER_HOST || 'localhost',
      port: 5173,
      strictPort: true,
      watch: usePolling ? { usePolling: true, interval: 300 } : undefined,
      proxy: {
        '^/api/v1/(?:(?:public/)?works|world-studios)(?:/|\\?|$)': {
          target: env.VITE_CONTENT_DEV_PROXY_TARGET || 'http://localhost:8081',
          changeOrigin: true,
        },
        '/api': {
          target: env.VITE_DEV_PROXY_TARGET || 'http://localhost:8080',
          changeOrigin: true,
        },
      },
    },
  }
})
