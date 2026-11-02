import { Footer, Gnb } from '../../../shared/shell/Gnb'
import { useNotificationsViewModel } from '../viewmodel/useInboxViewModel'

/** 목업 notificationsPage(): U42 알림함 */
export function NotificationsPage() {
  const vm = useNotificationsViewModel()
  if (!vm.data) return null
  const { list, prefs } = vm.data
  const unread = list.filter((n) => !n.read).length
  return (
    <>
      <Gnb />
      <main className="wrap">
        <div className="topbar" style={{ height: 'auto', marginBottom: 14 }}><h1 style={{ fontSize: 22 }}>알림함</h1><button type="button" className="btn sm" disabled={!unread} onClick={vm.markAll}>모두 읽음</button></div>
        <section className="panel"><h2 style={{ fontSize: 16 }}>알림 설정</h2>
          <div className="row" style={{ flexWrap: 'wrap', marginTop: 10 }}>{([['read', '읽기 알림'], ['creator', '작가 소식']] as const).map(([k, l]) => (
            <label className="ck" key={k}><input type="checkbox" checked={prefs[k]} onChange={(e) => vm.setPref(k, e.target.checked)} /> {l}</label>
          ))}</div>
          <p className="small muted">결과·크레딧·권리·보안 알림은 필수 알림이에요. 알림은 앱 안에서만 확인할 수 있고 90일 보관해요.</p>
        </section>
        <div className="panel" style={{ marginTop: 14 }}>
          <div className="inbox">{list.length ? list.map((n) => (
            <button type="button" key={n.id} className={`ibx ${n.read ? '' : 'on'}`} onClick={() => vm.open(n.id, n.target)}><div className="top"><b>{n.title}</b><span className="chip">{n.type}</span></div><p>{n.text}</p><span className="small muted">{n.at}{n.read ? ' · 읽음' : ' · 읽지 않음'}</span></button>
          )) : <p className="muted">새 알림이 없어요.</p>}</div>
          <p className="small muted">개인 원고 내용과 민감 정보는 알림에 포함하지 않아요.</p>
        </div>
      </main>
      <Footer />
    </>
  )
}
