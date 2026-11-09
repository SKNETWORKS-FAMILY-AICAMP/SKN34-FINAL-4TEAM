import { toKoreanDateTimeInput } from '../../../../domain/entities/operations'
import { kstDateTime } from '../../../shared/format'
import type { AdminActionState, useAdminViewModel } from '../viewmodel/useAdminViewModel'
import { useAdminDetailFocus } from './useAdminDetailFocus'
import './admin-operations.css'

type VM = ReturnType<typeof useAdminViewModel>

export function AdminActionStatus({ state }: { state?: AdminActionState }) {
  return <>
    {state?.pending && <p className="admin-note" role="status">요청을 처리하고 있어요. 중복으로 보내지 마세요.</p>}
    {state?.error && <p className="admin-action-error" role="alert">{state.error}</p>}
    {state?.message && <p className="admin-note" role="status">{state.message}</p>}
  </>
}

const DemoNote = () => <p className="admin-note">이 기록은 서버에 저장되지 않아요. 탭을 옮겨도 초안은 남지만 새로고침하면 사라져요.</p>

/** 실제 운영 공지 API 패널. 목록의 로딩·실패는 AdminPage의 LiveState가 보이고, 저장하면 회원 공지사항에 바로 공개됩니다. */
export function OperationsNotices({ vm }: { vm: VM }) {
  const selection = vm.recordSelection.notices
  const rows = vm.live.data?.notices ?? []
  const row = rows.find((item) => item.id === selection)
  const root = useAdminDetailFocus(selection, !!row, rows.length)
  const key = selection ?? 'new'
  const form = vm.noticeDrafts[key] ?? { title: row?.title ?? '', body: row?.body ?? '' }
  const state = vm.actions[`notice:${key}`]
  const blocked = vm.mutationsBlocked || !!state?.pending
  return <section className="panel admin-operations" aria-label="운영 공지" ref={root}>
    {!selection ? <>
      <div className="table-head"><h2 tabIndex={-1}>운영 공지 목록</h2><button type="button" className="btn pri" data-record-id="new" onClick={() => vm.selectRecord('notices', 'new')}>공지 작성</button></div>
      {vm.live.data && (rows.length ? <ul className="admin-record-list">{rows.map((item) => <li key={item.id}><button type="button" className="admin-record-link" data-record-id={item.id} onClick={() => vm.selectRecord('notices', item.id)}><b>{item.title}</b><span className="small muted">{kstDateTime(item.createdAt)} · 상세 보기{vm.noticeDrafts[item.id] ? ' · 수정 초안 있음' : ''}</span></button></li>)}</ul> : <p className="admin-empty">등록된 운영 공지가 없어요. 공지를 작성해 보세요.</p>)}
    </> : <>
      <button type="button" className="btn sm" onClick={() => vm.selectRecord('notices', null)}>공지 목록으로</button>
      <h2 tabIndex={-1}>{selection === 'new' ? '새 운영 공지' : row?.title ?? '공지 확인'}</h2>
      {selection !== 'new' && !row ? (vm.live.data && !vm.live.isRefreshing && <p role="alert">공지를 표시할 수 없어요. 목록 새로고침 후 다시 선택해 주세요.</p>) : <>
        {row && <><p className="small muted">등록 {kstDateTime(row.createdAt)} · 수정 {kstDateTime(row.updatedAt)}</p><p className="admin-prose">{row.body}</p><h3>공지 수정</h3></>}
        <form onSubmit={(event) => { event.preventDefault(); void vm.saveNotice(row?.id ?? null, form) }}>
          <fieldset disabled={blocked} className="form-grid">
            <label className="field wide">공지 제목<input className="inp" required maxLength={200} value={form.title} onChange={(e) => vm.setNoticeDraft(key, { ...form, title: e.target.value })} /></label>
            <label className="field wide">공지 내용<textarea className="ta" required maxLength={20000} rows={8} value={form.body} onChange={(e) => vm.setNoticeDraft(key, { ...form, body: e.target.value })} /></label>
            <div className="rowend wide"><button type="submit" className="btn pri">{state?.pending ? '저장 중…' : '공지 저장'}</button>{row && <button type="button" className="btn" onClick={() => { if (window.confirm('이 공지를 삭제할까요? 회원 공지사항에서도 사라지고 복구할 수 없어요.')) void vm.deleteNotice(row.id) }}>공지 삭제</button>}</div>
          </fieldset>
          <AdminActionStatus state={state} />
        </form>
      </>}
    </>}
    <p className="admin-note">저장한 공지는 바로 회원 공지사항에 공개돼요. 예약·고정·회원 알림은 지원하지 않아요.</p>
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
      {rows.length ? <ul className="admin-record-list">{rows.map((item) => <li key={item.id}><button type="button" className="admin-record-link" data-record-id={item.id} onClick={() => vm.selectRecord('events', item.id)}><b>{item.title}</b><span className="small muted">{item.startsAt ? kstDateTime(item.startsAt) : '시작 미정'} ~ {item.endsAt ? kstDateTime(item.endsAt) : '종료 미정'} · 한국시간{vm.eventDrafts[item.id] ? ' · 수정 초안 있음' : ''}</span></button></li>)}</ul> : <p className="admin-empty">등록된 운영 이벤트가 없어요. 이벤트를 작성해 보세요.</p>}
    </> : <>
      <button type="button" className="btn sm" onClick={() => vm.selectRecord('events', null)}>이벤트 목록으로</button>
      <h2 tabIndex={-1}>{selection === 'new' ? '새 운영 이벤트' : row?.title ?? '이벤트 확인'}</h2>
      {selection !== 'new' && !row ? <p role="alert">이벤트를 표시할 수 없어요. 목록 새로고침 후 다시 선택해 주세요.</p> : <>
        {row && <><p className="small muted">{row.startsAt ? kstDateTime(row.startsAt) : '시작 미정'} ~ {row.endsAt ? kstDateTime(row.endsAt) : '종료 미정'} · 한국시간</p><p className="small muted">UTC: {row.startsAt ?? '시작 미정'} / {row.endsAt ?? '종료 미정'}</p><p className="admin-prose">{row.body}</p><h3>이벤트 수정</h3></>}
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
    <DemoNote />
  </section>
}
