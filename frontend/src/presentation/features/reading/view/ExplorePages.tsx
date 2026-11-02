import { Fragment } from 'react'
import { Navigate, useParams } from 'react-router'

import { epsOf, FIELDS, SORTS, type Work } from '../../../../domain/entities/work'
import { CoverOf, Cov } from '../../../shared/art'
import { ago, kfmt, qs } from '../../../shared/format'
import { Go } from '../../../shared/Go'
import { Crown } from '../../../shared/icons'
import { Footer, Gnb } from '../../../shared/shell/Gnb'
import { useIfsViewModel, useRankViewModel, useSearchViewModel, useTagViewModel } from '../viewmodel/useExploreViewModel'
import { ReportSheet } from './Sheets'

type St = Record<string, string>

/** 목업 listTools(base, st, withQ) */
function ListTools({ base, st, onSubmit }: { base: string; st: St; onSubmit: (q: string) => void }) {
  return (
    <div className="ltools">
      <form className="lq" key={st.q} onSubmit={(e) => { e.preventDefault(); onSubmit(new FormData(e.currentTarget).get('q')?.toString() ?? '') }}>
        <span aria-hidden="true">🔍</span>
        <input name="q" defaultValue={st.q} placeholder="제목·작가·태그로 찾기" aria-label="검색어" />
        <button className="btn sm pri" type="submit">검색</button>
      </form>
      <div className="lrow">
        <div className="sortt" role="group" aria-label="검색 범위">{FIELDS.map(([k, l]) => <Go key={k} className={st.f === k ? 'on' : ''} to={qs(base, { ...st, f: k })}>{l}</Go>)}</div>
        <div className="sortt" role="group" aria-label="정렬">{SORTS.map(([k, l]) => <Go key={k} className={st.sort === k ? 'on' : ''} to={qs(base, { ...st, sort: k })}>{l}</Go>)}</div>
      </div>
    </div>
  )
}

/** 목업 wcard(w, i, ranked) */
function WCard({ w, i, ranked, onReport }: { w: Work; i: number; ranked?: boolean; onReport?: (w: Work) => void }) {
  return (
    <div className="rg-item">
      <Go className={`rg prox ${ranked && i < 3 ? 'top3 t' + (i + 1) : ''}`} to={`/work/${w.id}`}>
        <div className="rc">
          <CoverOf w={w} />
          {ranked && <span className={`big ${i < 3 ? 'b' + (i + 1) : ''}`}>{i + 1}</span>}
          {ranked && i === 0 && <span className="crown" aria-label="1위"><Crown /></span>}
          {w.parent && <span className="tag if">포크</span>}
        </div>
        <div className="ri">
          <small className="g">{w.genre}</small><b>{w.title}</b>
          <small>{w.author}{w.parent && ` · 원작 ${w.forkAt}화에서 포크`}</small>
          <span className="m">총 {epsOf(w).length}화 <i></i> 조회 {kfmt(w.views || 0)} <i></i> ♥ {kfmt(w.likes || 0)} <i></i> {ago(w.upd || 0)}</span>
        </div>
      </Go>
      {!ranked && <button type="button" className="btn sm rg-report" aria-label={`${w.title} 소설 신고`} onClick={() => onReport?.(w)}><span aria-hidden="true">🚩</span> 소설 신고</button>}
    </div>
  )
}

/** 목업 searchPage(): U36 */
export function SearchPage() {
  const vm = useSearchViewModel()
  const L = vm.list ?? []
  return (
    <>
      <Gnb />
      <main className="wrap">
        <div className="sec-h"><h2>{vm.st.q ? `‘${vm.st.q}’ 검색 결과` : '소설 검색'}</h2><span className="muted small">{L.length}편</span></div>
        <ListTools base="/search" st={vm.st} onSubmit={vm.submit} />
        <div className="rgrid" style={{ marginTop: 20 }}>
          {vm.list && (L.length ? L.map((w, i) => <WCard key={w.id} w={w} i={i} onReport={vm.setReporting} />) : <div className="rp muted">검색 결과가 없어요. 다른 검색어나 범위로 찾아 보세요.</div>)}
        </div>
      </main>
      <Footer />
      {vm.reporting && <ReportSheet work={vm.reporting} onClose={() => vm.setReporting(null)} />}
    </>
  )
}

/** 목업 rank(): U25 */
export function RankPage() {
  const vm = useRankViewModel()
  const L = vm.list ?? []
  return (
    <>
      <Gnb on="rank" />
      <main className="wrap">
        <div className="sec-h" style={{ marginBottom: 0 }}><h2>랭킹</h2><span className="muted small">{SORTS.find((x) => x[0] === vm.st.sort)?.[1]} · 데모 데이터</span></div>
        <nav className="libtabs">{([['all', '전체'], ['orig', '원작 소설'], ['if', '포크 소설']] as const).map(([k, l]) => <Go key={k} to={qs('/rank', { ...vm.st, t: k })} className={vm.st.t === k ? 'on' : ''}>{l}</Go>)}</nav>
        <ListTools base="/rank" st={vm.st} onSubmit={vm.submit} />
        <div className="rgrid" style={{ marginTop: 20 }}>
          {vm.list && (L.length ? L.map((w, i) => <WCard key={w.id} w={w} i={i} ranked />) : <div className="rp muted">조건에 맞는 소설이 없어요.</div>)}
        </div>
      </main>
      <Footer />
    </>
  )
}

/** 목업 tagPage(t): U29 */
export function TagPage() {
  const { tag } = useParams()
  const d = useTagViewModel(tag)
  return (
    <>
      <Gnb />
      {d && (
        <main className="wrap">
          <div className="sec-h"><h2>{d.cur}</h2><span className="muted small">이 해시태그가 붙은 소설 {d.list.length}편 · 포크 소설은 원작의 해시태그를 이어받아요</span></div>
          <div className="tagbar">{d.tags.map(([h, c]) => <Go key={h} className={h === d.cur ? 'on' : ''} to={`/tag/${encodeURIComponent(h.slice(1))}`}>{h}<span>{c}</span></Go>)}</div>
          <div className="rgrid" style={{ marginTop: 22 }}>
            {d.list.map(({ w, tags }) => (
              <Go key={w.id} className="rg prox" to={`/work/${w.id}`}>
                <div className="rc"><CoverOf w={w} />{w.parent && <span className="tag if">포크</span>}</div>
                <div className="ri">
                  <small className="g">{w.genre}</small><b>{w.title}</b><small>{w.author}{w.parent && ` · 원작 ${w.forkAt}화에서`}</small>
                  <span className="m">{tags.map((h, i) => <Fragment key={h}>{i > 0 && ' '}<em className={h === d.cur ? 'hit' : ''}>{h}</em></Fragment>)}</span>
                </div>
              </Go>
            ))}
          </div>
        </main>
      )}
      <Footer />
    </>
  )
}

/** 목업 ifs(): U26 */
export function IfsPage() {
  const vm = useIfsViewModel()
  if (!vm.w) return <Navigate replace to="/rank?t=if" />
  return (
    <>
      <Gnb on="ifs" />
      <main className="wrap">
        <div className="sec-h"><h2>포크 소설</h2><span className="muted small">원작의 한 회차에서 포크한 독자들의 소설이에요. 원작은 바뀌지 않아요.</span></div>
        <div className="lrow" style={{ justifyContent: 'flex-end', margin: '12px 0 8px' }}>
          <div className="sortt" role="group" aria-label="정렬">{SORTS.map(([k, l]) => <Go key={k} className={vm.sort === k ? 'on' : ''} to={qs('/ifs', { w: vm.w, sort: k })}>{l}</Go>)}</div>
        </div>
        {vm.groups && (vm.groups.length ? vm.groups.map(({ o, label, forkList, forks }) => (
          <section key={o.id} className="ifg">
            <div className="o">
              <Go className="th" to={`/work/${o.id}`} aria-label={`${o.title} 원작`}><Cov w={o} k="s" /></Go>
              <b>{o.title}</b><small className="muted">{label}</small>
              {forkList.length > 0 && <Go className="btn sm pri" to={`/fork/${o.id}?at=${forkList[0]}`}>✎ 나도 포크하기</Go>}
            </div>
            <div>
              {forks.length ? forks.map((f) => (
                <Go key={f.id} className="ifc" to={`/work/${f.id}`}>
                  <div className="th"><CoverOf w={f} /></div>
                  <div><b>{f.title.split(': ').pop()}</b><small>{f.forkAt}화에서 포크 · {f.author} · “{f.dir}”</small><small className="muted">조회 {kfmt(f.views || 0)} · ♥ {kfmt(f.likes || 0)} · {ago(f.upd || 0)}</small></div>
                </Go>
              )) : <div className="rp muted">{o.forksAllowed ? '아직 포크 소설이 없어요. 첫 번째로 포크해 보세요.' : '소설 소유자가 포크를 허용하지 않았어요.'}</div>}
            </div>
          </section>
        )) : <div className="rp muted">공개 중인 원작을 찾을 수 없어요.</div>)}
      </main>
      <Footer />
    </>
  )
}
