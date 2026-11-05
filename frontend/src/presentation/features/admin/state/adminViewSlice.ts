import { createSlice, type PayloadAction } from '@reduxjs/toolkit'

/** 화면을 떠났다 돌아와도 남는 관리자 보기 상태 (목업 S.admin.sel·filters·chatForm) */
export type AdminFilter = { category: string; sort: string; query: string; search: string }
export type AdminChatForm = { kind: string; workId: string; character: string }

type AdminViewState = { sel: string | null; filters: Record<string, AdminFilter>; chatForm: AdminChatForm }

const initialState: AdminViewState = { sel: null, filters: {}, chatForm: { kind: 'fork', workId: '', character: '' } }

export const adminViewSlice = createSlice({
  name: 'adminView',
  initialState,
  reducers: {
    select: (s, a: PayloadAction<string>) => { s.sel = a.payload },
    setFilter: (s, a: PayloadAction<{ tab: string; filter: AdminFilter }>) => { s.filters[a.payload.tab] = a.payload.filter },
    setChatForm: (s, a: PayloadAction<AdminChatForm>) => { s.chatForm = a.payload },
  },
})

export const adminViewActions = adminViewSlice.actions
