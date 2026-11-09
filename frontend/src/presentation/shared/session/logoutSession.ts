import { SessionExpired } from '../../../domain/repositories/ProfileRepository'

type LogoutSession = {
  logout: () => Promise<unknown>
  clearSession: () => void
  navigate: (path: string) => void
  notify: (message: string) => void
  guard: { confirmBeforeAction: () => boolean; allowNextNavigation: () => void } | null
}

export async function logoutSession({ logout, clearSession, navigate, notify, guard }: LogoutSession) {
  if (guard && !guard.confirmBeforeAction()) return false
  try {
    await logout()
    guard?.allowNextNavigation()
    clearSession()
    navigate('/')
    notify('로그아웃했어요')
    return true
  } catch (error) {
    if (error instanceof SessionExpired) {
      guard?.allowNextNavigation()
      clearSession()
      navigate('/login')
      notify('세션이 만료됐어요. 다시 로그인해 주세요.')
      return true
    }
    notify('로그아웃하지 못했어요. 다시 시도해 주세요.')
    return false
  }
}
