import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'

import { appContainer } from '../../../../app/appContainer'
import type { PublicWorld } from '../../../../domain/entities/publicWorld'
import type { PublicWorldUseCase } from '../../../../domain/usecases/PublicWorldUseCase'
import { useAsyncData } from '../../../shared/useAsyncData'
import { parseBookSort, type BookSort } from '../../../shared/worldBoard'
import { ALL_CHIP, WORLD_CHIPS, genreCode } from '../../../shared/worldGenres'
import { buildWorldAtlas, highlightIds, liveRank, rankByRecent, type AtlasNode } from '../worldAtlas'
import {
  bookRows, buildCharacterGraph, buildSettingGraph, cardPage, cardPath, kindCounts, parseBookKind, parseDetailTab, selectVisible, type DetailNode, type DetailTab,
} from '../worldDetail'

// 선반은 홈처럼 앞의 몇 개만 보이고, 전부는 '세계관 모아 보기'와 지도가 보여 준다.
const RAIL_SIZE = 10

/**
 * 공개 세계관 대시보드의 장르 칩과 그에 맞는 지도·순위·목록. 이 화면에서만 쓰므로 Redux 없이 로컬 상태로 둔다.
 * 지도·'실시간 인기'·'새로 공개된' 선반은 장르와 상관없이 늘 최근 공개 순 전체 목록(`overview`)에서 만들고, 장르 칩은 지도를 흐리게만 한다(`lit`, 추천이면 undefined).
 * 칩의 장르 쿼리(`genre`)로 다시 읽는 것은 '모아 보기' 목록 하나뿐이다(추천 칩은 전체 목록을 그대로 쓴다). 지도의 장르 노드를 누르면 그 장르 칩이 골라진다.
 * 요청 취소·늦은 응답 무시·실패 재시도는 `useAsyncData`가 맡는다. 첫 조회가 끝나기 전·실패했을 때는 `world`가 없고(`isLoading`·`isError`), 전체가 0개면 `empty`다.
 */
export function useWorldsViewModel(useCase: PublicWorldUseCase = appContainer.resolve('publicWorldUseCase')) {
  const navigate = useNavigate()
  const [chip, setChip] = useState(ALL_CHIP)
  const genre = genreCode(chip)
  const overview = useAsyncData((signal) => useCase.list({}, signal), [useCase])
  const filtered = useAsyncData((signal) => (genre ? useCase.list({ genre }, signal) : Promise.resolve(undefined)), [useCase, genre])
  const all = overview.data
  // 지도 그래프는 ForceGraph가 좌표를 붙이고 링크를 바꾸므로 응답마다 새로 만들고 그 안에서는 그대로 쓴다.
  const atlas = useMemo(() => (all ? buildWorldAtlas(all.items) : undefined), [all])
  const lit = useMemo(() => (atlas ? highlightIds(atlas, chip) : undefined), [atlas, chip])
  const rank = useMemo(() => (all ? liveRank(all.items) : undefined), [all])
  const newest = useMemo(() => (all ? rankByRecent(all.items, RAIL_SIZE) : []), [all])
  const grid = genre ? filtered : overview
  const listing = genre ? filtered.data : all
  return {
    chips: WORLD_CHIPS, chip, selectChip: setChip,
    filtered: chip !== ALL_CHIP,
    heading: WORLD_CHIPS.find((c) => c.genre === chip)?.label ?? chip,
    /** 첫 조회 전체 상태: 불러오는 중 / 실패(다시 시도) / 공개 세계관이 하나도 없음 */
    isLoading: overview.isLoading, isError: overview.isError && !all, retry: overview.retry,
    empty: all?.total === 0,
    /** 메모리 데모 응답이면 true: 화면이 "데모" 안내를 보인다. */
    demo: all?.demo === true,
    atlas, lit, total: all?.total ?? 0,
    liveRank: rank?.worlds ?? [], rankBasis: rank?.basis,
    newest,
    /** 모아 보기 목록과 그 조회 상태. 장르 칩이면 그 장르 쿼리 결과, 추천이면 전체 목록이다. */
    list: { worlds: listing?.items ?? [], total: listing?.total ?? 0, isLoading: grid.isLoading, isError: grid.isError && !listing, retry: grid.retry },
    /** 장르 노드는 그 장르 칩 선택으로(칩이 없는 '미지정'은 무시), 세계관 노드는 그 세계관 상세로, 카드 노드는 그 카드의 페이지로 */
    openAtlasNode: (node: AtlasNode) => {
      if (node.kind === 'genre') {
        if (genreCode(node.genre)) setChip(node.genre)
      } else navigate(node.kind === 'card' ? cardPath(node.worldId, node.cardId) : `/worlds/${node.worldId}`)
    },
  }
}

/**
 * `/worlds/:id`의 세계관(`detail.world`)과 카드가 있는 유형 묶음(`kinds`), 두 그래프(설정 그래프·인물관계도)의 내용.
 * 상세는 `get(id)` 한 번으로 받고 그래프·게시판은 그 응답으로 계산한다. 비공개·없는 세계관은 `isLoading`이 끝난 뒤에도 `detail`이 없고 오류도 아니다(찾을 수 없음).
 * 선택한 탭은 `?tab=graph|people|book|overview`에 두어 새로고침·공유해도 그대로이고 탭을 옮길 때는 기록을 쌓지 않는다.
 * 그래프는 ForceGraph가 노드에 좌표를 붙이고 링크를 바꾸므로 응답마다 한 번 만들어 탭을 오가도 같은 객체를 쓴다.
 * 그래프 노드를 누르면(`openNode`) 그 카드의 페이지로, 세계관 중심 노드는 설정집 탭으로 이동한다(노드가 `to`를 가진다).
 */
export function useWorldDetailViewModel(id: string | undefined, useCase: PublicWorldUseCase = appContainer.resolve('publicWorldUseCase')) {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const tab = parseDetailTab(params.get('tab'))
  const { data: world, isLoading, isError, retry } = useAsyncData((signal) => (id ? useCase.get(id, signal) : Promise.resolve(undefined)), [useCase, id])
  const detail = useMemo(() => (world ? { world, kinds: kindCounts(world), setting: buildSettingGraph(world), people: buildCharacterGraph(world) } : undefined), [world])
  return {
    detail, isLoading, isError: isError && !world, retry, tab,
    setTab: (next: DetailTab) => setParams({ tab: next }, { replace: true }),
    openNode: (node: DetailNode) => navigate(node.to),
  }
}

/**
 * 설정집 탭(게시판). 분류 메뉴(전체·유형)의 선택은 `?type=`에 두어 설정 카드 페이지의 빵부스러기·뒤로 가기가 그 분류로 돌아오게 하고(메뉴 링크가 `tab=book`을 유지한다),
 * 검색어·정렬은 화면 안의 입력이라 로컬 상태다. 세계관마다 새로 마운트되므로(`key`는 View가 준다) 세계관을 옮기면 비워진다.
 * `kind`가 undefined면 전체, `rows`는 필터·정렬을 거친 줄, `total`은 세계관의 모든 카드 수, `counts`는 카드가 있는 유형별 장수(분류 메뉴)다.
 * `picked`는 내 세계관으로 바로 가져오려고 고른 카드 id다. 분류·검색으로 줄이 가려져도 남고, '보이는 설정 모두 선택'(`pickVisible`)은 지금 보이는 줄만 고르거나 푼다.
 */
export function useWorldBookViewModel(world: PublicWorld) {
  const [params] = useSearchParams()
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<BookSort>('book')
  const counts = useMemo(() => kindCounts(world), [world])
  const kind = parseBookKind(params.get('type'), counts.map((c) => c.kind))
  const rows = useMemo(() => bookRows(world, { kind, query, sort }), [world, kind, query, sort])
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set())
  const visible = rows.map((row) => row.cardId)
  return {
    counts, total: world.cards.length, kind, query, setQuery, sort, selectSort: (value: string) => setSort(parseBookSort(value)), rows,
    picked, allVisiblePicked: visible.length > 0 && visible.every((id) => picked.has(id)),
    pick: (cardId: string, on: boolean) => setPicked((before) => selectVisible(before, [cardId], on)),
    pickVisible: (on: boolean) => setPicked((before) => selectVisible(before, visible, on)),
    clearPicked: () => setPicked(new Set()),
  }
}

/** `/worlds/:id/cards/:cardId`의 세계관과 카드 한 장의 페이지 내용. 없는 세계관은 `world`가, 그 세계관에 없는 카드는 `page`가 undefined다(`isLoading`·`isError`가 아닐 때). */
export function useWorldCardViewModel(id: string | undefined, cardId: string | undefined, useCase: PublicWorldUseCase = appContainer.resolve('publicWorldUseCase')) {
  const { data: world, isLoading, isError, retry } = useAsyncData((signal) => (id ? useCase.get(id, signal) : Promise.resolve(undefined)), [useCase, id])
  const page = useMemo(() => (world && cardId !== undefined ? cardPage(world, cardId) : undefined), [world, cardId])
  return { world, page, isLoading, isError: isError && !world, retry }
}
