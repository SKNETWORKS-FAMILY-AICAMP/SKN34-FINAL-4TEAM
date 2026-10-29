import { createSlice, type PayloadAction } from '@reduxjs/toolkit'

import type { Role } from '../../../domain/entities/work'

/** 화면 사이에서 유지하는 세션·보기 상태 (목업 S의 화면 상태 부분). 업무 데이터는 Repository에 둡니다. */
export type SessionState = {
  role: Role
  user: { nick: string; email: string; joined: string }
  /** 로그인 후 돌아갈 경로와 로그인 화면 안내 (목업 S.next·S.loginMsg) */
  next: string | null
  loginMsg: string
  /** 로그인 화면에서 고른 데모 종류 (목업 LOGIN_ROLE) */
  loginRole: 'user' | 'admin'
  theme: 'light' | 'dark' | null
  showSid: boolean
  /** 페이지 화면 ID와 그 위에 열린 시트의 화면 ID */
  screen: { base: string; sheet: string | null }
  chip: string
  guide: boolean
  firstHome: boolean
  /** Repository 데이터가 바뀔 때마다 올려 화면 조회를 다시 실행합니다 (목업의 render() 재호출). */
  dataVersion: number
}

export const initialSession: SessionState = {
  role: null,
  user: { nick: '읽는사람', email: 'reader@storyfork.demo', joined: '2026.10.20' },
  next: null,
  loginMsg: '',
  loginRole: 'user',
  theme: null,
  showSid: true,
  screen: { base: 'U01', sheet: null },
  chip: '추천',
  guide: true,
  firstHome: true,
  dataVersion: 0,
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
    login: (s, a: PayloadAction<{ email?: string }>) => {
      s.role = s.loginRole
      if (s.loginRole === 'user' && a.payload.email) s.user.email = a.payload.email
      s.loginMsg = ''
      s.next = null
    },
    logout: (s) => {
      s.role = null
      s.loginRole = 'user'
      s.next = null
    },
    setTheme: (s, a: PayloadAction<'light' | 'dark'>) => { s.theme = a.payload },
    toggleSid: (s) => { s.showSid = !s.showSid },
    setBaseScreen: (s, a: PayloadAction<string>) => { s.screen.base = a.payload },
    setChip: (s, a: PayloadAction<string>) => { s.chip = a.payload },
    closeGuide: (s) => { s.guide = false },
    homeVisited: (s) => { s.firstHome = false },
    dataChanged: (s) => { s.dataVersion += 1 },
  },
})

export const sessionActions = sessionSlice.actions
