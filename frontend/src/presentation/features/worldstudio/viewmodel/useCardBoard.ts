import { useMemo, useState } from 'react'

import { cardLibraryRows } from '../../../../domain/entities/worldStudioWriting'
import { boardKindCounts, boardRows, parseBookSort, type BookSort, type CardKind } from '../../../shared/worldBoard'
import { settingBoardEntries } from './settingBoard'
import type { useWorldStudioViewModel } from './useWorldStudioViewModel'

type Studio = Pick<ReturnType<typeof useWorldStudioViewModel>, 'editing' | 'selected' | 'setSelected' | 'cardQuery' | 'setCardQuery'>

/**
 * 설정 카드 단계의 게시판(공개 설정집과 같은 분류 메뉴·검색·정렬·표). 분류·정렬은 이 화면 안의 선택이라 로컬 상태이고,
 * 검색어는 기존 ViewModel의 `cardQuery`(제목·본문·분류·태그·별칭)를 그대로 쓴다. 보이는 줄이 바뀌어 선택한 카드가 빠지면 선택을 비운다.
 */
export function useCardBoard(studio: Studio) {
  const [picked, setPicked] = useState<CardKind>()
  const [sort, setSort] = useState<BookSort>('book')
  const settings = studio.editing?.settings
  const entries = useMemo(() => settingBoardEntries(settings ?? []), [settings])
  const counts = useMemo(() => boardKindCounts(entries), [entries])
  // 고른 분류의 마지막 카드가 다른 분류로 옮겨 가 메뉴에서 사라지면 전체를 보인다.
  const kind = counts.find((c) => c.kind === picked)?.kind
  const rowsFor = (only: CardKind | undefined, query: string) => {
    const found = new Set(cardLibraryRows(settings ?? [], 'all', query).map((s) => s.item.id))
    return boardRows(entries.filter((e) => found.has(e.cardId)), { kind: only, sort })
  }
  // 고른 카드가 보이는 줄에서 빠지면 패널을 닫는다(고르지 않은 카드를 자동으로 열지 않는다).
  const reselect = (next: { cardId: string }[]) => {
    if (!next.some((r) => r.cardId === studio.selected)) studio.setSelected('')
  }
  return {
    counts, total: entries.length, kind, sort,
    rows: rowsFor(kind, studio.cardQuery),
    /** 필터에 걸리지 않아도 편집 중인 카드를 표 맨 위에 보이려고 한 줄의 원자료를 찾는다. */
    entry: (id: string) => entries.find((e) => e.cardId === id),
    selectSort: (value: string) => setSort(parseBookSort(value)),
    pickKind: (next?: CardKind) => { setPicked(next); reselect(rowsFor(next, studio.cardQuery)) },
    search: (query: string) => { studio.setCardQuery(query); reselect(rowsFor(kind, query)) },
    /** 새 설정을 더하기 전에 전체·빈 검색으로 돌려 새 카드가 보이게 한다. */
    reset: () => { setPicked(undefined); studio.setCardQuery('') },
  }
}
