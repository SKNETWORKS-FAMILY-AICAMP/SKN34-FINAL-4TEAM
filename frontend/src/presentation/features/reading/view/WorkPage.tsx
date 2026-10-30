import { useState } from 'react'
import { useParams } from 'react-router'

import { Art, CoverOf } from '../../../shared/art'
import { kfmt } from '../../../shared/format'
import { Go } from '../../../shared/Go'
import { BackChev, Heart } from '../../../shared/icons'
import { Footer, Gnb } from '../../../shared/shell/Gnb'
import { useWorkViewModel } from '../viewmodel/useWorkViewModel'
import { Amb } from './Amb'
import { ReportSheet } from './Sheets'

/** 목업 unavailableWork() */
export function UnavailableWork() {
  return (
    <>
      <Gnb />
      <main className="wrap"><div className="panel"><h1>소설을 찾을 수 없거나 볼 수 없어요.</h1><Go to="/" className="btn">홈으로</Go></div></main>
      <Footer />
    </>
  )
}


/** 목업 work(id): U04 소설 상세 */
export function WorkPage() {
  const { id = '' } = useParams()
  const vm = useWorkViewModel(id)
  const d = vm.detail
  if (d === undefined) return null
  if (d === null) return <UnavailableWork />
  const { work: w, parent: p, visible, last, read, liked, forks, forkList } = d
  const start = last && visible.some(([, i]) => i + 1 === last) ? last : (visible[0]?.[1] ?? 0) + 1
  return (
    <>
    <div className={`calm calm-${w.theme}`} style={{ minHeight: '100vh' }}>
      <div className="band"><Art theme={w.theme} w={1200} h={460} seed={w.id + 'band'} /></div>
      {vm.bandAmb && <Amb t={w.theme} lite band />}
      <div className="wrap">
        <div className="topbar"><Go to="/" className="back" aria-label="홈으로 돌아가기"><BackChev />홈으로</Go><span style={{ marginLeft: 'auto' }} /></div>
        <section className="whero">
          <div className="cover"><CoverOf w={w} k="big" /></div>
          <div>
            <span className="g">{w.genre}</span>{w.auto?.on && <span className="chip ok" style={{ marginLeft: 8 }}>🤖 AI 자율 연재 중</span>}
            <h1>{w.title}</h1><div className="by">{w.by}</div>{p && <div className="by" style={{ marginTop: 6 }}>“{w.dir}”</div>}
            <p className="sum">{w.summary || '원작 「' + p?.title + '」의 ' + w.forkAt + '화 이후, 다른 길로 간 포크 소설.'}</p>
            <div className="hashes">{(w.hash || p?.hash || []).map((h) => <Go key={h} to={`/tag/${encodeURIComponent(h.replace(/^#/, ''))}`} title={`${h} 소설 모아 보기`}>{h}</Go>)}</div>
            <div className="stats"><span>♥ <b id="lkc">{kfmt(w.likes + (liked ? 1 : 0))}</b></span><span>👁 <b>{kfmt(w.views)}</b></span><span>💬 <b>{w.cmts || 0}</b></span><span>✎ 포크 소설 <b>{forks.length}</b></span></div>
            <div className="acts">
              {visible.length > 0 && <Go to={`/read/${id}/${start}`} className="tbtn pri">읽기 시작</Go>}
              {!!last && <Go to={`/read/${id}/1`} className="tbtn">처음부터</Go>}
              <LikeButton liked={liked} onClick={vm.toggleLike} />
              <button type="button" className="ib" aria-label="공유" onClick={vm.share}>↗</button>
              <button type="button" className="btn sm" aria-label={`${w.title} 소설 신고`} onClick={() => vm.setReporting(true)}>🚩 소설 신고</button>
            </div>
          </div>
        </section>
        <div className="wgrid">
          <section className="tcard eps">
            <div className="eptool">
              <b>전체 {visible.length}화</b>
              <div className="sortt">
                <button type="button" className={vm.epSort !== 'new' ? 'on' : ''} onClick={() => vm.setSort('old')}>1화부터</button>
                <button type="button" className={vm.epSort === 'new' ? 'on' : ''} onClick={() => vm.setSort('new')}>최신순</button>
              </div>
              <label className="eps-q"><span aria-hidden="true">🔍</span><input id="epq" placeholder="회차 제목·본문 검색" aria-label="회차 검색" value={vm.query} onChange={(e) => vm.setQuery(e.target.value)} /></label>
            </div>
            <div id="eplist">
              {vm.episodes.length ? vm.episodes.map(({ e, n, match }) => {
                const inh = w.parent && n <= (w.forkAt ?? 0)
                const fc = forks.filter((f) => f.forkAt === n).length
                return (
                  <Go key={n} to={`/read/${id}/${n}`} className={`ep ${read.includes(n) ? 'read' : ''}`} style={match ? undefined : { display: 'none' }}>
                    <span className="no">{n}</span>
                    <div><b>{e.t}</b><div className="d">{inh ? '원작 스냅샷 회차' : read.includes(n) ? '읽음' : last === n ? '읽는 중' : '무료'} <i className="sep" /> {e.p.join('').replace(/\s/g, '').length.toLocaleString()}자{fc > 0 && <> <i className="sep" /> 포크 소설 {fc}</>}</div></div>
                    {fc ? <span className="chip ok">포크됨</span> : <span />}
                  </Go>
                )
              }) : <p className="muted" style={{ padding: 20 }}>아직 공개된 회차가 없어요.</p>}
            </div>
            <p className="muted small" id="epnone" style={{ padding: 20, display: vm.noMatch ? 'block' : 'none' }}>검색 결과가 없어요.</p>
          </section>
          <aside className="tcard forkbox">
            {p ? (
              <><h3>원작 보기</h3><p>이 소설은 「{p.title}」 {w.forkAt}화가 끝난 시점의 설정을 복사해서 시작했어요. 이후 바뀐 설정은 이 소설에만 저장돼요.</p><Go to={`/work/${p.id}`} className="tbtn">원작으로 가기</Go></>
            ) : forkList.length ? (
              <><h3>이 소설, 다르게 쓰고 싶다면</h3><p>{w.owner === '운영팀' ? '운영팀이' : '작가가'} <b style={{ color: 'var(--pri-ink)' }}>{w.forkAll || (w.forkEps ?? []).length === w.eps.length ? '전체 회차' : forkList.join('·') + '화'}</b>에서 포크를 허용했어요.<br />고른 회차까지의 세계관과 인물을 그대로 가져가요.</p><Go to="/writing-policy?method=fork" state={{ target: `/fork/${id}` }} className="tbtn pri">✎ 포크하기</Go></>
            ) : (
              <><h3>포크를 허용하지 않은 소설</h3><p>소설 소유자가 포크를 허용하지 않았어요. 읽기와 질문·제보만 가능해요.</p><button type="button" className="tbtn" disabled>✎ 포크하기 불가</button></>
            )}
            {!w.parent && (
              <div className="ifs">
                <div className="pop-h"><b>🔥 인기 포크</b><small>좋아요 순</small></div>
                {d.topForks.length ? d.topForks.slice(0, 3).map((f, i) => (
                  <Go key={f.id} to={`/work/${f.id}`} className="ifl pk"><span className={`rkn md md${i + 1}`}>{i + 1}</span><div><b>{f.dir}</b><small>{f.forkAt}화에서 포크 · {f.author} · ♥ {kfmt(f.likes)}</small></div></Go>
                )) : <p style={{ margin: '8px 0 0' }}>아직 포크된 전개가 없어요.</p>}
                {d.topForks.length > 0 && <Go to={`/ifs?w=${id}`} className="btn sm" style={{ width: '100%', marginTop: 8 }}>{d.topForks.length > 3 ? `전개 ${d.topForks.length}개 모두 보기 →` : '이 소설의 포크 소설 보기 →'}</Go>}
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
    <Footer />
    {vm.reporting && <ReportSheet work={w} onClose={() => vm.setReporting(false)} />}
    </>
  )
}

/** 목업 data-act="like": 누를 때마다 하트가 튀는 pop1 효과 */
function LikeButton({ liked, onClick }: { liked: boolean; onClick: () => void }) {
  const [pop, setPop] = useState(false)
  return (
    <button type="button" className={`ib ${liked ? 'on' : ''}${pop ? ' pop1' : ''}`} aria-label="관심 소설" aria-pressed={liked}
      onClick={() => { setPop(true); onClick() }} onAnimationEnd={() => setPop(false)}><Heart /></button>
  )
}
