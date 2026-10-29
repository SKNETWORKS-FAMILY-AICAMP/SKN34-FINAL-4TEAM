import { useEffect, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'

import { useAppDispatch, useAppSelector } from '../../../app/store'
import { sessionActions } from './sessionSlice'

const MESSAGES: Record<string, string> = {
  read: '소설을 읽으려면 로그인해 주세요.',
  lib: '내 서재는 로그인 후 볼 수 있어요.',
  chat: '캐릭터 챗은 로그인 후 이용할 수 있어요.',
}

/**
 * 목업 render()의 보호 목록: 로그인하지 않았으면 안내와 돌아갈 경로를 남기고 로그인으로 보냅니다.
 * 데모 화면 가림일 뿐이며 실제 권한 검사는 Core가 맡아야 합니다.
 */
export function RequireRole({ admin = false, children }: { admin?: boolean; children: ReactNode }) {
  const role = useAppSelector((s) => s.session.role)
  const { pathname, search } = useLocation()
  const dispatch = useAppDispatch()
  const allowed = admin ? role === 'admin' : !!role
  useEffect(() => {
    if (allowed) return
    dispatch(sessionActions.requireLogin(admin
      ? { next: '/admin', msg: '관리자 화면은 관리자 계정으로 로그인해야 볼 수 있어요.', role: 'admin' }
      : { next: pathname + search, msg: MESSAGES[pathname.split('/')[1]] ?? '로그인이 필요한 화면이에요.', role: 'user' }))
  }, [allowed, admin, pathname, search, dispatch])
  return allowed ? children : <Navigate replace to="/login" />
}
