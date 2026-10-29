import { createSlice, type PayloadAction } from '@reduxjs/toolkit'

import type { Role } from '../../../domain/entities/work'

/** 화면 사이에서 유지하는 세션·보기 상태 (목업 S의 화면 상태 부분). 업무 데이터는 Repository에 둡니다. */
export type SessionState = {
  role: Role
  user: { nick: string; email: string; joined: string }
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
