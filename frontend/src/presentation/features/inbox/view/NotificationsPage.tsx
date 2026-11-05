import { noticeLabel } from '../../../../domain/entities/notification'
import { Footer, Gnb } from '../../../shared/shell/Gnb'
import { useNotificationsViewModel } from '../viewmodel/useInboxViewModel'

const when = (iso: string) => new Date(iso).toLocaleString('ko-KR', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })

/** U42 알림함 */
export function NotificationsPage() {
  const vm = useNotificationsViewModel()
  return (
    <>
      <Gnb />
      <main className="wrap">
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
            <div className="inbox">{vm.items.length ? vm.items.map((n) => (
              <div key={n.id} className="row" style={{ alignItems: 'stretch', gap: 8 }}>
                <button type="button" style={{ flex: 1 }} className={`ibx ${n.read ? '' : 'on'}`} onClick={() => vm.open(n)}><div className="top"><b>{n.summary}</b><span className="chip">{noticeLabel(n.kind)}</span></div><span className="small muted">{when(n.createdAt)}{n.read ? ' · 읽음' : ' · 읽지 않음'}</span></button>
                <button type="button" className="btn sm" aria-label={`알림 삭제: ${n.summary}`} onClick={() => vm.remove(n)}>삭제</button>
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
