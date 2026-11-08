import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'

import { appContainer } from '../../../../app/appContainer'
import { SEARCH_FIELDS, SEARCH_SORTS, type SearchSort, type Work } from '../../../../domain/entities/work'
import type { ReadingUseCase } from '../../../../domain/usecases/ReadingUseCase'
import { qs } from '../../../shared/format'
import { useScreenId } from '../../../shared/screenIds'
import { useAsyncData } from '../../../shared/useAsyncData'

const resolve = (): ReadingUseCase => appContainer.resolve('readingUseCase')

/**
 * 목업 listTools 검색 form: 검색어만 바꾸고 범위·정렬은 주소에 있던 값을 유지합니다.
 * 서버가 지원하는 범위·정렬만 읽고, 옛 주소의 작가·인기 순 같은 값은 기본값으로 봅니다.
 */
function useListQuery(base: string, defaultSort: SearchSort) {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const Q = (k: string) => params.get(k) ?? ''
  const f = SEARCH_FIELDS.find(([k]) => k === Q('f'))?.[0] ?? 'all'
  const sort = SEARCH_SORTS.find(([k]) => k === Q('sort'))?.[0] ?? defaultSort
  const st = { t: Q('t') || 'all', q: Q('q'), f, sort }
  return { st, submit: (q: string, keep: Record<string, string> = {}) => navigate(qs(base, { ...keep, q: q.trim(), f: Q('f'), sort: Q('sort') })) }
}

/** 목업 searchPage(): U36 */
export function useSearchViewModel(readingUseCase = resolve()) {
  const { st, submit } = useListQuery('/search', 'latest')
  const { data: list, isError } = useAsyncData(() => readingUseCase.findWorks({ q: st.q, f: st.f, sort: st.sort }), [readingUseCase, st.q, st.f, st.sort])
  const [reporting, setReporting] = useState<Work | null>(null)
  useScreenId('U36')
  return { st: { q: st.q, f: st.f, sort: st.sort }, list, isError, submit: (q: string) => submit(q, { t: '' }), reporting, setReporting }
}

/** 목업 rank(): U25 */
export function useRankViewModel(readingUseCase = resolve()) {
  const { st, submit } = useListQuery('/rank', 'view')
  const { data: list, isError } = useAsyncData(() => readingUseCase.findWorks(st), [readingUseCase, st.t, st.q, st.f, st.sort])
  useScreenId('U25')
  return { st, list, isError, submit: (q: string) => submit(q, { t: st.t }) }
}

/** 목업 tagPage(t): U29 */
export function useTagViewModel(tag: string | undefined, readingUseCase = resolve()) {
  const { data } = useAsyncData(() => readingUseCase.getTag(tag), [readingUseCase, tag])
  useScreenId('U29')
  return data
}

/** 목업 ifs(): U26. 원작(w)이 없으면 화면이 /rank?t=if로 보냅니다. */
export function useIfsViewModel(readingUseCase = resolve()) {
  const [params] = useSearchParams()
  const w = params.get('w') ?? ''
  const sort = params.get('sort') || 'view'
  const { data: groups } = useAsyncData(() => readingUseCase.getForkCollection(w, sort), [readingUseCase, w, sort])
  useScreenId(w ? 'U26' : null)
  return { w, sort, groups }
}
