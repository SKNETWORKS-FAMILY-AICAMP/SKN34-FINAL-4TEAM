import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'

import { appContainer } from '../../../../app/appContainer'
import { useAppSelector } from '../../../../app/store'
import { canReport, RANKING_KINDS, RANKING_PERIODS, RANKING_TYPES, rankingUsesPeriod, SEARCH_FIELDS, SEARCH_SORTS, type SearchField, type SearchSort, type Work } from '../../../../domain/entities/work'
import type { ReadingUseCase } from '../../../../domain/usecases/ReadingUseCase'
import { qs } from '../../../shared/format'
import { useScreenId } from '../../../shared/screenIds'
import { useAsyncData } from '../../../shared/useAsyncData'

const resolve = (): ReadingUseCase => appContainer.resolve('readingUseCase')

/**
 * 목업 listTools 검색 form: 검색어만 바꾸고 범위·정렬은 주소에 있던 값을 유지합니다.
 * 서버가 지원하는 범위(전체·제목·작가·태그·장르)·정렬(최신·인기=like·조회)만 읽고, 옛 주소의 sort=pop처럼 목록에 없는 값은 기본값으로 봅니다.
 */
function useListQuery(base: string, defaultSort: SearchSort) {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const Q = (k: string) => params.get(k) ?? ''
  const f = SEARCH_FIELDS.find(([k]) => k === Q('f'))?.[0] ?? 'all'
  const sort = SEARCH_SORTS.find(([k]) => k === Q('sort'))?.[0] ?? defaultSort
  return { st: { q: Q('q'), f, sort }, submit: (q: string) => navigate(qs(base, { q: q.trim(), f: Q('f'), sort: Q('sort') })) }
}

type WorkPage = Awaited<ReturnType<ReadingUseCase['findWorks']>>
/** '더 보기'로 이어 받은 페이지들. base는 이것이 붙은 첫 페이지라, 첫 페이지를 다시 받으면 저절로 버려집니다. */
type Extra = { base: WorkPage; items: Work[]; page: number; hasMore: boolean; state: 'idle' | 'loading' | 'failed' }

/**
 * 검색 목록: 첫 서버 페이지 뒤에 '더 보기'로 다음 페이지를 이어 붙입니다. 검색어·범위·정렬·세션이 바뀌어 첫 페이지를
 * 다시 받으면 이어 붙인 것을 버리고 처음부터 보이며, 그때(또는 화면을 떠날 때) 진행 중인 더 보기는 취소하고 늦은 응답은 무시합니다.
 * 더 보기가 실패해도 이미 보인 목록은 두고, 같은 페이지를 다시 시도하게 합니다. 랭킹(/rank)은 페이지 없이 상위 50개라 쓰지 않습니다.
 */
function usePagedWorks(readingUseCase: ReadingUseCase, query: { q: string; f: SearchField; sort: SearchSort }) {
  const first = useAsyncData(() => readingUseCase.findWorks(query), [readingUseCase, query.q, query.f, query.sort])
  const base = first.data
  const [stored, setExtra] = useState<Extra>()
  const extra = base && stored?.base === base ? stored : undefined
  const pending = useRef<AbortController | null>(null)
  useEffect(() => () => { pending.current?.abort(); pending.current = null }, [base])
  const hasMore = !!base && !first.isError && (extra ?? base).hasMore
  const load = () => {
    if (!base || !hasMore || pending.current) return // 진행 중에는 다시 보내지 않는다.
    const prev = extra ?? { base, items: [], page: 1, hasMore: base.hasMore, state: 'idle' as const }
    const request = (pending.current = new AbortController())
    setExtra({ ...prev, state: 'loading' })
    readingUseCase.findWorks({ ...query, page: prev.page }, request.signal).then(
      (next) => {
        if (request.signal.aborted) return
        // 보는 사이 서버 목록이 밀려 겹친 작품은 다시 붙이지 않는다(key 중복 방지).
        const shown = new Set([...base.list, ...prev.items].map((w) => w.id))
        setExtra({ base, items: [...prev.items, ...next.list.filter((w) => !shown.has(w.id))], page: prev.page + 1, hasMore: next.hasMore, state: 'idle' })
      },
      () => { if (!request.signal.aborted) setExtra({ ...prev, state: 'failed' }) },
    ).finally(() => { if (pending.current === request) pending.current = null })
  }
  return {
    list: base && [...base.list, ...(extra?.items ?? [])], isError: first.isError, retry: first.retry,
    more: { hasMore, loading: extra?.state === 'loading', failed: extra?.state === 'failed', load },
  }
}

/** 목업 searchPage(): U36 */
export function useSearchViewModel(readingUseCase = resolve()) {
  const { st, submit } = useListQuery('/search', 'latest')
  const { list, isError, retry, more } = usePagedWorks(readingUseCase, { q: st.q, f: st.f, sort: st.sort })
  const [reporting, setReporting] = useState<Work | null>(null)
  const memberId = useAppSelector((s) => s.session.memberId)
  useScreenId('U36')
  return {
    st, list, isError, retry, more, submit,
    /** 남의 공개 작품 카드에서만 신고 버튼을 보입니다. */
    canReport: (w: Work) => canReport(w, memberId),
    reporting, setReporting,
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
