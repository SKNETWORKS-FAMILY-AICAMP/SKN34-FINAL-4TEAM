import { createSlice, type PayloadAction } from '@reduxjs/toolkit'

import type { InquiryInput, NoticeInput } from '../../../../domain/entities/operations'

/** 화면을 떠났다 돌아와도 남는 관리자 보기 상태 (목업 S.admin.sel·filters·chatForm) */
export type AdminFilter = { category: string; sort: string; query: string; search: string }
export type AdminChatForm = { kind: string; workId: string; character: string }
export type OperationsRecordKind = 'notices' | 'events' | 'inquiries'
export type EventDraft = NoticeInput & { startsAt: string; endsAt: string }

type AdminViewState = {
  sel: string | null; filters: Record<string, AdminFilter>; chatForm: AdminChatForm
  recordSelection: Record<OperationsRecordKind, string | null>
  noticeDrafts: Record<string, NoticeInput>; eventDrafts: Record<string, EventDraft>; inquiryDrafts: Record<string, InquiryInput>
  replyDrafts: Record<string, string>
}

const initialState: AdminViewState = {
  sel: null, filters: {}, chatForm: { kind: 'fork', workId: '', character: '' },
  recordSelection: { notices: null, events: null, inquiries: null },
  noticeDrafts: {}, eventDrafts: {}, inquiryDrafts: {}, replyDrafts: {},
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
    setInquiryDraft: (s, a: PayloadAction<{ id: string; value: InquiryInput }>) => { s.inquiryDrafts[a.payload.id] = a.payload.value },
    clearInquiryDraft: (s, a: PayloadAction<string>) => { delete s.inquiryDrafts[a.payload] },
    setReplyDraft: (s, a: PayloadAction<{ id: string; value: string }>) => { s.replyDrafts[a.payload.id] = a.payload.value },
    clearReplyDraft: (s, a: PayloadAction<string>) => { delete s.replyDrafts[a.payload] },
    clearInquiryReplies: (s, a: PayloadAction<string>) => { for (const key of Object.keys(s.replyDrafts)) if (key.startsWith(a.payload + ':')) delete s.replyDrafts[key] },
  },
})

export const adminViewActions = adminViewSlice.actions
