import type { CSSProperties, ReactNode } from 'react'

import { lastPage } from '../../../../domain/entities/operations'
import { kstDateTime } from '../../../shared/format'
import type { AdminActionState, useAdminViewModel } from '../viewmodel/useAdminViewModel'
import { useAdminDetailFocus } from './useAdminDetailFocus'
import './admin-operations.css'

type VM = ReturnType<typeof useAdminViewModel>

/**
 * 조치의 진행·실패·완료 안내. 표의 행 조치처럼 버튼에서 떨어진 자리에 보일 때는 target으로 어느 대상의 조치인지 이름을 앞에 붙입니다.
 * done을 끄면 완료 문구는 그리지 않습니다(행 조치의 완료는 화면 위 완료 줄 하나가 맡아 같은 문구가 두 번 보이지 않게 합니다).
 */
export function AdminActionStatus({ state, target, done = true }: { state?: AdminActionState; target?: string; done?: boolean }) {
  const who = target ? <b>{target} · </b> : null
  return <>
    {state?.pending && <p className="admin-note" role="status">{who}요청을 처리하고 있어요. 중복으로 보내지 마세요.</p>}
    {state?.error && <p className="admin-action-error" role="alert">{who}{state.error}</p>}
    {done && state?.message && <p className="admin-note" role="status">{state.message}</p>}
  </>
}

/** 표마다 용도를 알리는 캡션과, 좁은 화면에서 키보드로 가로 스크롤할 수 있는 영역을 붙입니다. */
export function Table({ label, style, children }: { label: string; style?: CSSProperties; children: ReactNode }) {
  return (
    <div className="adm-scroll" role="region" tabIndex={0} aria-label={label} style={style}>
      <table>
        <caption className="sr-only">{label}</caption>
        {children}
      </table>
    </div>
  )
}

/**
 * 실제 운영 API 목록의 로딩·새로고침·실패. 실패를 빈 목록으로 숨기지 않습니다.
 * forbidden을 주면 권한이 없을 때(데이터가 null, 403) 다시 불러오기 없이 그 안내만 보입니다.
 */
export function LiveState({ vm, label, state, forbidden }: { vm: VM; label: string; state?: Pick<VM['live'], 'isLoading' | 'isRefreshing' | 'isError' | 'retry'> & { data?: unknown }; forbidden?: string }) {
  const l = state ?? vm.live
  return (
    <>
      {l.isLoading && <p className="admin-data-state" role="status">{label}을 불러오고 있어요.</p>}
      {l.isRefreshing && <p className="admin-data-state" role="status">{label}을 새로고침하고 있어요.</p>}
      {l.isError && (
        <div className="admin-data-state admin-action-error" role="alert">
          <p>{label}을 불러오지 못했어요. 로그인·업무 권한과 서버 연결을 확인한 뒤 다시 시도해 주세요.</p>
          <button type="button" className="btn sm" onClick={l.retry}>다시 불러오기</button>
        </div>
      )}
      {forbidden && l.data === null && <p className="admin-action-error" role="alert">{forbidden}</p>}
    </>
  )
}

/** 접두사가 같은 조치(`alert:…`)의 진행·실패·완료 안내를 모아 보입니다. 같은 패널에서 도는 조치는 한두 개뿐입니다. */
export function ActionLines({ vm, prefix, target }: { vm: VM; prefix: string; target?: (key: string) => string | undefined }) {
  return <>{Object.entries(vm.actions).filter(([key]) => key.startsWith(prefix)).map(([key, state]) => <AdminActionStatus key={key} state={state} target={target?.(key)} />)}</>
}

/** 번호 쪽 이동. page는 0부터이고 화면에는 1쪽부터 보입니다. limit이 있으면 서버가 앞에서부터 읽게 허용하는 건수 안의 쪽까지만 열 수 있습니다. */
export function Pager({ page, size, total, limit, onPage }: { page: number; size: number; total: number; limit?: number; onPage: (page: number) => void }) {
  const last = lastPage(total, size, limit)
  return (
    <nav className="rowend admin-pager" aria-label="쪽 이동">
      <span className="small muted">전체 {total.toLocaleString('ko-KR')}건 · {page + 1}/{last + 1}쪽</span>
      <button type="button" className="btn sm" disabled={page <= 0} onClick={() => onPage(page - 1)}>이전</button>
      <button type="button" className="btn sm" disabled={page >= last} onClick={() => onPage(page + 1)}>다음</button>
    </nav>
  )
}

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
            <p className="small muted wide">모든 항목은 필수예요.</p>
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
