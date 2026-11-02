import { Cov, CoverOf } from '../../../shared/art'
import { kfmt } from '../../../shared/format'
import { Go } from '../../../shared/Go'
import { Footer, Gnb } from '../../../shared/shell/Gnb'
import { PublishSettingsSheet } from '../../studio/view/StudioSheets'
import { useLibraryViewModel } from '../viewmodel/useLibraryViewModel'

const TABS = [['read', '읽는 중'], ['write', '내가 쓰는 소설'], ['qa', '내 댓글·신고']] as const

/** 목업 lib(): U11 내 서재 (읽는 중·내가 쓰는 소설·내 댓글·신고) */
export function LibraryPage() {
  const d = useLibraryViewModel()
  if (!d) return null
  return (
    <>
      <Gnb on="lib" />
      <main className="wrap">
        <div className="sec-h" style={{ marginBottom: 0 }}><h2>내 서재</h2><span className="muted small">읽기와 쓰기를 한 계정에서 해요</span></div>
        <nav className="libtabs">{TABS.map(([k, l]) => <Go key={k} to={`/lib?tab=${k}`} className={d.tab === k ? 'on' : ''}>{l}{k === 'write' && d.pending > 0 && <span className="nb">{d.pending}</span>}</Go>)}</nav>
        {d.reports && (
          <>
            <div className="list" id="myreports">{d.reports.map((r) => (
              <div className="rp" key={r.id}><div className="top"><b>{r.title} {r.n ? `${r.n}화` : '소설 전체'} · {r.type}</b><span className={`chip ${/완료|반영/.test(r.status) ? 'ok' : 'wait'}`}>{r.status}</span></div><div className="small" style={{ marginTop: 4 }}>{r.text}</div><div className="a">🤖 {r.reply}</div></div>
            ))}</div>
            <p className="muted small" style={{ marginTop: 10 }}>작가가 처리하면 상태가 바뀌어요.</p>
          </>
        )}
        {d.read && (
          <>
            <div className="sec-h"><h2>이어 읽기</h2></div>
            <div className="list">{d.read.recent.map(({ work: w, n, tot }) => (
              <div className="li" key={w.id}><div className="th"><CoverOf w={w} /></div><div><b>{w.title}</b><div className="m">{n}화까지 읽음 · {w.genre}</div><div className="bar"><i style={{ width: `${n / tot * 100}%` }} /></div></div><Go to={`/read/${w.id}/${n}`} className="btn sm pri">▶ {n}화 이어 읽기</Go></div>
            ))}</div>
            <div className="sec"><div className="sec-h"><h2>관심 소설</h2></div>{d.read.liked.length
              ? <div className="grid6">{d.read.liked.map((w) => <Go key={w.id} to={`/work/${w.id}`} className="bk prox"><Cov w={w} likes /><span className="hk">{w.title}</span></Go>)}</div>
              : <div className="list"><div className="rp muted">소설 화면에서 ♡를 누르면 여기에 모여요.</div></div>}</div>
          </>
        )}
        {d.write && (
          <>
            {d.write.appeals.map((q) => (
              <form className="panel" key={q.id} aria-label={`${q.title} · 권리 신고 소명`} onSubmit={(e) => { e.preventDefault(); d.appeal(q.id, new FormData(e.currentTarget).get('appeal')?.toString() ?? '') }}>
                <b>{q.title} · 권리 신고 소명</b><p className="small muted">신고 내용: {q.text}. 검토 중 작품이 제한되어 있어요.</p>
                <label className="field">소명 내용<textarea className="ta" name="appeal" maxLength={1000} required /></label><button className="btn sm pri">소명 제출</button>
              </form>
            ))}
            {d.write.mine.map(({ work: w, parent, writingNext, pub, forkLabel, forkCount }) => (
              <div className="mywork" data-work={w.id} key={w.id}><div className="th"><CoverOf w={w} /></div><div><h3>{w.title}</h3>
                <div className="tags">{parent ? <span className="chip ok">포크 · {parent.title} {w.forkAt}화에서</span> : <span className="chip">{w.kind}</span>}{pub ? <span className="chip ok">공개 중</span> : <span className="chip wait">비공개 · 작성 중</span>}{!w.parent && <span className="chip">{forkLabel}</span>}</div>
                <div className="small muted">{w.parent ? `원작 스냅샷 ${w.forkAt}화 + 내가 쓴 ${w.eps.length}화${writingNext ? ' · 다음 화 초안 작성 중' : ''}` : `${w.eps.length}화 · ♥ ${kfmt(w.likes)} · 포크 소설 ${forkCount}편`}</div>
                <div className="acts" style={{ marginTop: 12 }}><Go to={`/studio/${w.id}`} className="btn sm pri">✎ 쓰기</Go>{!w.parent
                  ? <><Go to="/inbox" className="btn sm">독자 피드백함{d.pending > 0 && w.id === 'starlight' && <span className="badge-n">{d.pending}</span>}</Go><button type="button" className="btn sm" onClick={() => d.openPublish(w.id)}>공개 설정</button></>
                  : <><Go to={`/work/${w.id}`} className="btn sm">소설 화면</Go><Go to={`/work/${w.parent}`} className="btn sm">원작 보기</Go></>}</div>
              </div></div>
            ))}
            <div className="sec"><div className="sec-h"><h2>새로 시작하기</h2></div><div className="newbox">
              <Go to="/new" className="newc" id="newWork"><b>＋ 새 소설 쓰기</b><span>세계관·인물을 정하고 1화부터 직접 써요 (오리지널)</span></Go>
              <Go to="/writing-policy?method=import" className="newc"><b>＋ 내 소설 가져오기</b><span>예시 원고로 세계관·인물·사건 정리 흐름을 살펴봐요 (가상 추출)</span></Go>
              <Go to="/writing-policy?method=fork" className="newc"><b>✎ 다른 소설 포크</b><span>원작을 고르고 마음에 드는 회차에서 시작해요</span></Go>
            </div></div>
          </>
        )}
      </main>
      {d.publishing && <PublishSettingsSheet work={d.publishing} onSave={d.savePublish} onClose={d.closePublish} />}
      <Footer />
    </>
  )
}
