import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Docker Compose에서는 브라우저가 /api를 Vite 개발 서버로 보내고,
// Vite는 콘텐츠 경로는 Content로, 신고·회원·관리자·이벤트 운영 경로는 Operations로, 나머지(인증·CSRF·상태 확인)는 Core로 전달한다.
// 네이티브 기본 대상은 Core localhost:8080 / Content localhost:8081 / Operations localhost:8082이다.
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
        // 운영 공개 API는 신고·회원·관리자 경로와 이벤트 관리자·공개 경로(admin/events·public/events)만 Operations로 보낸다(서비스 토큰용 공지·이벤트·문의 경로는 비노출).
        '^/api/v1/operations/(?:reports|members|admins|admin/events|public/events)(?:/|\\?|$)': {
          target: env.VITE_OPERATIONS_DEV_PROXY_TARGET || 'http://localhost:8082',
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
