import { useMemo, useState } from 'react'

import { cardLibraryRows } from '../../../../domain/entities/worldStudioWriting'
import { boardKindCounts, boardRows, parseBookSort, type BookSort, type CardKind } from '../../../shared/worldBoard'
import { settingBoardEntries } from './settingBoard'
import type { useWorldStudioViewModel } from './useWorldStudioViewModel'

type Studio = Pick<ReturnType<typeof useWorldStudioViewModel>, 'editing' | 'cardQuery' | 'setCardQuery'>

/**
 * 설정집 게시판과 편집 화면의 카드 목록 레일이 쓰는 목록(공개 설정집과 같은 분류 메뉴·검색·정렬). 분류·정렬은 쓰는 화면 안의 선택이라 로컬 상태이고,
 * 검색어는 기존 ViewModel의 `cardQuery`(제목·본문·분류·태그·별칭)를 그대로 써서 게시판과 레일이 같은 검색어를 본다.
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
  return {
    counts, total: entries.length, kind, sort,
    rows: rowsFor(kind, studio.cardQuery),
    selectSort: (value: string) => setSort(parseBookSort(value)),
    pickKind: (next?: CardKind) => setPicked(next),
    /** 새 설정을 더하기 전에 전체·빈 검색으로 돌려 새 카드가 목록에 보이게 한다. */
    reset: () => { setPicked(undefined); studio.setCardQuery('') },
  }
}
