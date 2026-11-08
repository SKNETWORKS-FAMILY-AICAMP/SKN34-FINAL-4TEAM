import { createSlice, type PayloadAction } from '@reduxjs/toolkit'

import type { Role } from '../../../domain/entities/work'
import type { StreamState } from '../../../domain/entities/notificationStream'
import type { AuthUser } from '../../../domain/repositories/AuthRepository'

/** 인증·로그인 안내와 기존 조회 무효화 신호. 표시 상태는 uiSlice, 업무 데이터는 Repository가 소유합니다. */
export type SessionState = {
  role: Role
  user: { nick: string; email: string; joined: string }
  /** Core 회원 ID. 신고자·작품 소유자 표시 판단에만 쓰며 권한 검사는 서버가 합니다. */
  memberId: string | null
  /** 로그인 후 돌아갈 경로와 로그인 화면 안내 (목업 S.next·S.loginMsg) */
  next: string | null
  loginMsg: string
  /** 로그인 화면에서 고른 데모 종류 (목업 LOGIN_ROLE) */
  loginRole: 'user' | 'admin'
  /** ponytail: 데모의 전역 재조회 신호를 유지합니다. 실제 조회 범위를 분리할 때 기능별 무효화로 좁힙니다. */
  dataVersion: number
  /** 알림 변경 신호(SSE)를 받을 때마다 올라갑니다. 알림 배지·목록이 이 값으로 다시 조회합니다. */
  noticeVersion: number
  noticeStream: StreamState
}

export const initialSession: SessionState = {
  role: null,
  user: { nick: '읽는사람', email: 'reader@storyfork.demo', joined: '2026.10.20' },
  memberId: null,
  next: null,
  loginMsg: '',
  loginRole: 'user',
  dataVersion: 0,
  noticeVersion: 0,
  noticeStream: 'off',
}

export const sessionSlice = createSlice({
  name: 'session',
  initialState: initialSession,
  reducers: {
    requireLogin: (s, a: PayloadAction<{ next: string; msg: string; role: 'user' | 'admin' }>) => {
      s.next = a.payload.next
      s.loginMsg = a.payload.msg
      s.loginRole = a.payload.role
    },
    setLoginRole: (s, a: PayloadAction<'user' | 'admin'>) => { s.loginRole = a.payload },
    login: (s, a: PayloadAction<AuthUser>) => {
      s.role = a.payload.operator ? 'admin' : 'user'
      s.user = { nick: a.payload.nickname, email: a.payload.email, joined: '' }
      s.memberId = a.payload.id
      s.loginMsg = ''
      s.next = null
    },
    /** 목업 saveProfile: 데모 계정의 닉네임·이메일 */
    setUser: (s, a: PayloadAction<Partial<SessionState['user']>>) => { Object.assign(s.user, a.payload) },
    logout: (s) => {
      s.role = null
      s.user = { ...initialSession.user }
      s.memberId = null
      s.loginRole = 'user'
      s.next = null
    },
    dataChanged: (s) => { s.dataVersion += 1 },
    noticeSignal: (s) => { s.noticeVersion += 1 },
    noticeStreamState: (s, a: PayloadAction<StreamState>) => { s.noticeStream = a.payload },
  },
})

export const sessionActions = sessionSlice.actions
