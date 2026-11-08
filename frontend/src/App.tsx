import { Component, lazy, Suspense, type ReactNode } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router'
import { Go } from './presentation/shared/Go'
import { RestoreContext } from './presentation/shared/session/restoreContext'
import { useSessionRestore } from './presentation/shared/session/useSessionRestore'

import { InboxPage } from './presentation/features/inbox/view/InboxPage'
import { NotificationsPage } from './presentation/features/inbox/view/NotificationsPage'
import { ForkedPage } from './presentation/features/fork/view/ForkedPage'
import { ForkPage } from './presentation/features/fork/view/ForkPage'
import { WritingPolicyPage } from './presentation/features/fork/view/WritingPolicyPage'
import { LoginPage } from './presentation/features/auth/view/LoginPage'
import { ResendVerificationPage, Signup } from './presentation/features/auth/view/Signup'
import { RecoveryPage } from './presentation/features/auth/view/RecoveryPage'
import { VerifyEmailChangePage, VerifyEmailPage } from './presentation/features/auth/view/VerifyEmailPage'
import { HomePage } from './presentation/features/home/view/HomePage'
import { CoreApiConnectionStatus } from './presentation/shared/core-api-status/CoreApiConnectionStatus'
import { RequireRole } from './presentation/shared/session/RequireRole'
import { GlobalChrome } from './presentation/shared/shell/GlobalChrome'
import { PolicySheet } from './presentation/shared/shell/PolicySheet'
import { QuickJump } from './presentation/shared/shell/QuickJump'

const AdminPage = lazy(() => import('./presentation/features/admin/view/AdminPage').then((m) => ({ default: m.AdminPage })))
const AccountPage = lazy(() => import('./presentation/features/account/view/AccountPage').then((m) => ({ default: m.AccountPage })))
const ChatPage = lazy(() => import('./presentation/features/chat/view/ChatPages').then((m) => ({ default: m.ChatPage })))
const EpisodePage = lazy(() => import('./presentation/features/content/view/EpisodePage').then((m) => ({ default: m.EpisodePage })))
const ImportPage = lazy(() => import('./presentation/features/library/view/ImportPage').then((m) => ({ default: m.ImportPage })))
const LibraryPage = lazy(() => import('./presentation/features/library/view/LibraryPage').then((m) => ({ default: m.LibraryPage })))
const NewWorkPage = lazy(() => import('./presentation/features/library/view/NewWorkPage').then((m) => ({ default: m.NewWorkPage })))

const StudioPage = lazy(() => import('./presentation/features/studio/view/StudioPage').then((m) => ({ default: m.StudioPage })))
const WorldStudioPage = lazy(() => import('./presentation/features/worldstudio/view/WorldStudioPage').then((m) => ({ default: m.WorldStudioPage })))
const ReaderPage = lazy(() => import('./presentation/features/reading/view/ReaderPage').then((m) => ({ default: m.ReaderPage })))
const WorkPage = lazy(() => import('./presentation/features/reading/view/WorkPage').then((m) => ({ default: m.WorkPage })))
const IfsPage = lazy(() => import('./presentation/features/reading/view/ExplorePages').then((m) => ({ default: m.IfsPage })))
const RankPage = lazy(() => import('./presentation/features/reading/view/ExplorePages').then((m) => ({ default: m.RankPage })))
const SearchPage = lazy(() => import('./presentation/features/reading/view/ExplorePages').then((m) => ({ default: m.SearchPage })))
const TagPage = lazy(() => import('./presentation/features/reading/view/ExplorePages').then((m) => ({ default: m.TagPage })))

class RouteErrorBoundary extends Component<{ pathname: string; children: ReactNode }> {
  state = { failed: false, pathname: this.props.pathname }

  static getDerivedStateFromProps({ pathname }: { pathname: string }, state: { pathname: string }) {
    return pathname !== state.pathname ? { failed: false, pathname } : null
  }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    return this.state.failed ? <main className="wrap"><p role="alert">화면을 불러오지 못했어요. 홈으로 돌아가거나 페이지를 새로고침해 주세요.</p><Go to="/" className="btn">홈으로</Go></main> : this.props.children
  }
}

function StartPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-8 px-4 py-12 sm:px-8">
      <header>
        <p className="mb-4 text-sm font-semibold text-brand-primary">개발 기반 / 기능 준비 중</p>
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">STORYFORK</h1>
        <p className="mt-4 text-2xl font-semibold">원작을 나만의 이야기로.</p>
        <p className="mt-4 max-w-xl leading-relaxed">
          AI와 함께 이야기를 쓰고, 이용이 허용된 원작에서 새로운 전개를 만드는
          독자 참여형 스토리 창작·피드백 플랫폼을 준비하고 있습니다.
        </p>
      </header>
      <section aria-labelledby="connection-title" className="rounded-2xl bg-brand-accent/30 p-6">
        <h2 id="connection-title" className="mb-5 text-lg font-semibold">서비스 연결 상태</h2>
        <div className="space-y-5">
          <CoreApiConnectionStatus />
          <CoreApiConnectionStatus target="ai-service" />
        </div>
        <p className="mt-6 text-sm leading-relaxed">
          연결 확인은 서버 실행 상태만 확인합니다. OpenAI 인증이나 모델 호출을 검증하지 않습니다.
        </p>
      </section>
      <p className="text-sm leading-relaxed">
        현재 제공하는 기능은 서비스 연결 확인뿐입니다. 작품·세계관 관리, Fork 창작,
        집필·피드백 기능은 아직 구현되지 않았습니다.
      </p>
    </main>
  )
}

function App() {
  const { pathname } = useLocation()
  const { restoring, restoreError } = useSessionRestore()
  return (
    <RestoreContext.Provider value={restoring}>
      {restoreError === 'lock' && <p role="alert">브라우저에서 인증을 안전하게 처리할 수 없어요. 브라우저 설정을 확인하거나 다른 브라우저를 사용해 주세요.</p>}
      {restoreError === 'connection' && <p role="alert">서버 연결에 실패했어요. 잠시 후 다시 시도해 주세요.</p>}
      <RouteErrorBoundary pathname={pathname}>
        <Suspense fallback={<main className="wrap"><p role="status">화면을 불러오고 있어요.</p></main>}>
          <Routes>
            <Route path="/content" element={restoring ? <p role="status">로그인 상태를 확인하고 있어요.</p> : <EpisodePage />} />
            <Route path="/status" element={<StartPage />} />
            <Route path="/" element={<HomePage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/me/signup" element={<Signup />} />
            <Route path="/auth/resend-verification" element={<ResendVerificationPage />} />
            <Route path="/auth/forgot-password" element={<RecoveryPage />} />
            <Route path="/auth/reset-password" element={<RecoveryPage reset />} />
            <Route path="/auth/verify-email" element={<VerifyEmailPage />} />
            <Route path="/auth/verify-email-change" element={<VerifyEmailChangePage />} />
            <Route path="/work/:id" element={<WorkPage />} />
            <Route path="/read/:id/:n" element={<RequireRole><ReaderPage /></RequireRole>} />
            <Route path="/read/:id" element={<RequireRole><ReaderPage /></RequireRole>} />
            <Route path="/search" element={<SearchPage />} />
            <Route path="/rank" element={<RankPage />} />
            <Route path="/ifs" element={<IfsPage />} />
            <Route path="/tag/:tag?" element={<TagPage />} />
            <Route path="/writing-policy" element={<RequireRole><WritingPolicyPage /></RequireRole>} />
            <Route path="/fork/:id" element={<RequireRole><ForkPage /></RequireRole>} />
            <Route path="/forked/:id" element={<RequireRole><ForkedPage /></RequireRole>} />
            <Route path="/lib" element={<RequireRole><LibraryPage /></RequireRole>} />
            <Route path="/write" element={<RequireRole><Navigate replace to="/lib?tab=write" /></RequireRole>} />
            <Route path="/new" element={<RequireRole><NewWorkPage /></RequireRole>} />
            <Route path="/worlds" element={<Navigate replace to="/new" />} />
            <Route path="/worldstudio/:worldId?" element={<RequireRole><WorldStudioPage /></RequireRole>} />
            <Route path="/import" element={<RequireRole><ImportPage /></RequireRole>} />
            <Route path="/studio/:id" element={restoring ? <p role="status">로그인 상태를 확인하고 있어요.</p> : <StudioPage />} />
            <Route path="/inbox" element={<RequireRole><InboxPage /></RequireRole>} />
            <Route path="/notifications" element={<RequireRole><NotificationsPage /></RequireRole>} />
            <Route path="/chat/:wid?/:cn?" element={<RequireRole><ChatPage /></RequireRole>} />
            <Route path="/admin" element={<RequireRole admin><AdminPage /></RequireRole>} />
            <Route path="/me/:sub?" element={<AccountPage />} />
            <Route path="*" element={<Navigate replace to="/" />} />
          </Routes>
        </Suspense>
      </RouteErrorBoundary>
      {pathname !== '/status' && pathname !== '/content' && <><GlobalChrome /><QuickJump /><PolicySheet /></>}
    </RestoreContext.Provider>
  )
}

export default App
