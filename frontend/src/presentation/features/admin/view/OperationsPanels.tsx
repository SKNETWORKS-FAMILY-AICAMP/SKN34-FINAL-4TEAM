import { useRef } from 'react'

import { toKoreanDateTimeInput, type OperationsReply } from '../../../../domain/entities/operations'
import type { AdminActionState, useAdminViewModel } from '../viewmodel/useAdminViewModel'
import { useAdminDetailFocus } from './useAdminDetailFocus'
import './admin-operations.css'

type VM = ReturnType<typeof useAdminViewModel>
const koreanTime = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'short', timeStyle: 'short' })
const dateLabel = (value: string) => koreanTime.format(new Date(value))

export function AdminActionStatus({ state }: { state?: AdminActionState }) {
  return <>
    {state?.pending && <p className="admin-note" role="status">요청을 처리하고 있어요. 중복으로 보내지 마세요.</p>}
    {state?.error && <p className="admin-action-error" role="alert">{state.error}</p>}
    {state?.message && <p className="admin-note" role="status">{state.message}</p>}
  </>
}

const DraftNote = () => <p className="admin-note">초안과 선택은 탭·목록 이동 후에도 유지돼요. 브라우저를 새로고침하면 데모 기록과 초안이 사라져요.</p>
const BoundaryNote = () => <p className="admin-note">독립 운영 메모리 데모예요. 실제 API·서버 저장·발행·알림·권한·버전 충돌 처리는 연결되지 않았어요. 기존 회원 화면용 데모와도 별개예요.</p>

export function OperationsNotices({ vm }: { vm: VM }) {
  const selection = vm.recordSelection.notices
  const rows = vm.data?.operations.notices ?? []
  const row = rows.find((item) => item.id === selection)
  const root = useAdminDetailFocus(selection, !!row, rows.length)
  const key = selection ?? 'new'
  const form = vm.noticeDrafts[key] ?? { title: row?.title ?? '', body: row?.body ?? '' }
  const state = vm.actions[`notice:${key}`]
  const blocked = vm.mutationsBlocked || !!state?.pending
  return <section className="panel admin-operations" aria-label="운영 공지" ref={root}>
    {!selection ? <>
      <div className="table-head"><h2 tabIndex={-1}>운영 공지 목록</h2><button type="button" className="btn pri" data-record-id="new" onClick={() => vm.selectRecord('notices', 'new')}>공지 작성</button></div>
      {rows.length ? <ul className="admin-record-list">{rows.map((item) => <li key={item.id}><button type="button" className="admin-record-link" data-record-id={item.id} onClick={() => vm.selectRecord('notices', item.id)}><b>{item.title}</b><span className="small muted">{dateLabel(item.createdAt)} · 상세 보기{vm.noticeDrafts[item.id] ? ' · 수정 초안 있음' : ''}</span></button></li>)}</ul> : <p className="admin-empty">등록된 운영 공지가 없어요. 공지를 작성해 보세요.</p>}
    </> : <>
      <button type="button" className="btn sm" onClick={() => vm.selectRecord('notices', null)}>공지 목록으로</button>
      <h2 tabIndex={-1}>{selection === 'new' ? '새 운영 공지' : row?.title ?? '공지 확인'}</h2>
      {selection !== 'new' && !row ? <p role="alert">공지를 표시할 수 없어요. 목록 새로고침 후 다시 선택해 주세요.</p> : <>
        {row && <><p className="small muted">등록 {dateLabel(row.createdAt)} · 수정 {dateLabel(row.updatedAt)}</p><p className="admin-prose">{row.body}</p><h3>공지 수정</h3></>}
        <form onSubmit={(event) => { event.preventDefault(); void vm.saveNotice(row?.id ?? null, form) }}>
          <fieldset disabled={blocked} className="form-grid">
            <label className="field wide">공지 제목<input className="inp" required maxLength={200} value={form.title} onChange={(e) => vm.setNoticeDraft(key, { ...form, title: e.target.value })} /></label>
            <label className="field wide">공지 내용<textarea className="ta" required maxLength={20000} rows={8} value={form.body} onChange={(e) => vm.setNoticeDraft(key, { ...form, body: e.target.value })} /></label>
            <div className="rowend wide"><button type="submit" className="btn pri">{state?.pending ? '저장 중…' : '공지 저장'}</button>{row && <button type="button" className="btn" onClick={() => { if (window.confirm('이 운영 데모 공지를 삭제할까요? 삭제 후 복구할 수 없어요.')) void vm.deleteNotice(row.id) }}>공지 삭제</button>}</div>
          </fieldset>
          <AdminActionStatus state={state} />
        </form>
      </>}
    </>}
    <DraftNote /><BoundaryNote />
  </section>
}

export function OperationsEvents({ vm }: { vm: VM }) {
  const selection = vm.recordSelection.events
  const rows = vm.data?.operations.events ?? []
  const row = rows.find((item) => item.id === selection)
  const root = useAdminDetailFocus(selection, !!row, rows.length)
  const key = selection ?? 'new'
  const form = vm.eventDrafts[key] ?? { title: row?.title ?? '', body: row?.body ?? '', startsAt: toKoreanDateTimeInput(row?.startsAt ?? null), endsAt: toKoreanDateTimeInput(row?.endsAt ?? null) }
  const state = vm.actions[`event:${key}`]
  const blocked = vm.mutationsBlocked || !!state?.pending
  return <section className="panel admin-operations" aria-label="운영 이벤트" ref={root}>
    {!selection ? <>
      <div className="table-head"><h2 tabIndex={-1}>운영 이벤트 목록</h2><button type="button" className="btn pri" data-record-id="new" onClick={() => vm.selectRecord('events', 'new')}>이벤트 작성</button></div>
      {rows.length ? <ul className="admin-record-list">{rows.map((item) => <li key={item.id}><button type="button" className="admin-record-link" data-record-id={item.id} onClick={() => vm.selectRecord('events', item.id)}><b>{item.title}</b><span className="small muted">{item.startsAt ? dateLabel(item.startsAt) : '시작 미정'} ~ {item.endsAt ? dateLabel(item.endsAt) : '종료 미정'} · 한국시간{vm.eventDrafts[item.id] ? ' · 수정 초안 있음' : ''}</span></button></li>)}</ul> : <p className="admin-empty">등록된 운영 이벤트가 없어요. 이벤트를 작성해 보세요.</p>}
    </> : <>
      <button type="button" className="btn sm" onClick={() => vm.selectRecord('events', null)}>이벤트 목록으로</button>
      <h2 tabIndex={-1}>{selection === 'new' ? '새 운영 이벤트' : row?.title ?? '이벤트 확인'}</h2>
      {selection !== 'new' && !row ? <p role="alert">이벤트를 표시할 수 없어요. 목록 새로고침 후 다시 선택해 주세요.</p> : <>
        {row && <><p className="small muted">{row.startsAt ? dateLabel(row.startsAt) : '시작 미정'} ~ {row.endsAt ? dateLabel(row.endsAt) : '종료 미정'} · 한국시간</p><p className="small muted">UTC: {row.startsAt ?? '시작 미정'} / {row.endsAt ?? '종료 미정'}</p><p className="admin-prose">{row.body}</p><h3>이벤트 수정</h3></>}
        <form onSubmit={(event) => { event.preventDefault(); void vm.saveEvent(row?.id ?? null, form) }}>
          <fieldset disabled={blocked} className="form-grid">
            <label className="field wide">이벤트 제목<input className="inp" required maxLength={200} value={form.title} onChange={(e) => vm.setEventDraft(key, { ...form, title: e.target.value })} /></label>
            <label className="field wide">이벤트 내용<textarea className="ta" required maxLength={20000} rows={8} value={form.body} onChange={(e) => vm.setEventDraft(key, { ...form, body: e.target.value })} /></label>
            <label className="field">시작 (한국시간)<input className="inp" type="datetime-local" step={60} value={form.startsAt} aria-describedby="event-time-help" onChange={(e) => vm.setEventDraft(key, { ...form, startsAt: e.target.value })} /></label>
            <label className="field">종료 (한국시간)<input className="inp" type="datetime-local" step={60} value={form.endsAt} aria-describedby="event-time-help" onChange={(e) => vm.setEventDraft(key, { ...form, endsAt: e.target.value })} /></label>
            <p id="event-time-help" className="small muted wide">두 기간은 선택 사항이에요. 한국시간(UTC+09:00)으로 입력하면 UTC로 저장해요. 비우면 해당 기간은 미정이며, 종료는 시작보다 빠를 수 없어요.</p>
            <div className="rowend wide"><button type="submit" className="btn pri">{state?.pending ? '저장 중…' : '이벤트 저장'}</button>{row && <button type="button" className="btn" onClick={() => { if (window.confirm('이 운영 데모 이벤트를 삭제할까요? 삭제 후 복구할 수 없어요.')) void vm.deleteEvent(row.id) }}>이벤트 삭제</button>}</div>
          </fieldset>
          <AdminActionStatus state={state} />
        </form>
      </>}
    </>}
    <p className="admin-note">이 운영 경로는 안내 기록만 관리해요. 임의 기간 문구·진행 상태 토글·참여·보상은 지원하지 않아요.</p>
    <DraftNote /><BoundaryNote />
  </section>
}

export function OperationsInquiries({ vm }: { vm: VM }) {
  const selection = vm.recordSelection.inquiries
  const rows = vm.data?.operations.inquiries ?? []
  const row = rows.find((item) => item.id === selection)
  const root = useAdminDetailFocus(selection, !!row, rows.length)
  const replyHeading = useRef<HTMLHeadingElement>(null)
  const key = selection ?? 'new'
  const form = vm.inquiryDrafts[key] ?? { title: row?.title ?? '', body: row?.body ?? '', category: row?.category ?? '' }
  const state = vm.actions[`inquiry:${key}`]
  const blocked = vm.mutationsBlocked || !!state?.pending
  const answer = row ? vm.replyDrafts[`${row.id}:new`] ?? '' : ''
  const answerState = row ? vm.actions[`reply:${row.id}:new`] : undefined
  return <section className="panel admin-operations" aria-label="운영 문의 기록" ref={root}>
    {!selection ? <>
      <div className="table-head"><h2 tabIndex={-1}>운영 문의 기록 목록</h2><button type="button" className="btn pri" data-record-id="new" onClick={() => vm.selectRecord('inquiries', 'new')}>문의 기록 추가</button></div>
      {rows.length ? <ul className="admin-record-list">{rows.map((item) => <li key={item.id}><button type="button" className="admin-record-link" data-record-id={item.id} onClick={() => vm.selectRecord('inquiries', item.id)}><b>[{item.category}] {item.title}</b><span className="small muted">{item.replies.length ? `답변 ${item.replies.length}개` : '답변 없음'} · {dateLabel(item.createdAt)}{vm.inquiryDrafts[item.id] ? ' · 수정 초안 있음' : ''}</span></button></li>)}</ul> : <p className="admin-empty">등록된 운영 문의 기록이 없어요. 문의 기록을 추가해 보세요.</p>}
    </> : <>
      <button type="button" className="btn sm" onClick={() => vm.selectRecord('inquiries', null)}>문의 목록으로</button>
      <h2 tabIndex={-1}>{selection === 'new' ? '새 운영 문의 기록' : row?.title ?? '문의 확인'}</h2>
      {selection !== 'new' && !row ? <p role="alert">문의를 표시할 수 없어요. 목록 새로고침 후 다시 선택해 주세요.</p> : <>
        {row && <><p className="small muted">분류: {row.category} · {row.replies.length ? `답변 ${row.replies.length}개` : '답변 없음'} · {dateLabel(row.createdAt)}</p><p className="admin-prose">{row.body}</p><h3>문의 기록 수정</h3></>}
        <form onSubmit={(event) => { event.preventDefault(); void vm.saveInquiry(row?.id ?? null, form) }}>
          <fieldset disabled={blocked} className="form-grid">
            <label className="field wide">문의 분류<input className="inp" required maxLength={50} value={form.category} onChange={(e) => vm.setInquiryDraft(key, { ...form, category: e.target.value })} /></label>
            <label className="field wide">문의 제목<input className="inp" required maxLength={200} value={form.title} onChange={(e) => vm.setInquiryDraft(key, { ...form, title: e.target.value })} /></label>
            <label className="field wide">문의 내용<textarea className="ta" required maxLength={20000} rows={8} value={form.body} onChange={(e) => vm.setInquiryDraft(key, { ...form, body: e.target.value })} /></label>
            <div className="rowend wide"><button type="submit" className="btn pri">{state?.pending ? '저장 중…' : '문의 저장'}</button>{row && <button type="button" className="btn" disabled={!!row.replies.length} aria-describedby="inquiry-delete-help" onClick={() => { if (window.confirm('이 운영 문의 기록을 삭제할까요? 삭제 후 복구할 수 없어요.')) void vm.deleteInquiry(row.id) }}>문의 삭제</button>}</div>
          </fieldset>
          {row && <p id="inquiry-delete-help" className="admin-note">답변이 남아 있으면 문의를 삭제할 수 없어요. 답변을 각각 삭제한 뒤 문의를 삭제해 주세요.</p>}
          <AdminActionStatus state={state} />
        </form>
        {row && <section className="admin-replies" aria-label="문의 답변">
          <h3 tabIndex={-1} ref={replyHeading}>답변 기록</h3>
          {row.replies.length ? row.replies.map((reply, index) => <ReplyEditor key={reply.id} reply={reply} index={index} vm={vm} onDeleted={() => replyHeading.current?.focus()} />) : <p className="muted">아직 등록된 답변이 없어요.</p>}
          <h3>새 답변</h3>
          <form onSubmit={(event) => { event.preventDefault(); void vm.saveReply(row.id, null, answer) }}>
            <fieldset disabled={vm.mutationsBlocked || !!answerState?.pending}>
              <label className="field">새 답변 내용<textarea className="ta" required maxLength={20000} rows={5} value={answer} onChange={(e) => vm.setReplyDraft(`${row.id}:new`, e.target.value)} /></label>
              <div className="rowend"><button type="submit" className="btn pri">{answerState?.pending ? '저장 중…' : '답변 추가'}</button></div>
            </fieldset>
            <AdminActionStatus state={answerState} />
          </form>
          <p className="admin-note">각 답변은 이 문의 아래의 독립 기록이에요. 실제 회원 문의 처리 상태나 답변 전송·알림은 변경하지 않아요.</p>
        </section>}
      </>}
    </>}
    <DraftNote /><BoundaryNote />
  </section>
}

function ReplyEditor({ reply, index, vm, onDeleted }: { reply: OperationsReply; index: number; vm: VM; onDeleted: () => void }) {
  const state = vm.actions[`reply:${reply.inquiryId}:${reply.id}`]
  const draft = vm.replyDrafts[`${reply.inquiryId}:${reply.id}`] ?? reply.body
  return <article className="inquiry-item" aria-label={`답변 ${index + 1}`}>
    <h4>답변 {index + 1}</h4><p className="small muted">등록 {dateLabel(reply.createdAt)} · 수정 {dateLabel(reply.updatedAt)}</p><p className="admin-prose">{reply.body}</p>
    <form onSubmit={(event) => { event.preventDefault(); void vm.saveReply(reply.inquiryId, reply.id, draft) }}>
      <fieldset disabled={vm.mutationsBlocked || !!state?.pending}>
        <label className="field">답변 내용<textarea className="ta" required maxLength={20000} rows={4} value={draft} onChange={(e) => vm.setReplyDraft(`${reply.inquiryId}:${reply.id}`, e.target.value)} /></label>
        <div className="rowend"><button type="submit" className="btn sm pri">{state?.pending ? '처리 중…' : '답변 저장'}</button><button type="button" className="btn sm" onClick={async () => { if (window.confirm('이 답변 기록을 삭제할까요? 삭제 후 복구할 수 없어요.') && await vm.deleteReply(reply.inquiryId, reply.id)) onDeleted() }}>답변 삭제</button></div>
      </fieldset>
      <AdminActionStatus state={state} />
    </form>
  </article>
}
