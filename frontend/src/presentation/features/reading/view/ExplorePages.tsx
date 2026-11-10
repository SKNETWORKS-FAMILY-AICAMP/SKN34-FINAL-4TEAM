import { Fragment } from 'react'
import { Navigate, useParams } from 'react-router'

import { epsOf, RANKING_KINDS, RANKING_PERIODS, RANKING_TYPES, rankingUsesPeriod, SEARCH_FIELDS, SEARCH_SORTS, sortsOf, type Work } from '../../../../domain/entities/work'
import { CoverOf, Cov } from '../../../shared/art'
import { ago, asOf, kfmt, qs } from '../../../shared/format'
import { Go } from '../../../shared/Go'
import { ContentLoadState } from '../../../shared/ContentLoadState'
import { Crown } from '../../../shared/icons'
import { Footer, Gnb } from '../../../shared/shell/Gnb'
import { useDocumentTitle } from '../../../shared/useDocumentTitle'
import { useIfsViewModel, useRankViewModel, useSearchViewModel, useTagViewModel } from '../viewmodel/useExploreViewModel'
import { ReportSheet } from './Sheets'

type St = Record<string, string>

/** 선택한 정렬·범위·탭은 색(.on)뿐 아니라 aria-current로도 알립니다. */
const selected = (on: boolean) => ({ className: on ? 'on' : '', 'aria-current': on ? ('true' as const) : undefined })

/** 목업 listTools(base, st, withQ) */
function ListTools({ base, st, onSubmit }: { base: string; st: St; onSubmit: (q: string) => void }) {
  return (
    <div className="ltools">
      <form className="lq" key={st.q} onSubmit={(e) => { e.preventDefault(); onSubmit(new FormData(e.currentTarget).get('q')?.toString() ?? '') }}>
        <span aria-hidden="true">🔍</span>
        <input name="q" defaultValue={st.q} placeholder="제목·작가·태그·장르로 찾기" aria-label="검색어" />
        <button className="btn sm pri" type="submit">검색</button>
      </form>
      <div className="lrow">
        <div className="sortt" role="group" aria-label="검색 범위">{SEARCH_FIELDS.map(([k, l]) => <Go key={k} {...selected(st.f === k)} to={qs(base, { ...st, f: k })}>{l}</Go>)}</div>
        <div className="sortt" role="group" aria-label="정렬">{SEARCH_SORTS.map(([k, l]) => <Go key={k} {...selected(st.sort === k)} to={qs(base, { ...st, sort: k })}>{l}</Go>)}</div>
      </div>
    </div>
  )
}

/** 서버 조회 실패는 빈 목록·0편으로 숨기지 않고 안내와 다시 불러오기로 보입니다. */
const LoadError = ({ retry }: { retry: () => void }) => (
  <div className="rp muted"><p role="alert">소설을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.</p><button type="button" className="btn sm" onClick={retry}>다시 불러오기</button></div>
)

/**
 * 목업 wcard(w, i, ranked). 서버 작품은 다른 통계를 감추지만, updated는 마지막 업데이트 시각이 순위 기준인 카드라 그 시각을,
 * popular는 좋아요 수가 순위 기준인 카드라 서버 값인 좋아요 수를 보입니다.
 */
function WCard({ w, i, ranked, updated, popular, onReport }: { w: Work; i: number; ranked?: boolean; updated?: boolean; popular?: boolean; onReport?: (w: Work) => void }) {
  const stats = w.statisticsSupported !== false
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
          <span className="m">총 {epsOf(w).length}화 <i></i> 조회 {kfmt(w.views || 0)}{(stats || popular) && <> <i></i> ♥ {kfmt(w.likes || 0)}</>}{(stats || updated) && <> <i></i> {ago(w.upd || 0)}</>}</span>
        </div>
      </Go>
      {!ranked && onReport && <button type="button" className="btn sm rg-report" aria-label={`${w.title} 소설 신고`} onClick={() => onReport(w)}><span aria-hidden="true">🚩</span> 소설 신고</button>}
    </div>
  )
}

/** 목업 searchPage(): U36 */
export function SearchPage() {
  const vm = useSearchViewModel()
  useDocumentTitle('검색')
  const L = vm.list ?? []
  return (
    <>
      <Gnb />
      <main className="wrap" id="main" tabIndex={-1}>
        <div className="sec-h"><h1>{vm.st.q ? `‘${vm.st.q}’ 검색 결과` : '소설 검색'}</h1>{vm.list && !vm.isError && <span className="muted small">{L.length}편</span>}</div>
        <ListTools base="/search" st={vm.st} onSubmit={vm.submit} />
        {!vm.list && !vm.isError && <ContentLoadState failed={false} retry={vm.retry}/>}
        <div className="rgrid" style={{ marginTop: 20 }}>
          {vm.isError ? <LoadError retry={vm.retry} /> : vm.list && (L.length ? L.map((w, i) => <WCard key={w.id} w={w} i={i} onReport={vm.canReport(w) ? vm.setReporting : undefined} />) : <div className="rp muted">검색 결과가 없어요. 다른 검색어나 범위로 찾아 보세요.</div>)}
        </div>
      </main>
      <Footer />
      {vm.reporting && <ReportSheet work={vm.reporting} onClose={() => vm.setReporting(null)} />}
    </>
  )
}

/** 목업 rank(): U25. 범위 탭·기준·기간은 주소 쿼리이고 머리말에 서버 계산 시각을 보입니다. 검색은 /search가 맡습니다. */
export function RankPage() {
  const vm = useRankViewModel()
  useDocumentTitle('랭킹')
  const L = vm.list ?? []
  // 기간을 쓰지 않는 기준(최신·방금 업데이트)으로 가는 링크는 주소에서 기간을 뺍니다.
  const to = (change: Partial<typeof vm.st>) => {
    const next = { ...vm.st, ...change }
    return qs('/rank', { ...next, period: rankingUsesPeriod(next.kind) ? next.period : undefined })
  }
  const basis = [
    RANKING_KINDS.find(([k]) => k === vm.st.kind)?.[1],
    vm.showPeriod ? RANKING_PERIODS.find(([k]) => k === vm.st.period)?.[2] : null,
    vm.computedAt && asOf(vm.computedAt),
  ].filter(Boolean).join(' · ')
  return (
    <>
      <Gnb on="rank" />
      <main className="wrap" id="main" tabIndex={-1}>
        <div className="sec-h" style={{ marginBottom: 0 }}><h1>랭킹</h1><span className="muted small">{basis}</span><Go to="/search" className="more"><span aria-hidden="true">🔍</span> 소설 검색 ›</Go></div>
        <nav className="libtabs" aria-label="랭킹 범위">{RANKING_TYPES.map(([k, l]) => <Go key={k} to={to({ t: k })} {...selected(vm.st.t === k)}>{l}</Go>)}</nav>
        <div className="ltools">
          <div className="lrow">
            <div className="sortt" role="group" aria-label="랭킹 기준">{RANKING_KINDS.map(([k, l]) => <Go key={k} {...selected(vm.st.kind === k)} to={to({ kind: k })}>{l}</Go>)}</div>
            {vm.showPeriod && <div className="sortt" role="group" aria-label="집계 기간">{RANKING_PERIODS.map(([k, l]) => <Go key={k} {...selected(vm.st.period === k)} to={to({ period: k })}>{l}</Go>)}</div>}
          </div>
        </div>
        {!vm.list && !vm.isError && <ContentLoadState failed={false} retry={vm.retry}/>}
        <div className="rgrid" style={{ marginTop: 20 }}>
          {vm.isError ? <LoadError retry={vm.retry} /> : vm.list && (L.length ? L.map((w, i) => <WCard key={w.id} w={w} i={i} ranked updated={vm.st.kind === 'updated'} popular={vm.st.kind === 'popular'} />) : <div className="rp muted">조건에 맞는 소설이 없어요.</div>)}
        </div>
      </main>
      <Footer />
    </>
  )
}

/** 목업 tagPage(t): U29 */
export function TagPage() {
  const { tag } = useParams()
  const vm = useTagViewModel(tag)
  const d = vm.data
  useDocumentTitle(d?.cur ?? '태그')
  return (
    <>
      <Gnb />
      {!d && <main className="wrap" id="main" tabIndex={-1}><ContentLoadState failed={vm.isError} retry={vm.retry}/></main>}
      {d && (
        <main className="wrap" id="main" tabIndex={-1}>
          <div className="sec-h"><h1>{d.cur}</h1><span className="muted small">이 해시태그가 붙은 소설 {d.list.length}편 · 포크 소설은 원작의 해시태그를 이어받아요</span></div>
          <div className="tagbar">{d.tags.map(([h, c]) => <Go key={h} {...selected(h === d.cur)} to={`/tag/${encodeURIComponent(h.slice(1))}`}>{h}<span>{c}</span></Go>)}</div>
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
  useDocumentTitle('포크 소설 모아보기')
  if (!vm.w) return <Navigate replace to="/rank?t=if" />
  const sorts = sortsOf(vm.groups?.flatMap(({ o, forks }) => [o, ...forks]) ?? [])
  const sort = sorts.some(([k]) => k === vm.sort) ? vm.sort : sorts[0][0]
  return (
    <>
      <Gnb on="ifs" />
      <main className="wrap" id="main" tabIndex={-1}>
        <div className="sec-h"><h1>포크 소설</h1><span className="muted small">원작의 한 회차에서 포크한 독자들의 소설이에요. 원작은 바뀌지 않아요.</span></div>
        <div className="lrow" style={{ justifyContent: 'flex-end', margin: '12px 0 8px' }}>
          <div className="sortt" role="group" aria-label="정렬">{sorts.map(([k, l]) => <Go key={k} {...selected(sort === k)} to={qs('/ifs', { w: vm.w, sort: k })}>{l}</Go>)}</div>
        </div>
        {!vm.groups && <ContentLoadState failed={vm.isError} retry={vm.retry}/>}
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
                  <div><b>{f.title.split(': ').pop()}</b><small>{f.forkAt}화에서 포크 · {f.author} · “{f.dir}”</small>{f.statisticsSupported!==false && <small className="muted">조회 {kfmt(f.views || 0)} · ♥ {kfmt(f.likes || 0)} · {ago(f.upd || 0)}</small>}</div>
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
