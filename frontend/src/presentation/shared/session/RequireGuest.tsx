import { useContext, useState, type ReactNode } from 'react'
import { Navigate } from 'react-router'

import { useAppSelector } from '../../../app/store'
import { RestoreContext } from './restoreContext'

/**
 * 로그인·가입처럼 로그아웃 상태에서 쓰는 화면. 이미 로그인한 채 들어오면 메인으로 보낸다.
 * - 세션 복원이 끝나기 전에는 Store 값을 믿지 않고 화면을 그대로 둔다.
 * - 판단은 복원이 끝난 뒤 들어온 순간 한 번뿐이다. 이 화면에서 방금 한 로그인은 useLoginViewModel이 돌아갈 경로(next)로 보내므로 메인으로 가로채지 않는다.
 * - 보호 화면이 다시 로그인을 요구해 보냈으면(next가 있음: 세션 만료·관리자 계정 요구) 로그인한 채여도 폼을 보인다.
 */
export function RequireGuest({ children }: { children: ReactNode }) {
  const restoring = useContext(RestoreContext)
  const signedIn = useAppSelector((s) => !!s.session.role && s.session.next === null)
  const [enteredSignedIn, setEnteredSignedIn] = useState<boolean | null>(null)
  if (enteredSignedIn === null && !restoring) setEnteredSignedIn(signedIn)
  return enteredSignedIn ? <Navigate replace to="/" /> : children
}
