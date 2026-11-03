import { useEffect, useState } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router'
import { appContainer } from './app/appContainer'
import { useAppDispatch } from './app/store'
import { sessionActions } from './presentation/shared/session/sessionSlice'
import { RestoreContext } from './presentation/shared/session/restoreContext'
import { LockUnavailable } from './data/api/csrf'

import { AdminPage } from './presentation/features/admin/view/AdminPage'
import { AccountPage } from './presentation/features/account/view/AccountPage'
import { ChatPage } from './presentation/features/chat/view/ChatPages'
import { InboxPage } from './presentation/features/inbox/view/InboxPage'
import { NotificationsPage } from './presentation/features/inbox/view/NotificationsPage'
import { ForkedPage } from './presentation/features/fork/view/ForkedPage'
import { ForkPage } from './presentation/features/fork/view/ForkPage'
import { WritingPolicyPage } from './presentation/features/fork/view/WritingPolicyPage'
import { ImportPage } from './presentation/features/library/view/ImportPage'
import { LibraryPage } from './presentation/features/library/view/LibraryPage'
import { NewWorkPage } from './presentation/features/library/view/NewWorkPage'
import { StudioPage } from './presentation/features/studio/view/StudioPage'
import { LoginPage } from './presentation/features/auth/view/LoginPage'
import { ResendVerificationPage, Signup } from './presentation/features/auth/view/Signup'
import { RecoveryPage } from './presentation/features/auth/view/RecoveryPage'
import { VerifyEmailChangePage, VerifyEmailPage } from './presentation/features/auth/view/VerifyEmailPage'
import { HomePage } from './presentation/features/home/view/HomePage'
import { IfsPage, RankPage, SearchPage, TagPage } from './presentation/features/reading/view/ExplorePages'
import { ReaderPage } from './presentation/features/reading/view/ReaderPage'
import { WorkPage } from './presentation/features/reading/view/WorkPage'
import { CoreApiConnectionStatus } from './presentation/shared/core-api-status/CoreApiConnectionStatus'
import { RequireRole } from './presentation/shared/session/RequireRole'
import { GlobalChrome } from './presentation/shared/shell/GlobalChrome'
import { PolicySheet } from './presentation/shared/shell/PolicySheet'
import { QuickJump } from './presentation/shared/shell/QuickJump'

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
  const dispatch = useAppDispatch()
  const [restoring, setRestoring] = useState(true)
  const [restoreError, setRestoreError] = useState(false)
  useEffect(() => {
    let active = true
    appContainer.resolve('authUseCase').refresh().then((user) => {
      if (active) dispatch(sessionActions.login(user))
    }).catch((error: unknown) => { if (active) { if (error instanceof LockUnavailable) setRestoreError(true); else dispatch(sessionActions.logout()) } }).finally(() => { if (active) setRestoring(false) })
    return () => { active = false }
  }, [dispatch])
  return (
    <RestoreContext.Provider value={restoring}>
      {restoreError && <p role="alert">브라우저에서 인증을 안전하게 처리할 수 없어요. 브라우저 설정을 확인하거나 다른 브라우저를 사용해 주세요.</p>}
      <Routes>
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
        <Route path="/import" element={<RequireRole><ImportPage /></RequireRole>} />
        <Route path="/studio/:id" element={<RequireRole><StudioPage /></RequireRole>} />
        <Route path="/inbox" element={<RequireRole><InboxPage /></RequireRole>} />
        <Route path="/notifications" element={<RequireRole><NotificationsPage /></RequireRole>} />
        <Route path="/chat/:wid?/:cn?" element={<RequireRole><ChatPage /></RequireRole>} />
        <Route path="/admin" element={<RequireRole admin><AdminPage /></RequireRole>} />
        <Route path="/me/:sub?" element={<AccountPage />} />
        <Route path="*" element={<Navigate replace to="/" />} />
      </Routes>
      {pathname !== '/status' && <><GlobalChrome /><QuickJump /><PolicySheet /></>}
    </RestoreContext.Provider>
  )
}

export default App
