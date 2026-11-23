import { useMemo, useState } from 'react'

import { cardStatuses, problemCount, publicationOrderIssues } from '../../../../domain/entities/worldReview'
import { cardLibraryRows } from '../../../../domain/entities/worldStudioWriting'
import { boardEmptyKinds, boardKindCounts, boardRows, BOOK_SORTS, KINDS, type CardKind } from '../../../shared/worldBoard'
import { pageItems } from '../../../shared/pageItems'
import { settingBoardEntries } from './settingBoard'
import type { useWorldStudioViewModel } from './useWorldStudioViewModel'

type Studio = Pick<ReturnType<typeof useWorldStudioViewModel>, 'editing' | 'cardQuery' | 'setCardQuery' | 'review'>

/** 설정집 게시판의 정렬: 공개 설정집과 같은 세 가지에 이 화면만의 `보완 필요 많은 순`(정리 필요·연결 필요·공개 순서·AI 의견을 센 수가 많은 카드부터, 같은 수는 설정집 순서)이 더해진다. */
export const BOARD_SORTS = [...BOOK_SORTS, ['status', '보완 필요 많은 순']] as const
export type BoardSort = (typeof BOARD_SORTS)[number][0]
const parseBoardSort = (value: string): BoardSort => BOARD_SORTS.find(([key]) => key === value)?.[0] ?? 'book'

/** 분류 메뉴의 `보완 필요`: 정리 필요·연결 필요·공개 순서 확인·AI 의견 가운데 하나라도 있는 카드만 본다. 분류 하나를 고르면 풀린다. */
const TODO = 'todo'

/**
 * 설정집 게시판과 편집 화면의 카드 목록 레일이 쓰는 목록(공개 설정집과 같은 분류 메뉴·검색·정렬). 분류·정렬은 쓰는 화면 안의 선택이라 로컬 상태이고,
 * 검색어는 기존 ViewModel의 `cardQuery`(제목·본문·분류·태그·별칭)를 그대로 써서 게시판과 레일이 같은 검색어를 본다.
 * 카드마다의 보완 상태(`statuses`: 정리 필요·연결 필요·공개 순서 확인·AI 의견 수)는 초안과 마지막 AI 검토에서 즉시 계산하고(공개 순서 경고의 자세한 내용은 `orderIssues`, 편집 화면이 그 카드의 것을 보인다), 카드가 없는 분류는 `empty`로 알린다.
 */
export function useCardBoard(studio: Studio, { showEmptyKinds = false } = {}) {
  const [picked, setPicked] = useState<CardKind | typeof TODO>()
  const [sort, setSort] = useState<BoardSort>('book')
  const [page, setPage] = useState(0)
  const settings = studio.editing?.settings
  const findings = studio.review.findings
  const entries = useMemo(() => settingBoardEntries(settings ?? []), [settings])
  const counts = useMemo(() => boardKindCounts(entries), [entries])
  const empty = useMemo(() => showEmptyKinds ? (entries.length ? boardEmptyKinds(entries) : KINDS) : [], [entries, showEmptyKinds])
  const orderIssues = useMemo(() => publicationOrderIssues(settings ?? []), [settings])
  const statuses = useMemo(() => cardStatuses(settings ?? [], findings, orderIssues), [settings, findings, orderIssues])
  // 게시판에 오르는 카드(관계·메모 같은 기존 항목은 아니다)만 센다.
  const todoCount = useMemo(() => entries.filter((e) => statuses.has(e.cardId)).length, [entries, statuses])
  // 보완 필요나 고른 분류가 메뉴에서 사라지면 전체로 돌아간다. 게시판에서는 비어진 분류도 메뉴에 남는다.
  const todo = picked === TODO && todoCount > 0
  const kind = counts.find((c) => c.kind === picked)?.kind ?? empty.find((kind) => kind === picked)
  const query = studio.cardQuery
  // 검색어가 없으면 거르지 않는다(모든 카드의 제목·본문·태그를 이어 붙여 견주는 일을 입력마다 하지 않는다).
  const rows = useMemo(() => {
    const found = query.trim() ? new Set(cardLibraryRows(settings ?? [], 'all', query).map((s) => s.item.id)) : null
    const shown = entries.filter((e) => (!found || found.has(e.cardId)) && (!todo || statuses.has(e.cardId)))
    const listed = boardRows(shown, { kind, sort: sort === 'status' ? 'book' : sort })
    // 보완 필요 많은 순: 설정집 순서로 늘어놓은 뒤 안정 정렬로 수가 많은 카드를 앞에 두므로 같은 수는 설정집 순서를 지키고, 순번은 다시 매긴다.
    const problems = (id: string) => { const status = statuses.get(id); return status ? problemCount(status) : 0 }
    return sort === 'status' ? [...listed].sort((a, b) => problems(b.cardId) - problems(a.cardId)).map((row, n) => ({ ...row, no: n + 1 })) : listed
  }, [entries, settings, query, kind, sort, todo, statuses])
  return {
    counts, total: entries.length, kind, sort,
    rows, paged: pageItems(rows, page, 50), setPage,
    statuses, orderIssues, todoCount, todo, empty,
    selectSort: (value: string) => { setSort(parseBoardSort(value)); setPage(0) },
    pickKind: (next?: CardKind) => { setPicked(next); setPage(0) },
    pickTodo: () => { setPicked(TODO); setPage(0) },
    /** 새 설정을 더하기 전에 전체·빈 검색으로 돌려 새 카드가 목록에 보이게 한다. */
    reset: () => { setPicked(undefined); setPage(0); studio.setCardQuery('') },
  }
}
