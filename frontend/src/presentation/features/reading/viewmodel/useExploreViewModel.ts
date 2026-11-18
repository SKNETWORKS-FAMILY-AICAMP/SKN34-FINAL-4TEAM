import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'

import { appContainer } from '../../../../app/appContainer'
import { useAppSelector } from '../../../../app/store'
import { canReport, RANKING_KINDS, RANKING_PERIODS, RANKING_TYPES, rankingUsesPeriod, SEARCH_FIELDS, SEARCH_SORTS, searchTabOf, type SearchField, type SearchSort, type SearchTab, type Work } from '../../../../domain/entities/work'
import type { PublicWorldUseCase } from '../../../../domain/usecases/PublicWorldUseCase'
import type { ReadingUseCase } from '../../../../domain/usecases/ReadingUseCase'
import { qs } from '../../../shared/format'
import { pageParam } from '../../../shared/paginate'
import { useScreenId } from '../../../shared/screenIds'
import { useAsyncData } from '../../../shared/useAsyncData'

const resolve = (): ReadingUseCase => appContainer.resolve('readingUseCase')
const resolveWorlds = (): PublicWorldUseCase => appContainer.resolve('publicWorldUseCase')

/** 전체 탭이 묶음(작품·세계관·설정 카드)마다 보이는 개수 */
const GROUP_SIZE = 6

/**
 * 목업 listTools 검색 form: 검색어만 바꾸고 범위·정렬은 주소에 있던 값을 유지합니다.
 * 서버가 지원하는 범위(전체·제목·작가·태그·장르)·정렬(최신·인기=like·조회)만 읽고, 옛 주소의 sort=pop처럼 목록에 없는 값은 기본값으로 봅니다.
 * 대상 탭(`type`: 전체·작품·세계관·설정 카드·캐릭터챗)은 `searchTabOf`가 정합니다: 없거나 모르는 값이면 전체이고, 단 범위(f)·정렬(sort)이 주소에 있으면(탭이 생기기 전의 작품 검색 링크) 작품입니다.
 * 범위·정렬은 작품 탭의 것이지만, 다른 탭을 거쳐 작품 탭으로 돌아와도 잃지 않도록 탭 링크(`tabHref`)와 검색 제출이 주소에 적힌 값을 그대로 이어 갑니다(다른 탭은 읽지 않고, 주소에 없으면 싣지 않습니다).
 * 쪽(`page`, 1부터)은 세계관·설정 카드 탭의 번호 쪽입니다. 탭 링크·검색 제출은 늘 1쪽(주소에 싣지 않음)으로 가고, 쪽 이동(`to`의 세 번째 값)만 싣습니다.
 */
function useListQuery(base: string, defaultSort: SearchSort) {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const Q = (k: string) => params.get(k) ?? ''
  const f = SEARCH_FIELDS.find(([k]) => k === Q('f'))?.[0] ?? 'all'
  const sort = SEARCH_SORTS.find(([k]) => k === Q('sort'))?.[0] ?? defaultSort
  const kept = { q: Q('q'), f: Q('f'), sort: Q('sort') } // 주소에 적힌 그대로의 조건(없으면 빈 값이라 qs가 뺀다)
  const tab = searchTabOf(params.get('type'), kept.f !== '' || kept.sort !== '')
  const to = (target: SearchTab, q = kept.q, page = 1) => qs(base, { ...kept, q, type: target, page: page > 1 ? String(page) : undefined })
  return { st: { q: kept.q, f, sort }, tab, page: pageParam(params.get('page')), to, tabHref: (target: SearchTab) => to(target), submit: (q: string) => navigate(to(tab, q.trim())) }
}

/** 한 쪽 응답: 이어 붙일 항목과 그 뒤에 더 있는지. */
type Paged<T> = { list: T[]; hasMore: boolean }
/** 쪽을 읽는 방법: `page`쪽 요청(0이 첫 쪽)과 이어 붙일 때 겹침을 가르는 항목 키. */
type PageSource<T> = {
  fetch: (page: number, signal: AbortSignal) => Promise<Paged<T>>
  key: (item: T) => string
}
/** '더 보기'로 이어 받은 페이지들. base는 이것이 붙은 첫 페이지라, 첫 페이지를 다시 받으면 저절로 버려집니다. */
type Extra<T> = { base: Paged<T>; items: T[]; page: number; hasMore: boolean; state: 'idle' | 'loading' | 'failed' }

/**
 * 검색 목록: 첫 서버 페이지 뒤에 '더 보기'로 다음 페이지를 이어 붙입니다. 검색어·범위·정렬·세션이 바뀌어 첫 페이지를
 * 다시 받으면 이어 붙인 것을 버리고 처음부터 보이며, 그때(또는 화면을 떠날 때) 진행 중인 더 보기는 취소하고 늦은 응답은 무시합니다.
 * 더 보기가 실패해도 이미 보인 목록은 두고, 같은 페이지를 다시 시도하게 합니다. 랭킹(/rank)은 페이지 없이 상위 50개라 쓰지 않습니다.
 * `enabled`가 아닌 탭의 목록은 요청하지 않습니다(`list`는 undefined). 작품 탭이 이 구현을 쓰고, 전체 탭의 작품 묶음도 같은 첫 페이지를 나눠 씁니다
 * (두 탭을 오가도 같은 검색이면 다시 읽지 않는다). 총 개수를 모르는 작품 검색만 이렇게 이어 붙이고, 세계관·설정 카드는 번호 쪽(`useNumberedList`)입니다.
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
    const prev = extra ?? { base, items: [], page: 1, hasMore: base.hasMore, state: 'idle' as const }
    const request = (pending.current = new AbortController())
    setExtra({ ...prev, state: 'loading' })
    source.fetch(prev.page, request.signal).then(
      (next) => {
        if (request.signal.aborted) return
        // 보는 사이 서버 목록이 밀려 겹친 항목은 다시 붙이지 않는다(key 중복 방지).
        const shown = new Set([...base.list, ...prev.items].map(source.key))
        setExtra({ base, items: [...prev.items, ...next.list.filter((item) => !shown.has(source.key(item)))], page: prev.page + 1, hasMore: next.hasMore, state: 'idle' })
      },
      () => { if (!request.signal.aborted) setExtra({ ...prev, state: 'failed' }) },
    ).finally(() => { if (pending.current === request) pending.current = null })
  }
  return {
    list: base && [...base.list, ...(extra?.items ?? [])], isError: first.isError, retry: first.retry,
    more: { hasMore, loading: extra?.state === 'loading', failed: extra?.state === 'failed', load },
  }
}

const workSource = (readingUseCase: ReadingUseCase, query: { q: string; f: SearchField; sort: SearchSort }): PageSource<Work> => ({
  fetch: (page, signal) => readingUseCase.findWorks({ ...query, page }, signal),
  key: (w) => w.id,
})

/**
 * 세계관·설정 카드 검색을 `page`쪽(1부터) 읽습니다(전체 탭 묶음은 늘 1쪽·6개). 서버가 센 전체 수(`total`)로 쪽 수(`pages`)를 만듭니다.
 * 쪽만 바뀌면 같은 목록을 다시 읽는 것이라(`refresh`) 앞서 받은 `total`이 남아 읽는 중·실패에도 번호 줄이 그대로 있고, 목록(`list`)은 요청한 쪽의 응답일 때만 보입니다(이전 쪽 항목을 남겨 두지 않는다).
 * 검색어·탭이 바뀌면(`deps`) 모두 버리고 처음부터 읽고, 쪽을 옮기거나 화면을 떠나면 이전 요청은 취소하고 늦은 응답은 무시합니다. `enabled`가 아니면 요청하지 않습니다.
 * `beyond`: 마지막 쪽을 넘은 쪽을 읽어 빈 쪽이 왔는데 total이 남은 경우(목록이 줄었거나 주소를 고침). 결과 없음으로 보이지 않게 `list`를 비워 두고 화면이 마지막 쪽으로 바꾼다.
 */
function useNumberedList<T>(load: (signal: AbortSignal) => Promise<{ items: T[]; size: number; total: number }>, enabled: boolean, deps: readonly unknown[], page: number) {
  const { data, isError, retry } = useAsyncData(async (signal) => (enabled ? { page, answer: await load(signal) } : undefined), [...deps, enabled], [page])
  const answer = data?.answer
  const total = answer?.total ?? null
  const pages = answer ? Math.max(1, Math.ceil(answer.total / Math.max(1, answer.size))) : 1
  const fresh = data?.page === page ? answer : undefined
  const beyond = !!fresh && fresh.items.length === 0 && fresh.total > 0 && page > pages
  return { list: fresh && !beyond ? fresh.items : undefined, total, page, pages, beyond, isError, retry }
}

/**
 * 목업 searchPage(): U36. 대상 탭(`tab`)마다 보이는 것이 다르고 고른 탭의 것만 요청합니다.
 * - 작품(`list`·`more` …): 총 개수를 몰라 '더 보기'로 이어 붙입니다.
 * - 세계관(`worlds`)·설정 카드(`cards`): 번호 쪽(`page`·`pages`·`goPage`)입니다. 설정 카드는 검색어가 필수라 검색어가 비면 요청 없이 `needsQuery`로 알립니다.
 * - 전체(`groups`): 작품·세계관·설정 카드를 묶음마다 따로 읽고(앞 6개씩, 한 묶음의 실패·다시 시도가 다른 묶음에 번지지 않는다) 각 묶음의 더 보기 링크는 `tabHref`입니다.
 * - 캐릭터챗: 검색하지 않습니다(화면이 목록 링크만 보입니다).
 * `head`는 결과 머리(제목)입니다. 쪽을 옮기면(`goPage`) 주소의 `page`를 바꾸고, 쪽을 옮기거나 전체 탭의 더 보기 링크를 누르면(`toHead`) 거기로 스크롤하고 초점을 옮깁니다.
 */
export function useSearchViewModel(readingUseCase = resolve(), publicWorldUseCase = resolveWorlds()) {
  const { st, tab, page, to, tabHref, submit } = useListQuery('/search', 'latest')
  const navigate = useNavigate()
  const q = st.q.trim()
  const works = usePagedList(workSource(readingUseCase, { q: st.q, f: st.f, sort: st.sort }), tab === 'work' || tab === 'all', [readingUseCase, st.q, st.f, st.sort])
  const worlds = useNumberedList((signal) => publicWorldUseCase.searchWorlds({ q, page: page - 1 }, signal), tab === 'world', [publicWorldUseCase, q], page)
  const cards = useNumberedList((signal) => publicWorldUseCase.searchCards({ q, page: page - 1 }, signal), tab === 'card' && q !== '', [publicWorldUseCase, q], page)
  const groupWorlds = useNumberedList((signal) => publicWorldUseCase.searchWorlds({ q, page: 0, size: GROUP_SIZE }, signal), tab === 'all', [publicWorldUseCase, q], 1)
  const groupCards = useNumberedList((signal) => publicWorldUseCase.searchCards({ q, page: 0, size: GROUP_SIZE }, signal), tab === 'all' && q !== '', [publicWorldUseCase, q], 1)
  const head = useRef<HTMLHeadingElement>(null)
  /** 결과 머리(제목)로 스크롤하고 초점을 옮긴다. 쪽을 옮기거나 전체 탭의 더 보기 링크를 눌러(링크가 사라진다) 다른 탭으로 갈 때 보던 자리와 초점을 잃지 않게 한다. */
  const toHead = () => {
    head.current?.scrollIntoView?.({ block: 'start' }) // jsdom에는 scrollIntoView가 없다
    head.current?.focus({ preventScroll: true })
  }
  const goPage = (next: number) => {
    if (next !== page) navigate(to(tab, st.q, next)) // 지금 쪽을 다시 눌러도 기록을 쌓지 않는다
    toHead()
  }
  // 마지막 쪽을 넘은 page는 마지막 쪽으로 바꾼다(기록은 쌓지 않는다). 결과가 하나도 없으면(total 0) 그대로 둔다.
  const shown = tab === 'world' ? worlds : tab === 'card' ? cards : undefined
  const lastPage = shown?.beyond ? shown.pages : 0
  // eslint-disable-next-line react-hooks/exhaustive-deps -- 쪽이 넘쳤다고 알려질 때만 한 번 바꾼다.
  useEffect(() => { if (lastPage) navigate(to(tab, st.q, lastPage), { replace: true }) }, [lastPage])
  const [report, setReport] = useState<{ work: Work; scope: string } | null>(null)
  const scope = [tab, st.q, st.f, st.sort].join('\n')
  // 검색 조건(탭·검색어·범위·정렬)이 바뀌면(뒤로 가기 등) 열려 있던 신고 시트를 닫는다: 새 목록에 없는 작품의 시트가 남지 않게 한다.
  if (report && report.scope !== scope) setReport(null)
  const memberId = useAppSelector((s) => s.session.memberId)
  useScreenId('U36')
  return {
    st, tab, tabHref, submit, head, toHead, goPage,
    list: works.list, isError: works.isError, retry: works.retry, more: works.more,
    worlds, cards: { ...cards, needsQuery: q === '' },
    groups: {
      works: { list: works.list?.slice(0, GROUP_SIZE), isError: works.isError, retry: works.retry },
      worlds: groupWorlds,
      cards: { ...groupCards, needsQuery: q === '' },
    },
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
