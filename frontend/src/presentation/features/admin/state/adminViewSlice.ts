import { createSlice, type PayloadAction } from '@reduxjs/toolkit'

import type { NoticeInput } from '../../../../domain/entities/operations'

/** 화면을 떠났다 돌아와도 남는 관리자 보기 상태 (목업 S.admin.sel·filters·chatForm) */
export type AdminFilter = { category: string; sort: string; query: string; search: string }
export type AdminChatForm = { kind: string; workId: string; character: string }
/** inquiries는 실제 고객지원 문의(67)의 선택 id이고, 공지·이벤트는 메모리 데모의 선택입니다. */
export type OperationsRecordKind = 'notices' | 'events' | 'inquiries'
export type EventDraft = NoticeInput & { startsAt: string; endsAt: string }

type AdminViewState = {
  sel: string | null; filters: Record<string, AdminFilter>; chatForm: AdminChatForm
  recordSelection: Record<OperationsRecordKind, string | null>
  noticeDrafts: Record<string, NoticeInput>; eventDrafts: Record<string, EventDraft>
  legacyDrafts: Record<string, Record<string, string>>
}

const initialState: AdminViewState = {
  sel: null, filters: {}, chatForm: { kind: 'fork', workId: '', character: '' },
  recordSelection: { notices: null, events: null, inquiries: null },
  noticeDrafts: {}, eventDrafts: {}, legacyDrafts: {},
}

export const adminViewSlice = createSlice({
  name: 'adminView', initialState,
  reducers: {
    select: (s, a: PayloadAction<string>) => { s.sel = a.payload },
    setFilter: (s, a: PayloadAction<{ tab: string; filter: AdminFilter }>) => { s.filters[a.payload.tab] = a.payload.filter },
    setChatForm: (s, a: PayloadAction<AdminChatForm>) => { s.chatForm = a.payload },
    selectRecord: (s, a: PayloadAction<{ kind: OperationsRecordKind; id: string | null }>) => { s.recordSelection[a.payload.kind] = a.payload.id },
    setNoticeDraft: (s, a: PayloadAction<{ id: string; value: NoticeInput }>) => { s.noticeDrafts[a.payload.id] = a.payload.value },
    clearNoticeDraft: (s, a: PayloadAction<string>) => { delete s.noticeDrafts[a.payload] },
    setEventDraft: (s, a: PayloadAction<{ id: string; value: EventDraft }>) => { s.eventDrafts[a.payload.id] = a.payload.value },
    clearEventDraft: (s, a: PayloadAction<string>) => { delete s.eventDrafts[a.payload] },
    setLegacyDraft: (s, a: PayloadAction<{ id: string; field: string; value: string }>) => { (s.legacyDrafts[a.payload.id] ??= {})[a.payload.field] = a.payload.value },
    clearLegacyDraft: (s, a: PayloadAction<string>) => { delete s.legacyDrafts[a.payload] },
  },
})

export const adminViewActions = adminViewSlice.actions
