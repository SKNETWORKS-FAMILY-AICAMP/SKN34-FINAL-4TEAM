import { useLayoutEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'

import { appContainer } from '../../../../app/appContainer'
import { useAppSelector } from '../../../../app/store'
import { hasMorePages, type PublicWorldCardHit, type PublicWorldSummary } from '../../../../domain/entities/publicWorld'
import { canReport, RANKING_KINDS, RANKING_PERIODS, RANKING_TYPES, rankingUsesPeriod, SEARCH_FIELDS, SEARCH_SORTS, SEARCH_TABS, type SearchField, type SearchSort, type SearchTab, type Work } from '../../../../domain/entities/work'
import type { PublicWorldUseCase } from '../../../../domain/usecases/PublicWorldUseCase'
import type { ReadingUseCase } from '../../../../domain/usecases/ReadingUseCase'
import { qs } from '../../../shared/format'
import { useScreenId } from '../../../shared/screenIds'
import { useAsyncData } from '../../../shared/useAsyncData'

const resolve = (): ReadingUseCase => appContainer.resolve('readingUseCase')
const resolveWorlds = (): PublicWorldUseCase => appContainer.resolve('publicWorldUseCase')

/**
 * 목업 listTools 검색 form: 검색어만 바꾸고 범위·정렬은 주소에 있던 값을 유지합니다.
 * 서버가 지원하는 범위(전체·제목·작가·태그·장르)·정렬(최신·인기=like·조회)만 읽고, 옛 주소의 sort=pop처럼 목록에 없는 값은 기본값으로 봅니다.
 * 대상 탭(`type`: 작품·세계관·설정 카드·캐릭터챗)은 모르는 값이면 작품입니다. 범위·정렬은 작품 탭의 것이지만, 다른 탭을 거쳐 작품 탭으로 돌아와도 잃지 않도록
 * 탭 링크(`tabHref`)와 검색 제출이 주소에 적힌 값을 그대로 이어 갑니다(다른 탭은 읽지 않고, 주소에 없으면 싣지 않습니다).
 */
function useListQuery(base: string, defaultSort: SearchSort) {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const Q = (k: string) => params.get(k) ?? ''
  const f = SEARCH_FIELDS.find(([k]) => k === Q('f'))?.[0] ?? 'all'
  const sort = SEARCH_SORTS.find(([k]) => k === Q('sort'))?.[0] ?? defaultSort
  const tab = SEARCH_TABS.find(([k]) => k === Q('type'))?.[0] ?? 'work'
  const kept = { q: Q('q'), f: Q('f'), sort: Q('sort') } // 주소에 적힌 그대로의 조건(없으면 빈 값이라 qs가 뺀다)
  const to = (target: SearchTab, q = kept.q) => qs(base, { ...kept, q, type: target === 'work' ? undefined : target })
  return { st: { q: kept.q, f, sort }, tab, tabHref: to, submit: (q: string) => navigate(to(tab, q.trim())) }
}

/** 한 쪽 응답: 이어 붙일 항목과 그 뒤에 더 있는지. `total`은 서버가 전체 수를 알려 줄 때만 있다(작품 검색은 모른다). */
type Paged<T> = { list: T[]; hasMore: boolean; total?: number }
/** 쪽을 읽는 방법: `page`쪽 요청(0이 첫 쪽)과 이어 붙일 때 겹침을 가르는 항목 키. */
type PageSource<T> = {
  fetch: (page: number, signal: AbortSignal) => Promise<Paged<T>>
  key: (item: T) => string
}
/** '더 보기'로 이어 받은 페이지들. base는 이것이 붙은 첫 페이지라, 첫 페이지를 다시 받으면 저절로 버려집니다. */
type Extra<T> = { base: Paged<T>; items: T[]; page: number; hasMore: boolean; total?: number; state: 'idle' | 'loading' | 'failed' }

/**
 * 검색 목록: 첫 서버 페이지 뒤에 '더 보기'로 다음 페이지를 이어 붙입니다. 검색어·범위·정렬·세션이 바뀌어 첫 페이지를
 * 다시 받으면 이어 붙인 것을 버리고 처음부터 보이며, 그때(또는 화면을 떠날 때) 진행 중인 더 보기는 취소하고 늦은 응답은 무시합니다.
 * 더 보기가 실패해도 이미 보인 목록은 두고, 같은 페이지를 다시 시도하게 합니다. 랭킹(/rank)은 페이지 없이 상위 50개라 쓰지 않습니다.
 * `enabled`가 아닌 탭의 목록은 요청하지 않습니다(`list`는 undefined). 작품·세계관·설정 카드 탭이 이 한 구현을 같이 씁니다.
 */
function usePagedList<T>(source: PageSource<T>, enabled: boolean, deps: readonly unknown[]) {
  const first = useAsyncData((signal) => (enabled ? source.fetch(0, signal) : Promise.resolve(undefined)), [...deps, enabled])
  const base = first.data
  const [stored, setExtra] = useState<Extra<T>>()
  const extra = base && stored?.base === base ? stored : undefined
  const pending = useRef<AbortController | null>(null)
  // 새 목록의 '더 보기'가 동작하기 전에 이전 목록의 요청을 취소한다.
  useLayoutEffect(() => () => { pending.current?.abort(); pending.current = null }, [base])
  const hasMore = !!base && !first.isError && (extra ?? base).hasMore
  const load = () => {
    if (!base || !hasMore || pending.current) return // 진행 중에는 다시 보내지 않는다.
    const prev = extra ?? { base, items: [], page: 1, hasMore: base.hasMore, total: base.total, state: 'idle' as const }
    const request = (pending.current = new AbortController())
    setExtra({ ...prev, state: 'loading' })
    source.fetch(prev.page, request.signal).then(
      (next) => {
        if (request.signal.aborted) return
        // 보는 사이 서버 목록이 밀려 겹친 항목은 다시 붙이지 않는다(key 중복 방지).
        const shown = new Set([...base.list, ...prev.items].map(source.key))
        setExtra({ base, items: [...prev.items, ...next.list.filter((item) => !shown.has(source.key(item)))], page: prev.page + 1, hasMore: next.hasMore, total: next.total, state: 'idle' })
      },
      () => { if (!request.signal.aborted) setExtra({ ...prev, state: 'failed' }) },
    ).finally(() => { if (pending.current === request) pending.current = null })
  }
  return {
    list: base && [...base.list, ...(extra?.items ?? [])], total: (extra ?? base)?.total ?? 0, isError: first.isError, retry: first.retry,
    more: { hasMore, loading: extra?.state === 'loading', failed: extra?.state === 'failed', load },
  }
}

const workSource = (readingUseCase: ReadingUseCase, query: { q: string; f: SearchField; sort: SearchSort }): PageSource<Work> => ({
  fetch: (page, signal) => readingUseCase.findWorks({ ...query, page }, signal),
  key: (w) => w.id,
})
/** 세계관·설정 카드 검색 응답(`total`이 있는 쪽 응답)을 이어 붙이는 한 쪽으로 바꾼다. 더 있는지는 받은 수가 total보다 적은지다. */
const toPaged = <T,>(answer: { items: T[]; page: number; size: number; total: number }): Paged<T> => ({ list: answer.items, hasMore: hasMorePages(answer), total: answer.total })
const worldSource = (useCase: PublicWorldUseCase, q: string): PageSource<PublicWorldSummary> => ({
  fetch: (page, signal) => useCase.searchWorlds({ q, page }, signal).then(toPaged),
  key: (w) => w.id,
})
const cardSource = (useCase: PublicWorldUseCase, q: string): PageSource<PublicWorldCardHit> => ({
  fetch: (page, signal) => useCase.searchCards({ q, page }, signal).then(toPaged),
  key: (hit) => `${hit.worldId}/${hit.cardId}`,
})

/**
 * 목업 searchPage(): U36. 대상 탭(`tab`)마다 목록이 따로이고 고른 탭만 요청합니다: 작품(`list`·`more` …, 기본), 세계관(`worlds`), 설정 카드(`cards`).
 * 세계관·설정 카드는 서버가 센 전체 수(`total`)가 있어 받은 수가 그보다 적을 때 '더 보기'가 남습니다. 설정 카드는 검색어가 필수라
 * 검색어가 비면 요청 없이 `needsQuery`로 알립니다. 캐릭터챗 탭은 검색하지 않습니다(화면이 목록 링크만 보입니다).
 */
export function useSearchViewModel(readingUseCase = resolve(), publicWorldUseCase = resolveWorlds()) {
  const { st, tab, tabHref, submit } = useListQuery('/search', 'latest')
  const q = st.q.trim()
  const works = usePagedList(workSource(readingUseCase, { q: st.q, f: st.f, sort: st.sort }), tab === 'work', [readingUseCase, st.q, st.f, st.sort])
  const worlds = usePagedList(worldSource(publicWorldUseCase, q), tab === 'world', [publicWorldUseCase, q])
  const cards = usePagedList(cardSource(publicWorldUseCase, q), tab === 'card' && q !== '', [publicWorldUseCase, q])
  const [report, setReport] = useState<{ work: Work; scope: string } | null>(null)
  const scope = [tab, st.q, st.f, st.sort].join('\n')
  // 검색 조건(탭·검색어·범위·정렬)이 바뀌면(뒤로 가기 등) 열려 있던 신고 시트를 닫는다: 새 목록에 없는 작품의 시트가 남지 않게 한다.
  if (report && report.scope !== scope) setReport(null)
  const memberId = useAppSelector((s) => s.session.memberId)
  useScreenId('U36')
  return {
    st, tab, tabHref, submit,
    list: works.list, isError: works.isError, retry: works.retry, more: works.more,
    worlds, cards: { ...cards, needsQuery: q === '' },
    /** 남의 공개 작품 카드에서만 신고 버튼을 보입니다. */
    canReport: (w: Work) => canReport(w, memberId),
    reporting: report?.work ?? null, setReporting: (w: Work | null) => setReport(w && { work: w, scope }),
  }
}

/**
 * 목업 rank(): U25. 범위(t)·기준(kind)·기간(period)은 주소 쿼리이고 모르는 값은 기본값(전체·조회 순·일간)으로 읽습니다.
 * computedAt은 서버 계산 시각이며 목업(메모리 정렬)은 null입니다. 기간은 최신·방금 업데이트와 목업에서 쓰지 않으므로
 * showPeriod가 false이고 화면은 기간 선택·문구를 숨깁니다.
 */
export function useRankViewModel(readingUseCase = resolve()) {
  const [params] = useSearchParams()
  const st = {
    t: RANKING_TYPES.find(([k]) => k === params.get('t'))?.[0] ?? 'all',
    kind: RANKING_KINDS.find(([k]) => k === params.get('kind'))?.[0] ?? 'view',
    period: RANKING_PERIODS.find(([k]) => k === params.get('period'))?.[0] ?? 'day',
  }
  const { data, isError, retry } = useAsyncData(() => readingUseCase.rankWorks(st), [readingUseCase, st.t, st.kind, st.period])
  useScreenId('U25')
  // ponytail: 불러오는 동안은 서버로 보고 기간을 보여 서버 모드의 기간 선택이 깜빡이지 않는다(목업은 응답이 오면 숨기므로 그 사이 한 프레임 보일 수 있다).
  const showPeriod = rankingUsesPeriod(st.kind) && (!data || data.computedAt !== null)
  return { st, list: data?.items, computedAt: data?.computedAt ?? null, showPeriod, isError, retry }
}

/** 목업 tagPage(t): U29 */
export function useTagViewModel(tag: string | undefined, readingUseCase = resolve()) {
  const state = useAsyncData(() => readingUseCase.getTag(tag), [readingUseCase, tag])
  useScreenId('U29')
  return state
}

/** 목업 ifs(): U26. 원작(w)이 없으면 화면이 /rank?t=if로 보냅니다. */
export function useIfsViewModel(readingUseCase = resolve()) {
  const [params] = useSearchParams()
  const w = params.get('w') ?? ''
  const sort = params.get('sort') || 'view'
  const { data: groups, isError, retry } = useAsyncData(() => readingUseCase.getForkCollection(w, sort), [readingUseCase, w, sort])
  useScreenId(w ? 'U26' : null)
  return { w, sort, groups, isError, retry }
}
