import { useEffect, useId, useMemo, useRef, useState } from 'react'

import { appContainer } from '../../../../app/appContainer'
import { isCard } from '../../../../domain/entities/studioCards'
import { bookState, authorOnlyCard } from '../../../../domain/entities/studioWorldBook'
import { cardLibraryRows } from '../../../../domain/entities/worldStudioWriting'
import type { useLinkedWorld } from '../../../shared/chat/useSimulationSetupViewModel'
import { pageItems } from '../../../shared/pageItems'
import { settingBoardEntries } from '../../../shared/settingBoard'
import { useAsyncData } from '../../../shared/useAsyncData'
import { useCardImages } from '../../../shared/useCardImages'
import { boardKindCounts, boardRows, type CardKind } from '../../../shared/worldBoard'

export type BookView = 'episodes' | 'book'
const PAGE = 50 // 목록은 50개씩 쪽(세계관 관리 게시판과 같다)

/**
 * 집필실 왼쪽 메뉴(`회차 | 설정집`)와 설정집 보기(#986): 이 소설에 연결된 내 세계관의 설정 카드를 읽기만 한다.
 * 연결된 세계관 id는 집필실이 이미 읽는 `useLinkedWorld`([link])이고, 카드·관계는 세계관 관리와 같은 소유자 조회(`WorldStudioUseCase.read`, 최신 저장 초안)를
 * `설정집`을 처음 열 때 읽는다(그 전에는 읽지 않고, 열 때마다 이전 목록을 둔 채 다시 읽는다). 분류 이름(`CardCategoryUseCase`)도 그때 읽는다.
 * 고른 쪽·검색어·분류·고른 카드는 모두 화면 로컬 상태다. 가운데 상세는 원고 편집기를 지우지 않고 숨기기만 하며(집필실이 그렇게 그린다), 카드를 열면 초점이 상세로,
 * `원고로 돌아가기`는 초점을 그 카드의 목록 줄로 돌려준다. [episodeLimit]은 연결된 소설의 마지막 회차(모르면 undefined)이고,
 * [onOpenCard]는 카드를 열기 직전 불린다(집필실이 가운데를 차지하던 시뮬레이션 무대를 닫는다).
 */
export function useStudioWorldBookViewModel({ link, episodeLimit, onOpenCard }: {
  link: Pick<ReturnType<typeof useLinkedWorld>, 'data' | 'isLoading' | 'isError' | 'retry'>
  episodeLimit: number | undefined
  onOpenCard: () => void
}) {
  const worlds = appContainer.resolve('worldStudioUseCase')
  const worldId = link.data ?? undefined
  const state = bookState({ worldId: link.data, isLoading: link.isLoading, isError: link.isError })
  const noteId = useId()
  const [view, setView] = useState<BookView>('episodes')
  const [visits, setVisits] = useState(0) // 설정집을 연 횟수: 0이면 한 번도 열지 않아 아무것도 읽지 않는다
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<CardKind>()
  const [page, setPage] = useState(0)
  const [cardId, setCardId] = useState('')
  const opened = visits > 0
  const read = useAsyncData((signal) => (worldId && opened ? worlds.read(worldId, signal) : Promise.resolve(undefined)), [worlds, worldId, opened], [visits])
  const names = useAsyncData((signal) => (opened ? appContainer.resolve('cardCategoryUseCase').list(signal) : Promise.resolve(undefined)), [opened])
  const images = useCardImages(worlds, worldId)
  const settings = read.data?.settings
  // 분류 이름은 운영자가 바꾸거나 더한 카테고리를 따른다(읽지 못하면 기본 8종 이름이고, 화면이 실패를 알린다).
  const entries = useMemo(() => settingBoardEntries(settings ?? [], names.data ?? []), [settings, names.data])
  const counts = useMemo(() => boardKindCounts(entries), [entries])
  const kind = counts.find((c) => c.kind === picked)?.kind // 고른 분류가 사라지면 전체로 돌아간다
  // 검색어가 없으면 거르지 않는다(모든 카드의 글을 입력마다 견주지 않는다). 검색은 세계관 관리와 같은 `cardLibraryRows`(제목·본문·분류·태그·별칭)다.
  const rows = useMemo(() => {
    const found = query.trim() ? new Set(cardLibraryRows(settings ?? [], 'all', query).map((s) => s.item.id)) : null
    return boardRows(found ? entries.filter((e) => found.has(e.cardId)) : entries, { kind })
  }, [entries, settings, query, kind])
  const authorOnly = useMemo(() => new Set((settings ?? []).filter((s) => authorOnlyCard(s, episodeLimit)).map((s) => s.item.id)), [settings, episodeLimit])
  const card = settings?.find((s) => s.item.id === cardId && isCard(s.item))
  const entry = card && entries.find((e) => e.cardId === cardId)

  const list = useRef<HTMLElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const [focus, setFocus] = useState<{ to: 'detail' | 'row'; id: string }>()
  useEffect(() => {
    if (!focus) return
    if (focus.to === 'detail') heading.current?.focus()
    else [...(list.current?.querySelectorAll<HTMLElement>('[data-card]') ?? [])].find((el) => el.dataset.card === focus.id)?.focus()
  }, [focus])

  return {
    view, state, noteId, opened, worldId, retryLink: link.retry,
    /** 열 수 있을 때만 `설정집`으로 바꾼다(열 때마다 다시 읽는다). `회차`로 돌아가면 고른 카드는 닫는다. */
    show: (next: BookView) => {
      if (next === view || (next === 'book' && state !== 'ready')) return
      if (next === 'book') setVisits((n) => n + 1)
      else setCardId('')
      setView(next)
    },
    read: { world: read.data, isLoading: read.isLoading, isError: read.isError, retry: read.retry },
    categories: { isError: names.isError && !names.data, retry: names.retry },
    query, setQuery: (value: string) => { setQuery(value); setPage(0) },
    kind, pickKind: (next?: CardKind) => { setPicked(next); setPage(0) },
    counts, total: entries.length, rows, paged: pageItems(rows, page, PAGE), setPage, authorOnly,
    card, row: entry && { ...entry, no: 0 }, limit: episodeLimit, images,
    openCard: (id: string) => { onOpenCard(); setCardId(id); setFocus({ to: 'detail', id }) },
    /** 초점을 옮기지 않고 닫는다(다른 화면이 가운데를 가져갈 때). */
    closeCard: () => setCardId(''),
    /** 상세에서 링크로 다른 쪽의 카드를 열었을 수 있으므로 그 카드의 줄이 있는 쪽으로 넘기고 초점을 그 줄에 둔다(걸러서 줄이 없으면 초점은 옮기지 않는다). */
    back: () => {
      const id = cardId, at = rows.findIndex((r) => r.cardId === id)
      if (at >= 0) setPage(Math.floor(at / PAGE))
      setCardId('')
      setFocus({ to: 'row', id })
    },
    listRef: list, headingRef: heading,
  }
}
export type StudioWorldBook = ReturnType<typeof useStudioWorldBookViewModel>
