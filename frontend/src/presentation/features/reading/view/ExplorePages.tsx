import { Fragment, useState, type ReactNode } from 'react'
import { Navigate, useParams } from 'react-router'

import { epsOf, RANKING_KINDS, RANKING_PERIODS, RANKING_TYPES, rankingUsesPeriod, SEARCH_FIELDS, SEARCH_SORTS, SEARCH_TABS, sortsOf, type SearchTab, type Work } from '../../../../domain/entities/work'
import { CoverOf, Cov } from '../../../shared/art'
import { ago, asOf, kfmt, qs } from '../../../shared/format'
import { Go } from '../../../shared/Go'
import { PopMenu } from '../../../shared/PopMenu'
import { ContentLoadState } from '../../../shared/ContentLoadState'
import { Crown, Flag, MoreVerticalIcon } from '../../../shared/icons'
import { Pager } from '../../../shared/Pager'
import { Footer, Gnb } from '../../../shared/shell/Gnb'
import { useDocumentTitle } from '../../../shared/useDocumentTitle'
import { CardHits, WorldHits } from '../../worlds/view/WorldSearchResults'
import { useIfsViewModel, useRankViewModel, useSearchViewModel, useTagViewModel } from '../viewmodel/useExploreViewModel'
import './explore.css'
import { ReportSheet } from './Sheets'

type St = Record<string, string>

/** 선택한 정렬·범위·탭은 색(.on)뿐 아니라 aria-current로도 알립니다. */
const selected = (on: boolean) => ({ className: on ? 'on' : '', 'aria-current': on ? ('true' as const) : undefined })

/**
 * 목업 listTools(base, st, withQ). 범위·정렬(`filters`)은 작품 탭에만 있고 다른 탭은 검색어 입력만 둡니다.
 * 입력칸은 주소의 검색어(`st.q`)를 따라가되 다시 그리지 않아(form에 key를 두지 않는다) 검색해도 키보드 초점이 남습니다.
 */
function ListTools({ base, st, onSubmit, placeholder, filters }: { base: string; st: St; onSubmit: (q: string) => void; placeholder: string; filters: boolean }) {
  const [text, setText] = useState(st.q)
  const [seen, setSeen] = useState(st.q)
  // 주소의 검색어가 바뀌면(제출·뒤로 가기) 입력칸도 맞춘다. 주소가 그대로인 동안 제출하지 않은 글은 남는다.
  if (seen !== st.q) { setSeen(st.q); setText(st.q) }
  return (
    <div className="ltools">
      <form className="lq" onSubmit={(e) => { e.preventDefault(); onSubmit(text) }}>
        <span aria-hidden="true">🔍</span>
        <input name="q" value={text} onChange={(e) => setText(e.target.value)} placeholder={placeholder} aria-label="검색어" />
        <button className="btn sm pri" type="submit">검색</button>
      </form>
      {filters && (
        <div className="lrow">
          <div className="sortt" role="group" aria-label="검색 범위">{SEARCH_FIELDS.map(([k, l]) => <Go key={k} {...selected(st.f === k)} to={qs(base, { ...st, f: k, type: 'work' })}>{l}</Go>)}</div>
          <div className="sortt" role="group" aria-label="정렬">{SEARCH_SORTS.map(([k, l]) => <Go key={k} {...selected(st.sort === k)} to={qs(base, { ...st, sort: k, type: 'work' })}>{l}</Go>)}</div>
        </div>
      )}
    </div>
  )
}

/** 서버 조회 실패는 빈 목록·0편으로 숨기지 않고 안내와 다시 불러오기로 보입니다. `what`은 조사까지 붙인 목록 이름입니다(소설을·세계관을·설정 카드를). */
const LoadError = ({ retry, what = '소설을' }: { retry: () => void; what?: string }) => (
  <div className="rp muted"><p role="alert">{what} 불러오지 못했어요. 잠시 후 다시 시도해 주세요.</p><button type="button" className="btn sm" onClick={retry}>다시 불러오기</button></div>
)

/** 서버 페이지를 이어 붙이는 버튼(마지막 페이지면 없음). 총 개수를 모르는 작품 탭이 씁니다. 실패해도 이미 보인 목록은 두고 이 버튼 곁에서 다시 시도하게 합니다. */
function LoadMore({ hasMore, loading, failed, load }: { hasMore: boolean; loading: boolean; failed: boolean; load: () => void }) {
  if (!hasMore) return null
  return (
    <div style={{ display: 'grid', justifyItems: 'center', gap: 8, marginTop: 24 }}>
      {failed && <p role="alert" className="muted small">소설을 더 불러오지 못했어요. 잠시 후 다시 시도해 주세요.</p>}
      <button type="button" className="btn" disabled={loading} onClick={load}>{loading ? '불러오는 중…' : failed ? '다시 시도' : '더 보기'}</button>
    </div>
  )
}

/**
 * 목업 wcard(w, i, ranked). 서버 작품은 다른 통계를 감추지만, updated는 마지막 업데이트 시각이 순위 기준인 카드라 그 시각을,
 * popular는 좋아요 수가 순위 기준인 카드라 서버 값인 좋아요 수를 보입니다.
 * 신고(`onReport`, 검색 결과 카드만)는 카드 위 오른쪽 모서리의 더보기 메뉴(#507)가 엽니다: 카드 밖에 따로 붙지 않아 카드 높이가 같고 버튼은 44px입니다.
 */
export function WCard({ w, i, ranked, updated, popular, onReport }: { w: Work; i: number; ranked?: boolean; updated?: boolean; popular?: boolean; onReport?: (w: Work) => void }) {
  const stats = w.statisticsSupported !== false
  const report = ranked ? undefined : onReport
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
      {report && (
        <PopMenu className="rg-more" label={`${w.title} 더보기`} icon={<MoreVerticalIcon />}>
          <button type="button" role="menuitem" aria-label={`${w.title} 소설 신고`} onClick={() => report(w)}><Flag /> 소설 신고</button>
        </PopMenu>
      )}
    </div>
  )
}

/** 탭마다 머리말(검색어가 없을 때)·입력 안내가 다르다. 작품 탭은 기존 '소설 검색'·안내 그대로다. 캐릭터챗은 검색하지 않아 머리말이 늘 '캐릭터챗'이고 입력도 없다. */
const NOUN: Record<Exclude<SearchTab, 'chat'>, string> = { all: '전체', work: '소설', world: '세계관', card: '설정 카드' }
const PLACEHOLDER = { all: '작품·세계관·설정 카드에서 찾기', work: '제목·작가·태그·장르로 찾기', world: '세계관 이름·설명·작가로 찾기', card: '설정 카드 제목·별칭·태그로 찾기' } as const
const NO_RESULT = '검색 결과가 없어요. 다른 검색어로 찾아 보세요.'

/** 머리말 옆 결과 수. 작품은 총 개수를 몰라 더 받을 수 있는 동안은 불러온 개수까지만 알리고, 세계관·설정 카드는 서버가 센 전체 수(total)다(다른 쪽을 읽는 동안에도 앞서 받은 수를 둔다). */
function countLabel(vm: ReturnType<typeof useSearchViewModel>) {
  if (vm.tab === 'work') return vm.list && !vm.isError ? `${vm.list.length}편${vm.more.hasMore ? ' 이상' : ''}` : null
  const r = vm.tab === 'world' ? vm.worlds : vm.tab === 'card' ? vm.cards : null
  return r && r.total !== null && !r.isError ? `${r.total}개` : null
}

/** 한 목록(탭 또는 전체 탭의 묶음)의 상태: 불러오는 중·실패(다시 불러오기)·결과 없음을 실제 결과대로 보이고, 결과가 있으면 children이 그린다. `what`은 조사까지 붙인 목록 이름이다. */
function ResultState<T>({ r, what, children }: {
  r: { list: T[] | undefined; isError: boolean; retry: () => void }
  what: string; children: (items: T[]) => ReactNode
}) {
  return r.isError ? <LoadError what={what} retry={r.retry} />
    : !r.list ? <div className="rp muted" role="status">{what} 불러오고 있어요…</div>
    : r.list.length ? children(r.list)
    : <div className="rp muted">{NO_RESULT}</div>
}

/**
 * 전체 탭의 한 묶음: 제목 옆에 그 탭으로 가는 '‘검색어’ 묶음이름 더 보기 ›' 링크(결과가 있을 때, 누르면 `onMore`로 결과 머리에 초점을 옮긴다)가 있고, 아래에 이 묶음만의 불러오는 중·실패·결과 없음·결과가 있다.
 * 묶음은 이름 붙은 영역(section)이라 한 묶음이 실패해도 나머지 묶음과 섞이지 않는다.
 */
function Group<T>({ tab, name, what, href, query, onMore, r, hint, children }: {
  tab: string; name: string; what: string; href: string; query: string; onMore: () => void
  r: { list: T[] | undefined; isError: boolean; retry: () => void }
  /** 요청 없이 이 안내만 보일 때(설정 카드는 검색어가 있어야 찾는다) */
  hint?: string; children: (items: T[]) => ReactNode
}) {
  const id = `search-group-${tab}`
  return (
    <section className="search-group" aria-labelledby={id}>
      <div className="sec-h">
        <h2 id={id}>{name}</h2>
        {!!r.list?.length && <Go to={href} className="more" onClick={onMore}>{`${query ? `‘${query}’ ` : ''}${name} 더 보기 ›`}</Go>}
      </div>
      {hint ? <div className="rp muted">{hint}</div> : <ResultState r={r} what={what}>{children}</ResultState>}
    </section>
  )
}

/** 캐릭터챗은 검색하지 않고 목록(/chat)으로 안내한다. 전체 탭의 묶음과 캐릭터챗 탭이 함께 쓴다. */
const ChatNotice = () => (
  <div className="rp muted">
    <p>목록은 누구나 볼 수 있고 대화는 로그인 후 할 수 있어요 · AI 응답은 데모</p>
    <Go to="/chat" className="btn sm">캐릭터챗 목록 보기</Go>
  </div>
)

const NEEDS_QUERY = '검색어를 입력하면 공개 세계관의 설정 카드를 찾아요.'

/**
 * 목업 searchPage(): U36. 대상 탭(전체·작품·세계관·설정 카드·캐릭터챗, 주소 `?type=`)을 머리말 아래에 두고 검색어는 탭을 옮겨도 이어 갑니다.
 * 전체는 작품·세계관·설정 카드를 묶음별로 몇 개씩 보이고, 세계관·설정 카드는 번호 쪽(`Pager`)이고, 작품은 '더 보기'입니다.
 * 범위·정렬은 작품 탭에만 있습니다. 캐릭터챗은 검색하지 않고 목록(/chat) 링크만 보입니다.
 */
export function SearchPage() {
  const vm = useSearchViewModel()
  useDocumentTitle('검색')
  const L = vm.list ?? []
  const count = countLabel(vm)
  const q = vm.st.q.trim()
  return (
    <>
      <Gnb />
      <main className="wrap" id="main" tabIndex={-1}>
        <div className="sec-h" style={{ marginBottom: 0 }}><h1 ref={vm.head} tabIndex={-1}>{vm.tab === 'chat' ? '캐릭터챗' : vm.st.q ? `‘${vm.st.q}’ 검색 결과` : `${NOUN[vm.tab]} 검색`}</h1>{count && <span className="muted small">{count}</span>}</div>
        <nav className="libtabs search-tabs" aria-label="검색 대상">{SEARCH_TABS.map(([k, l]) => <Go key={k} to={vm.tabHref(k)} {...selected(vm.tab === k)}>{l}</Go>)}</nav>
        {vm.tab !== 'chat' && <ListTools base="/search" st={vm.st} onSubmit={vm.submit} placeholder={PLACEHOLDER[vm.tab]} filters={vm.tab === 'work'} />}
        {vm.tab === 'all' && (
          <>
            <Group tab="work" name="작품" what="소설을" href={vm.tabHref('work')} query={q} onMore={vm.toHead} r={vm.groups.works}>
              {(works) => <div className="rgrid">{works.map((w, i) => <WCard key={w.id} w={w} i={i} onReport={vm.canReport(w) ? vm.setReporting : undefined} />)}</div>}
            </Group>
            <Group tab="world" name="세계관" what="세계관을" href={vm.tabHref('world')} query={q} onMore={vm.toHead} r={vm.groups.worlds}>
              {(worlds) => <WorldHits worlds={worlds} />}
            </Group>
            <Group tab="card" name="설정 카드" what="설정 카드를" href={vm.tabHref('card')} query={q} onMore={vm.toHead} r={vm.groups.cards} hint={vm.groups.cards.needsQuery ? NEEDS_QUERY : undefined}>
              {(hits) => <CardHits hits={hits} />}
            </Group>
            <section className="search-group" aria-labelledby="search-group-chat">
              <div className="sec-h"><h2 id="search-group-chat">캐릭터챗</h2></div>
              <ChatNotice />
            </section>
          </>
        )}
        {vm.tab === 'work' && (
          <>
            {!vm.list && !vm.isError && <ContentLoadState failed={false} retry={vm.retry}/>}
            <div className="rgrid" style={{ marginTop: 20 }}>
              {vm.isError ? <LoadError retry={vm.retry} /> : vm.list && (L.length ? L.map((w, i) => <WCard key={w.id} w={w} i={i} onReport={vm.canReport(w) ? vm.setReporting : undefined} />) : <div className="rp muted">검색 결과가 없어요. 다른 검색어나 범위로 찾아 보세요.</div>)}
            </div>
            <LoadMore {...vm.more} />
          </>
        )}
        {vm.tab === 'world' && (
          <div style={{ marginTop: 20 }}>
            <ResultState r={vm.worlds} what="세계관을">{(worlds) => <WorldHits worlds={worlds} />}</ResultState>
            <Pager page={vm.worlds.page} pages={vm.worlds.pages} onPage={vm.goPage} />
          </div>
        )}
        {vm.tab === 'card' && (vm.cards.needsQuery
          ? <div className="rp muted" style={{ marginTop: 20 }}>{NEEDS_QUERY}</div>
          : (
            <div style={{ marginTop: 20 }}>
              <ResultState r={vm.cards} what="설정 카드를">{(hits) => <CardHits hits={hits} />}</ResultState>
              <Pager page={vm.cards.page} pages={vm.cards.pages} onPage={vm.goPage} />
            </div>
          ))}
        {vm.tab === 'chat' && <div style={{ marginTop: 20 }}><ChatNotice /></div>}
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
              <Go className="th" to={`/work/${o.id}`} aria-label={`${o.title} 원작`}><Cov w={o} /></Go>
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
