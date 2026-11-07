import { useRef } from 'react'

import { type AppNotification, noticeLabel } from '../../../../domain/entities/notification'
import { Footer, Gnb } from '../../../shared/shell/Gnb'
import { useDocumentTitle } from '../../../shared/useDocumentTitle'
import { useNotificationsViewModel } from '../viewmodel/useNotificationsViewModel'

const when = (iso: string) => new Date(iso).toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })

/** U42 알림함 */
export function NotificationsPage() {
  const vm = useNotificationsViewModel()
  useDocumentTitle('알림함')
  const list = useRef<HTMLDivElement>(null)
  // 삭제하면 초점을 다음(없으면 이전) 알림으로, 남는 알림이 없으면 목록 영역으로 옮깁니다. 행의 버튼은 잠기지 않아 바로 옮길 수 있고,
  // 목록 갱신이 이 await보다 먼저든 나중이든 초점이 삭제 버튼에 있거나 이미 사라졌을 때만 옮겨 사용자가 간 곳을 가로채지 않습니다.
  const remove = async (n: AppNotification, button: HTMLElement) => {
    const i = vm.items.indexOf(n)
    const next = vm.items[i + 1] ?? vm.items[i - 1]
    const target = next && document.getElementById(`notice-${next.id}`)
    if (!await vm.remove(n)) return
    if (document.activeElement === button || document.activeElement === document.body) (target ?? list.current)?.focus()
  }
  return (
    <>
      <Gnb />
      <main id="main" tabIndex={-1} className="wrap">
        <div className="topbar" style={{ height: 'auto', marginBottom: 14 }}><h1 style={{ fontSize: 22 }}>알림함</h1><button type="button" className="btn sm" disabled={!vm.unread} onClick={vm.markAll}>모두 읽음</button></div>
        <section className="panel"><h2 style={{ fontSize: 16 }}>알림 설정</h2>
          {vm.prefs && <div className="row" style={{ flexWrap: 'wrap', marginTop: 10 }}>{([['read', '읽기 알림'], ['creator', '작가 소식']] as const).map(([k, l]) => (
            <label className="ck" key={k}><input type="checkbox" checked={vm.prefs![k]} disabled={vm.saving} onChange={(e) => vm.setPref(k, e.target.checked)} /> {l}</label>
          ))}</div>}
          <p className="small muted">결과·크레딧·권리·보안 알림은 필수 알림이에요. 알림은 앱 안에서만 확인할 수 있고, 직접 삭제하기 전까지 보관해요.</p>
        </section>
        <div className="panel" style={{ marginTop: 14 }}>
          {vm.live === 'offline' && <p className="small muted" role="status">실시간 연결이 끊겼어요. 자동으로 다시 연결하는 중이고, 그동안 도착한 알림은 다시 연결되면 보여요.</p>}
          {vm.status === 'loading' && <p className="muted" role="status">알림을 불러오는 중이에요…</p>}
          {vm.status === 'error' && <div role="alert"><p className="muted">알림을 불러오지 못했어요. 로그인 상태와 연결을 확인하고 다시 시도해 주세요.</p><button type="button" className="btn sm" onClick={vm.retry}>다시 시도</button></div>}
          {vm.status === 'ready' && (
            <div ref={list} tabIndex={-1} className="inbox">{vm.items.length ? vm.items.map((n) => (
              <div key={n.id} className="row" style={{ alignItems: 'stretch', gap: 8 }}>
                <button type="button" id={`notice-${n.id}`} style={{ flex: 1 }} className={`ibx ${n.read ? '' : 'on'}`} onClick={() => vm.open(n)}><div className="top"><b>{n.summary}</b><span className="chip">{noticeLabel(n.kind)}</span></div><span className="small muted">{when(n.createdAt)}{n.read ? ' · 읽음' : ' · 읽지 않음'}</span></button>
                <button type="button" className="btn sm" aria-label={`알림 삭제: ${n.summary}`} onClick={(e) => remove(n, e.currentTarget)}>삭제</button>
              </div>
            )) : <p className="muted">새 알림이 없어요.</p>}</div>
          )}
          {vm.status === 'ready' && vm.nextCursor && <button type="button" className="btn sm" disabled={vm.loadingMore} onClick={vm.loadMore}>{vm.loadingMore ? '불러오는 중…' : '더 보기'}</button>}
          <p className="small muted">개인 원고 내용과 민감 정보는 알림에 포함하지 않아요.</p>
        </div>
      </main>
      <Footer />
    </>
  )
}
