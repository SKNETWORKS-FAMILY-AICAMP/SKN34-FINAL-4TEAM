import { useState } from 'react'

import type { Work } from '../../../../domain/entities/work'
import { NOTICE_BODY_MAX, NOTICE_CATEGORIES, NOTICE_TITLE_MAX, noticeInput, type NoticeCategory, type WorkNoticeInput } from '../../../../domain/entities/workNotice'
import { useWorkNoticesViewModel } from '../viewmodel/useWorkNoticesViewModel'

const PAGE = 10
const EMPTY: WorkNoticeInput = { category: 'info', title: '', body: '', pinned: false }
const categoryName = (c: NoticeCategory) => NOTICE_CATEGORIES.find(([k]) => k === c)?.[1] ?? c
/** 서버 UTC 시각을 한국시간 날짜(YY.MM.DD)로 표시합니다(한국은 서머타임이 없어 +9시간 고정). */
const ymd = (iso: string) => new Date(Date.parse(iso) + 9 * 3600_000).toISOString().slice(2, 10).replace(/-/g, '.')
/** ref 콜백이 매 렌더 다시 불리지 않도록 모듈 함수로 둡니다(수정 입력이 나타날 때만 제목에 포커스). */
const focusNow = (el: HTMLInputElement | null) => el?.focus()

type FormProps = {
  label: string
  submitLabel: string
  initial?: WorkNoticeInput
  busy: boolean
  /** 성공하면 true. 실패하면 입력을 그대로 둔다. */
  onSubmit: (input: WorkNoticeInput) => Promise<boolean>
  onCancel?: () => void
}

/** 작성·수정 공용 입력 폼. 보내기에 성공하면 처음 값으로 비우고(수정은 호출 측이 폼을 닫음), 실패하면 입력을 그대로 둡니다. */
function NoticeForm({ label, submitLabel, initial = EMPTY, busy, onSubmit, onCancel }: FormProps) {
  const [draft, setDraft] = useState(initial)
  return (
    <form className="wn-form" aria-label={label} onSubmit={(e) => { e.preventDefault(); void onSubmit(draft).then((ok) => { if (ok) setDraft(initial) }) }}>
      <div className="wn-row">
        <select className="inp" aria-label="소식 분류" value={draft.category} onChange={(e) => setDraft({ ...draft, category: NOTICE_CATEGORIES.find(([k]) => k === e.target.value)?.[0] ?? 'info' })} style={{ width: 'auto' }}>
          {NOTICE_CATEGORIES.map(([k, name]) => <option key={k} value={k}>{name}</option>)}
        </select>
        <input ref={onCancel ? focusNow : undefined} className="inp" aria-label="소식 제목" placeholder="소식 제목" maxLength={NOTICE_TITLE_MAX} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} style={{ flex: 1, width: 'auto' }} />
      </div>
      <textarea className="ta" aria-label="소식 내용" placeholder="독자에게 알릴 내용" rows={4} maxLength={NOTICE_BODY_MAX} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
      <div className="wn-row">
        <label><input type="checkbox" checked={draft.pinned} onChange={(e) => setDraft({ ...draft, pinned: e.target.checked })} /> 상단 고정</label>
        <span className="wn-row">
          {onCancel && <button type="button" className="btn sm" onClick={onCancel}>취소</button>}
          <button type="submit" className="btn sm pri" disabled={busy || !draft.title.trim() || !draft.body.trim()}>{submitLabel}</button>
        </span>
      </div>
    </form>
  )
}

/**
 * 소설 상세의 소식 탭(작품 공지). 실제 작품은 서버 목록·작성·수정·고정·삭제이고, 로딩·실패(재시도)·빈 상태는 실제 응답 그대로입니다.
 * 메모리 데모 작품은 같은 화면에 메모리 저장소를 쓰고 데모임을 알립니다. 작품이 바뀌면 호출 측이 key로 새로 만듭니다.
 */
export function WorkNotices({ work }: { work: Work }) {
  const vm = useWorkNoticesViewModel(work)
  const [page, setPage] = useState(1)
  const [editing, setEditing] = useState<string | null>(null)
  const { notices } = vm
  if (!vm.open) return <p className="muted" style={{ padding: 20 }}>공개한 뒤에 소식을 보고 올릴 수 있어요.</p>
  const pages = Math.max(1, Math.ceil((notices?.length ?? 0) / PAGE))
  const cur = Math.min(page, pages)
  return (
    <div className="wnotice">
      {!work.canonical && <p className="muted small">데모 소식이에요 · 서버에 저장되지 않고 새로 고치면 처음 상태로 돌아가요.</p>}
      {vm.canWrite && <NoticeForm label="소식 작성" submitLabel="소식 등록" busy={vm.busy} onSubmit={async (input) => { const ok = await vm.create(input); if (ok) setPage(1); return ok }} />}
      {vm.isError && (
        <div role="alert">
          <p className="muted">소식을 불러오지 못했어요. 연결 상태를 확인한 뒤 다시 시도해 주세요.</p>
          <button type="button" className="btn sm" onClick={vm.retry}>다시 불러오기</button>
        </div>
      )}
      {!notices && !vm.isError && <p className="muted" role="status">소식을 불러오고 있어요…</p>}
      {notices?.length === 0 && <p className="muted" style={{ padding: 20 }}>아직 소식이 없어요.</p>}
      {notices?.slice((cur - 1) * PAGE, cur * PAGE).map((n) => (
        <article key={n.id} className="wn-item" aria-labelledby={editing === n.id ? undefined : `wn-${n.id}`}>
          {editing === n.id ? (
            <NoticeForm label="소식 수정" submitLabel="저장" initial={noticeInput(n)} busy={vm.busy} onCancel={() => setEditing(null)}
              onSubmit={async (input) => { const ok = await vm.update(n, input); if (ok) setEditing(null); return ok }} />
          ) : (
            <>
              <div className="wn-head">
                {n.pinned && <span className="wn-badge pin">📌 고정</span>}<span className="wn-badge">{categoryName(n.category)}</span>
                <h2 id={`wn-${n.id}`}>{n.title}</h2>
              </div>
              <time className="muted small" dateTime={n.createdAt}>{ymd(n.createdAt)}</time>
              <p className="wn-body">{n.body}</p>
              {vm.canWrite && (
                <div className="wn-row" style={{ justifyContent: 'flex-end' }}>
                  <button type="button" className="btn sm" disabled={vm.busy} onClick={() => setEditing(n.id)}>수정</button>
                  <button type="button" className="btn sm" disabled={vm.busy} onClick={() => void vm.togglePin(n)}>{n.pinned ? '고정 해제' : '상단 고정'}</button>
                  <button type="button" className="btn sm" disabled={vm.busy} onClick={() => void vm.remove(n)}>삭제</button>
                </div>
              )}
            </>
          )}
        </article>
      ))}
      {pages > 1 && (
        <nav className="wn-pages" aria-label="소식 페이지">
          {Array.from({ length: pages }, (_, i) => i + 1).map((p) => (
            <button key={p} type="button" aria-current={p === cur ? 'page' : undefined} onClick={() => setPage(p)}>{p}</button>
          ))}
        </nav>
      )}
    </div>
  )
}
