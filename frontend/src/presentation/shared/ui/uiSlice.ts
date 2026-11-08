import { createSlice, type PayloadAction } from '@reduxjs/toolkit'

export type Look = 'auto' | 'world' | 'ivory' | 'white' | 'night'

/** 화면 사이에서 유지하는 표시·읽기·홈 상태. 로그인 여부와 무관하며 영속 저장하지 않습니다. */
export type UiState = {
  theme: 'light' | 'dark' | null
  showSid: boolean
  /** 페이지 화면 ID와 그 위에 열린 시트의 화면 ID */
  screen: { base: string; sheet: string | null }
  chip: string
  /** 홈 캐러셀 위치 (목업 S.hero) */
  hero: number
  /** 회차 뷰어 보기 설정 (목업 S.look·S.fs·S.motion)과 상세 회차 정렬 (S.epSort) */
  look: Look
  fs: number
  motion: boolean
  epSort: 'old' | 'new'
  guide: boolean
  firstHome: boolean
}

export const initialUi: UiState = {
  theme: null,
  showSid: true,
  screen: { base: 'U01', sheet: null },
  chip: '추천',
  hero: 0,
  look: 'auto',
  fs: 19,
  motion: true,
  epSort: 'old',
  guide: true,
  firstHome: true,
}

export const uiSlice = createSlice({
  name: 'ui',
  initialState: initialUi,
  reducers: {
    setTheme: (s, a: PayloadAction<'light' | 'dark'>) => {
      s.theme = a.payload
    },
    toggleSid: (s) => {
      s.showSid = !s.showSid
    },
    setBaseScreen: (s, a: PayloadAction<string>) => {
      s.screen.base = a.payload
    },
    setSheetScreen: (s, a: PayloadAction<string | null>) => {
      s.screen.sheet = a.payload
    },
    setLook: (s, a: PayloadAction<Look>) => {
      s.look = a.payload
    },
    changeFs: (s, a: PayloadAction<number>) => {
      s.fs = Math.max(15, Math.min(24, s.fs + a.payload))
    },
    setMotion: (s, a: PayloadAction<boolean>) => {
      s.motion = a.payload
    },
    setEpSort: (s, a: PayloadAction<'old' | 'new'>) => {
      s.epSort = a.payload
    },
    setChip: (s, a: PayloadAction<string>) => {
      s.chip = a.payload
    },
    setHero: (s, a: PayloadAction<number>) => {
      s.hero = a.payload
    },
    stepHero: (s, a: PayloadAction<number>) => {
      s.hero += a.payload
    },
    closeGuide: (s) => {
      s.guide = false
    },
    homeVisited: (s) => {
      s.firstHome = false
    },
  },
})

export const uiActions = uiSlice.actions
