import { Component, lazy, Suspense, useId, useRef, type KeyboardEvent, type ReactNode, type Ref } from 'react'
import { useParams } from 'react-router'

import type { PublicWorld, PublicWorldLineage, PublicWorldRef, PublicWorldSummary } from '../../../../domain/entities/publicWorld'
import { Go } from '../../../shared/Go'
import { useScreenId } from '../../../shared/screenIds'
import { Footer, Gnb } from '../../../shared/shell/Gnb'
import { useDocumentTitle } from '../../../shared/useDocumentTitle'
import { CARD_COLORS } from '../../../shared/worldBoard'
import { WORLD_GENRES, genreLabel } from '../../../shared/worldGenres'
import { useWorldDetailViewModel, useWorldsViewModel } from '../viewmodel/useWorldsViewModel'
import { GENRE_COLORS, LINEAGE_COLORS, atlasFeatures, type AtlasNode, type WorldAtlas } from '../worldAtlas'
import { DETAIL_TABS, type DetailGraph, type DetailNode, type DetailTab } from '../worldDetail'
import { WorldBook } from './WorldBook'
import { DemoNotice, LoadFailed, WorldCover, WorldLoading } from './WorldParts'
import './worlds.css'

// react-force-graph(d3·canvas)는 지도·그래프를 볼 때만 내려받는다.
const WorldAtlasCanvas = lazy(() => import('./WorldAtlasCanvas'))
const WorldGraphCanvas = lazy(() => import('./WorldGraphCanvas'))

const meta = (w: Pick<PublicWorldRef, 'authorNickname' | 'cardCount'>) => `${w.authorNickname} · 설정 카드 ${w.cardCount}개`
// 홈 HomePage의 Chev·LEFT·RIGHT와 같은 화살표(홈 안에서만 쓰는 값이라 여기에 다시 둔다)
const Chev = ({ d }: { d: string }) => <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d={d} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
const LEFT = 'M15 5l-7 7 7 7'
const RIGHT = 'M9 5l7 7-7 7'

/** 홈 `BookCard`와 같은 책 카드. `badge`는 표지 오른쪽 아래 알약이다. */
const WorldCard = ({ w, k, badge }: { w: PublicWorldRef; k: string; badge?: string }) => (
  <Go to={`/worlds/${w.id}`} className="bk prox"><WorldCover w={w} k={k} badge={badge} /><h3 className="hk">{w.name}</h3><small>{meta(w)}</small></Go>
)

/** 캔버스를 내려받거나 그리다 실패해도 이 화면의 나머지는 그대로 쓰게 한다. `message`는 그때 대신 보일 안내(찾을 다른 길)다. */
class AtlasBoundary extends Component<{ children: ReactNode; message: string }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    return this.state.failed ? <p className="atlas-fail" role="alert">{this.props.message}</p> : this.props.children
  }
}

/** 파생·조합 선 모양: 실선 화살표와 점선 화살표 */
const LineKey = ({ kind }: { kind: keyof typeof LINEAGE_COLORS }) => (
  <svg viewBox="0 0 28 10" width="28" height="10" aria-hidden="true">
    <line x1="1" y1="5" x2="21" y2="5" stroke={LINEAGE_COLORS[kind]} strokeWidth="2" strokeLinecap="round" strokeDasharray={kind === 'combine' ? '4 3' : undefined} />
    <path d="M21 1.5 27 5 21 8.5z" fill={LINEAGE_COLORS[kind]} />
  </svg>
)

/**
 * 지도 카드 아래쪽의 작은 범례: 장르 색 · 설정 카드 유형 색 · 파생/조합 선 모양. 묶음째 줄바꿈하고, 좁은 화면에서는 한 줄로 두어 옆으로 밀어 본다.
 * 카드 점이 없는 서버 목록 지도는 카드 유형 색을, 파생·조합이 없으면 연결 선을 보이지 않는다(그리지 않는 것을 설명하지 않는다).
 */
const AtlasLegend = ({ features }: { features: ReturnType<typeof atlasFeatures> }) => (
  <div className="atlas-legend" role="group" aria-label="지도 범례">
    <ul aria-label="장르 색">{WORLD_GENRES.map((g) => <li key={g}><i style={{ background: GENRE_COLORS[g] }} />{g}</li>)}</ul>
    {features.cards && <ul aria-label="설정 카드 유형 색">{Object.entries(CARD_COLORS).map(([kind, color]) => <li key={kind}><i className="dot" style={{ background: color }} />{kind}</li>)}</ul>}
    {features.lineage && <ul aria-label="연결 선"><li><LineKey kind="derive" />파생</li><li><LineKey kind="combine" />조합</li></ul>}
  </div>
)

/**
 * 홈 상단의 히어로 자리(`.herow` 왼쪽)에 놓는 'STORYFORK 세계관 지도' 카드. 공개 세계관이 장르별로 모인 모습(파생·조합이 있는 데모는 이어진 모습)을 한 장의 노드 그래프로 보여 준다.
 * 홈 `.hero` 클래스를 그대로 써서 `.herow`의 칸 맞춤(min-width: 0)·좁은 화면 세로 쌓기를 따른다. 통계 줄과 범례는 카드 아래쪽에 작게 둔다.
 * `total`이 지도에 올린 수보다 크면 최근 공개 순 앞쪽만 올린 것이라 통계 줄이 그렇게 알린다.
 * 마우스로만 쓰는 시각 탐색이라 같은 세계관은 아래 선반·모아 보기에서도 목록으로 찾을 수 있다.
 */
function WorldAtlasSection({ atlas, lit, total, onOpen }: { atlas: WorldAtlas; lit?: ReadonlySet<string>; total: number; onOpen: (node: AtlasNode) => void }) {
  const { worlds, cards, derived, combined } = atlas.stats
  const features = atlasFeatures(atlas)
  return (
    <section className="hero worlds-atlas" aria-labelledby="world-atlas-heading">
      <div className="atlas-stage">
        <h2 id="world-atlas-heading" className="atlas-title">STORYFORK 세계관 지도</h2>
        <AtlasBoundary message="지도를 표시하지 못했어요. 아래 선반과 세계관 모아 보기에서 세계관을 찾아보세요.">
          <Suspense fallback={<p className="atlas-loading" role="status">세계관 지도를 불러오고 있어요.</p>}>
            <WorldAtlasCanvas atlas={atlas} lit={lit} onOpen={onOpen} />
          </Suspense>
          <div className="atlas-info">
            <p className="atlas-stats">{`${worlds < total ? `공개 세계관 ${total}개 중 최근 ${worlds}개` : `공개 세계관 ${worlds}개`} · 설정 카드 ${cards}개${features.lineage ? ` · 파생 ${derived} · 조합 ${combined}` : ''}`}</p>
            <AtlasLegend features={features} />
          </div>
        </AtlasBoundary>
      </div>
      <p className="sr-only">지도는 눈으로 훑어보는 용도예요. 같은 세계관은 실시간 인기 순위와 아래 선반, 세계관 모아 보기에서 목록으로 찾을 수 있어요.</p>
    </section>
  )
}

const RANK_BASIS = {
  lineage: { badge: '파생·조합 순', title: '파생·조합된 횟수 순, 같으면 설정 카드 수 순' },
  recent: { badge: '최근 공개 순', title: '최근 공개된 순' },
} as const

/**
 * 홈 `Top10`과 같은 마크업·클래스(`aside.t10`·`t10h`·`live`·`more`)의 '실시간 인기' 세계관 순위 패널.
 * 조회수가 없어 서버 목록은 최근 공개 순, 파생·조합이 있는 데모는 파생·조합된 횟수 순(같으면 설정 카드 수 순)이고 배지가 그 기준을 알린다. 더보기는 이동할 곳이 없어 아래 '세계관 모아 보기'로 내려간다.
 */
function LiveRank({ ranked, basis, onMore }: { ranked: readonly PublicWorldSummary[]; basis: keyof typeof RANK_BASIS; onMore: () => void }) {
  return (
    <aside className="t10" aria-label="실시간 인기 세계관">
      <div className="t10h">
        <h2>실시간 인기</h2>
        <span className="live" title={RANK_BASIS[basis].title}>{RANK_BASIS[basis].badge}</span>
        <button type="button" className="more" onClick={onMore}>더보기 ›</button>
      </div>
      <ol>
        {ranked.map((w, i) => (
          <li key={w.id}>
            <Go to={`/worlds/${w.id}`}>
              <span className={i < 3 ? `n md md${i + 1}` : 'n'}>{i + 1}</span>
              <span className="tx"><b>{w.name}</b><small>{w.authorNickname}</small></span>
            </Go>
          </li>
        ))}
      </ol>
    </aside>
  )
}

/** 홈 '오늘, 스토리포크의 발견'과 같은 가로 선반. 화살표는 좁은 화면에서 CSS가 숨기고 손가락 스크롤을 쓴다. */
function WorldRail({ title, worlds, k }: { title: string; worlds: readonly PublicWorldSummary[]; k: string }) {
  const row = useRef<HTMLDivElement>(null)
  const scroll = (d: number) => row.current?.scrollBy({ left: d * row.current.clientWidth * 0.8, behavior: 'smooth' })
  return (
    <section className="sec">
      <div className="sec-h"><h2>{title}</h2></div>
      <div className="shelf">
        <button type="button" className="arr l" aria-label={`${title} 이전 보기`} onClick={() => scroll(-1)}><Chev d={LEFT} /></button>
        <div className="row" ref={row}>{worlds.map((w) => <WorldCard key={w.id} w={w} k={k} />)}</div>
        <button type="button" className="arr r" aria-label={`${title} 다음 보기`} onClick={() => scroll(1)}><Chev d={RIGHT} /></button>
      </div>
    </section>
  )
}

type Listing = { worlds: readonly PublicWorldSummary[]; total: number; isLoading: boolean; isError: boolean; retry: () => void }

/**
 * 홈의 필터 결과·소설 모아 보기와 같은 격자. 장르 칩이면 그 장르 쿼리를 따로 읽으므로 이 목록의 불러오는 중·실패(다시 시도)를 여기서 알린다.
 * 서버가 센 전체 수(`total`)가 불러온 수보다 크면 최근 공개 순 앞쪽만 보인다고 머리에 적는다.
 */
function WorldGrid({ title, list, sectionRef }: { title: string; list: Listing; sectionRef?: Ref<HTMLElement> }) {
  const shown = list.worlds.length
  return (
    <section className="sec" ref={sectionRef} tabIndex={-1}>
      <div className="sec-h">
        <h2>{title}</h2>
        {!list.isLoading && !list.isError && <span className="muted small">{shown < list.total ? `최근 공개 ${shown}개 · 전체 ${list.total}개` : `${shown}개`}</span>}
      </div>
      {list.isLoading ? <WorldLoading what="세계관 목록" />
        : list.isError ? <LoadFailed what="세계관 목록" onRetry={list.retry} />
        : shown ? <div className="grid6">{list.worlds.map((w) => <WorldCard key={w.id} w={w} k="g" />)}</div>
        : <p className="muted" role="status">이 장르의 공개 세계관이 아직 없어요.</p>}
    </section>
  )
}

/**
 * 공개 세계관 추천 대시보드(`/worlds`). 홈과 같은 칩 줄 아래에 홈 상단과 같은 2단(왼쪽 세계관 지도 · 오른쪽 '실시간 인기' 순위)을 두고,
 * Content 공개 세계관 API(`--mode mockup`은 메모리 데모)의 목록을 보인다. 로그인 없이 볼 수 있고, 불러오는 중·실패(다시 시도)·공개된 세계관이 없을 때를 따로 그린다.
 */
export function WorldsPage() {
  useScreenId('W02')
  useDocumentTitle('세계관')
  const vm = useWorldsViewModel()
  const all = useRef<HTMLElement>(null)
  const showAll = () => {
    all.current?.scrollIntoView()
    all.current?.focus({ preventScroll: true })
  }
  return (
    <>
      <Gnb on="worlds" />
      <main className="wrap worlds" id="main" tabIndex={-1}>
        <h1 className="sr-only">공개 세계관</h1>
        <div className="chips" role="group" aria-label="장르 필터">
          {vm.chips.map((c) => <button type="button" key={c.genre} className={vm.chip === c.genre ? 'on' : ''} aria-pressed={vm.chip === c.genre} onClick={() => vm.selectChip(c.genre)}>{c.label}</button>)}
        </div>
        {vm.demo && <DemoNotice />}
        {vm.isLoading ? <WorldLoading what="공개 세계관" />
          : vm.isError ? <LoadFailed what="공개 세계관" onRetry={vm.retry} />
          : !vm.atlas || vm.empty ? (
            <div className="worlds-state">
              <p>아직 공개된 세계관이 없어요 · 내 서재에서 세계관을 공개해 보세요</p>
              <Go to="/lib?tab=worlds" className="btn">내 서재의 세계관으로 가기</Go>
            </div>
          ) : (
            <>
              <div className="herow">
                <WorldAtlasSection atlas={vm.atlas} lit={vm.lit} total={vm.total} onOpen={vm.openAtlasNode} />
                {vm.rankBasis && <LiveRank ranked={vm.liveRank} basis={vm.rankBasis} onMore={showAll} />}
              </div>
              {vm.filtered ? <WorldGrid title={vm.heading} list={vm.list} sectionRef={all} /> : (
                <>
                  <WorldRail title="새로 공개된 세계관" worlds={vm.newest} k="n" />
                  <WorldGrid title="세계관 모아 보기" list={vm.list} sectionRef={all} />
                </>
              )}
            </>
          )}
      </main>
      <Footer />
    </>
  )
}

/** 탭 목록의 방향키·Home·End로 탭을 옮긴다(끝에서는 돌아서 이어짐, 소설 상세 탭과 같은 방식). 포커스가 있는 탭에서 옮기고 선택한 탭만 Tab 순서에 들어간다. */
function DetailTabBar({ tab, onTab }: { tab: DetailTab; onTab: (next: DetailTab) => void }) {
  const move = (e: KeyboardEvent<HTMLDivElement>) => {
    const tabs = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')]
    const at = tabs.findIndex((t) => t === e.target)
    const to = e.key === 'ArrowRight' ? at + 1 : e.key === 'ArrowLeft' ? at - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : null
    if (to === null) return
    e.preventDefault()
    const next = (to + tabs.length) % tabs.length
    onTab(DETAIL_TABS[next][0])
    tabs[next].focus()
  }
  return (
    <div className="libtabs" role="tablist" aria-label="세계관 상세 탭" onKeyDown={move}>
      {DETAIL_TABS.map(([key, label]) => (
        <button key={key} type="button" role="tab" id={`world-tab-${key}`} className={tab === key ? 'on' : ''} aria-selected={tab === key} aria-controls="world-panel" tabIndex={tab === key ? 0 : -1} onClick={() => onTab(key)}>{label}</button>
      ))}
    </div>
  )
}

/**
 * 상세의 그래프 카드 한 장. 세계관 지도 카드와 같은 어두운 캔버스(`.atlas-stage`)·컨트롤·통계 줄이고 캔버스만 더 높다(데스크톱 460px·모바일 340px).
 * 마우스로만 쓰는 시각 탐색이라 같은 내용은 설정집 탭의 카드 목록과 카드 페이지가 글로 대신한다.
 */
function GraphCard({ title, mode, data, summary, stats, legend, onOpen }: {
  title: string; mode: 'setting' | 'people'; data: DetailGraph; summary: string; stats: string; legend?: ReactNode; onOpen: (node: DetailNode) => void
}) {
  const heading = useId()
  return (
    <section className="worlds-graph" aria-labelledby={heading}>
      <div className="atlas-stage">
        <h2 id={heading} className="atlas-title">{title}</h2>
        <AtlasBoundary message="그래프를 표시하지 못했어요. 설정집 탭에서 설정 카드를 열어 같은 내용을 글로 읽을 수 있어요.">
          <Suspense fallback={<p className="atlas-loading" role="status">그래프를 불러오고 있어요.</p>}>
            <WorldGraphCanvas data={data} mode={mode} summary={summary} onOpen={onOpen} />
          </Suspense>
          <div className="atlas-info">
            <p className="atlas-stats">{stats}</p>
            {legend}
          </div>
        </AtlasBoundary>
      </div>
      <p className="sr-only">그래프는 눈으로 훑어보는 용도예요. 같은 내용은 설정집 탭의 설정 카드에서 글로 읽을 수 있어요.</p>
    </section>
  )
}

const linkCount = (graph: DetailGraph) => graph.links.filter((l) => l.kind === 'link').length

/** 홈 선반과 같은 섹션 머리(`.sec`·`.sec-h`)와 가로 선반(`.shelf`·`.row`). 카드 수가 적어 이전·다음 화살표는 두지 않는다. 카드가 없으면 `empty` 안내를 보인다. */
function Shelf({ title, empty, children }: { title: string; empty?: string; children: ReactNode[] }) {
  return (
    <section className="sec">
      <div className="sec-h"><h2>{title}</h2></div>
      {children.length ? <div className="shelf"><div className="row">{children}</div></div> : <p className="muted">{empty}</p>}
    </section>
  )
}

/**
 * 이 세계관을 쓴 작품(데모). 서버에 작품-세계관 연결이 없어(`works`가 없는 실제 모드) 준비 중 안내만 보이고, 데모는 실제 작품이 아니라 링크하지 않고(가짜 이동 금지) 표지에 '데모 작품'을 단다.
 */
function WorldWorks({ world }: { world: PublicWorld }) {
  return (
    <Shelf title="이 세계관을 쓴 작품" empty={world.works ? '아직 이 세계관으로 쓴 작품이 없어요' : '작품 연결 기능 준비 중'}>
      {(world.works ?? []).map((work, i) => (
        <div key={work.title} className="bk">
          <WorldCover w={{ id: `${world.id}-work${i}`, genre: work.genre }} k="w" badge="데모 작품" />
          <h3 className="hk">{work.title}</h3>
          <small>{work.author} · {work.episodes}화</small>
        </div>
      ))}
    </Shelf>
  )
}

/**
 * 연결된 세계관: 원본(이 세계관의 출처)과 파생·조합된 세계관을 한 선반에 표지 알약('원본'·'파생'·'조합')과 함께 보인다.
 * 계보가 있는 데모는 이어진 세계관이 없으면 섹션을 그리지 않고, 계보가 없는 실제 모드는 준비 중 안내를 보인다(파생·조합은 아직 서버에 없다).
 */
function ConnectedWorlds({ lineage }: { lineage?: PublicWorldLineage }) {
  const sources = lineage ? [...(lineage.derivedFrom ? [lineage.derivedFrom] : []), ...lineage.combinedFrom].map((w) => ({ w, label: '원본' })) : []
  const derived = lineage ? lineage.children.map(({ kind, ...w }) => ({ w, label: kind === 'derive' ? '파생' : '조합' })) : []
  const items = [...sources, ...derived]
  if (lineage && !items.length) return null
  return <Shelf title="연결된 세계관" empty="파생·조합 기능 준비 중">{items.map(({ w, label }) => <WorldCard key={`${label}-${w.id}`} w={w} k="r" badge={label} />)}</Shelf>
}

/**
 * 공개 세계관 상세(`/worlds/:id`). 제목·(데모는 한 줄 소개)·작가 아래에 세 탭(설정 그래프 · 인물관계도 · 설정집)을 두고 읽기만 한다(편집·복사 없음).
 * 설정집은 카테고리별 설정 카드 게시판이고, 그래프의 카드·인물 노드를 누르면 그 설정 카드의 페이지(`/worlds/:id/cards/:cardId`)로 이동한다.
 * 관계를 불러오지 못했으면(`relationshipStatus: unavailable`) 인물관계도 탭이 빈 그래프와 구분해 알린다. 어느 탭이든 탭 영역 아래에 '이 세계관을 쓴 작품'과 '연결된 세계관' 선반이 있다
 * (서버에 없는 실제 모드는 준비 중 안내). 불러오는 중·실패(다시 시도)·비공개·없는 세계관(찾을 수 없음)을 따로 그린다.
 */
export function WorldDetailPage() {
  const { id } = useParams()
  const { detail, isLoading, isError, retry, tab, setTab, openNode } = useWorldDetailViewModel(id)
  useScreenId('W03')
  useDocumentTitle(detail ? detail.world.name : isLoading || isError ? '세계관' : '찾을 수 없는 세계관')
  const world = detail?.world
  const unavailable = world?.relationshipStatus === 'unavailable'
  return (
    <>
      <Gnb on="worlds" />
      <main className="wrap worlds" id="main" tabIndex={-1}>
        {detail && world ? (
          <>
            <Go to="/worlds" className="btn sm">← 공개 세계관으로 돌아가기</Go>
            {world.demo && <DemoNotice />}
            <header className="worlds-head">
              <h1>{world.name}</h1>
              {world.hook && <p className="worlds-hook">{world.hook}</p>}
              <p className="muted small">작가 {world.authorNickname} · 읽기 전용</p>
            </header>
            <DetailTabBar tab={tab} onTab={setTab} />
            <div role="tabpanel" id="world-panel" aria-labelledby={`world-tab-${tab}`} key={world.id}>
              {tab === 'book' ? <WorldBook world={world} />
                : tab === 'people' ? (
                  <>
                    {world.demo && <p className="muted small worlds-people-notice">데모 · 공개 범위 확정 전</p>}
                    {unavailable
                      ? <p className="muted">관계를 불러오지 못했어요. 인물 사이의 관계는 잠시 뒤 다시 열어 보면 보일 수 있어요.</p>
                      : detail.people.nodes.length < 2
                        ? <p className="muted">인물이 2명 이상 공개돼야 인물관계도를 보여 줄 수 있어요. 이 세계관에는 지금 공개된 인물이 {detail.people.nodes.length}명이에요.</p>
                        : <GraphCard title="인물관계도" mode="people" data={detail.people} onOpen={openNode}
                            summary={`${world.name}의 인물 ${detail.people.nodes.length}명이 ${linkCount(detail.people)}개의 관계로 이어진 관계도`}
                            stats={`인물 ${detail.people.nodes.length}명 · 관계 ${linkCount(detail.people)}개`} />}
                  </>
                ) : (
                  <GraphCard title="설정 그래프" mode="setting" data={detail.setting} onOpen={openNode}
                    summary={unavailable ? `${world.name}의 설정 카드 ${world.cards.length}개 그래프(연결 정보를 불러오지 못함)` : `${world.name}의 설정 카드 ${world.cards.length}개가 ${linkCount(detail.setting)}개의 연결로 이어진 그래프`}
                    stats={`설정 카드 ${world.cards.length}개 · ${unavailable ? '연결 정보를 불러오지 못했어요' : `연결 ${linkCount(detail.setting)}개`}`}
                    legend={(
                      <div className="atlas-legend" role="group" aria-label="그래프 범례">
                        <ul aria-label="그래프 노드 색">
                          <li><i style={{ background: GENRE_COLORS[genreLabel(world.genre)] }} />세계관</li>
                          {detail.kinds.map(({ kind }) => <li key={kind}><i style={{ background: CARD_COLORS[kind] }} />{kind}</li>)}
                        </ul>
                      </div>
                    )} />
                )}
            </div>
            <WorldWorks key={`works-${world.id}`} world={world} />
            <ConnectedWorlds key={`related-${world.id}`} lineage={world.lineage} />
          </>
        ) : isLoading ? <WorldLoading what="세계관" />
          : isError ? <LoadFailed what="세계관" onRetry={retry} />
          : (
            <>
              <h1>찾을 수 없는 세계관</h1>
              <p className="muted worlds-note">주소가 바뀌었거나 공개가 중단된 세계관일 수 있어요.</p>
              <Go to="/worlds" className="btn">공개 세계관 보러 가기</Go>
            </>
          )}
      </main>
      <Footer />
    </>
  )
}
