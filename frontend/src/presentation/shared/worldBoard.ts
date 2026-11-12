import type { CardType } from '../../domain/entities/studioCards'

/*
 * 설정 카드 게시판(공개 세계관 `/worlds/:id`의 설정집 탭과 내 세계관 `/worldstudio`의 설정집 화면·편집 화면 레일)이 함께 쓰는 순수 규칙:
 * 카드 유형 묶음·색, 정렬 기준, 필터·정렬·번호 매기기. 두 화면은 데이터(데모 세계관 / 편집 중인 설정)를 `BoardEntry`로 바꿔 넘기기만 한다.
 */

/**
 * 설정 카드 점의 색(예전 WorldStudio 전체 세계관 지도의 유형 색에서 옮겨 왔다).
 * 능력·사물·기타 묶음은 그 지도가 '설정'이라 불렀지만 카드 유형 라벨(`cardTypes`)에는 '기타'뿐이라 범례·그래프·설정집은 '기타'로 통일했다.
 */
export const CARD_COLORS = { 인물: '#67caff', 장소: '#6ce3cb', 조직: '#ffca83', 규칙: '#c0abff', 사건: '#f0a0cf', 기타: '#a5b8d8' } as const
export type CardKind = keyof typeof CARD_COLORS
/** 그 지도처럼 능력·사물·기타는 '기타' 한 묶음이다. 세계관 상세의 그래프·설정집과 세계관 작업실의 설정 카드 게시판도 같은 묶음을 쓴다. */
export const CARD_KIND: Record<CardType, CardKind> = {
  character: '인물', location: '장소', organization: '조직', rule: '규칙', event: '사건', ability: '기타', object: '기타', other: '기타',
}
/** 묶음 순서(인물·장소·조직·규칙·사건·기타). 설정집 순서이자 분류 메뉴 순서다. */
export const KINDS = Object.keys(CARD_COLORS) as CardKind[]

export const BOOK_SORTS = [['book', '설정집 순'], ['links', '연결 많은 순'], ['name', '가나다순']] as const
export type BookSort = (typeof BOOK_SORTS)[number][0]
/** 정렬 select 값. 모르는 값이면 설정집 순이다. */
export const parseBookSort = (value: string): BookSort => BOOK_SORTS.find(([key]) => key === value)?.[0] ?? 'book'

/**
 * 게시판 한 줄의 원자료. `type`은 카드 자신의 유형 이름(능력·사물 …), `kind`는 묶음(색·분류 메뉴)이다.
 * `connections`는 이어진 카드 수, `badge`는 제목 옆에 댓글 수처럼 붙는 수(인물은 인물 관계 수, 그 밖은 연결 수)다.
 */
export type BoardEntry = { cardId: string; title: string; text: string; type: string; kind: CardKind; connections: number; badge: number }
/** `no`는 지금 보이는 목록(필터·정렬 뒤)의 순번(1부터)이다. */
export type BoardRow = BoardEntry & { no: number }
/** `kind`가 없으면 모든 묶음이다. `query`는 카드 제목이나 본문에 들어 있는 글자(대소문자·앞뒤 공백 무시)이고 비면 거르지 않는다. */
type BoardFilter = { kind?: CardKind; query?: string; sort?: BookSort }

/**
 * 게시판의 줄들: 묶음·검색어로 거른 카드를 정렬해 순번을 매긴다. 넣은 순서와 상관없이 같은 값은 설정집 순서(묶음 순 → 넣은 순서)를 지키고(안정 정렬),
 * 연결 많은 순은 `connections` 내림차순, 가나다순은 제목의 한국어 사전 순이다.
 */
export function boardRows(entries: readonly BoardEntry[], { kind: only, query = '', sort = 'book' }: BoardFilter = {}): BoardRow[] {
  const needle = query.trim().toLocaleLowerCase()
  const rows = KINDS.flatMap((kind) => entries.filter((e) => e.kind === kind && (!only || kind === only) && [e.title, e.text].some((s) => s.toLocaleLowerCase().includes(needle))))
  const order: Record<BookSort, (a: BoardEntry, b: BoardEntry) => number> = {
    book: () => 0, links: (a, b) => b.connections - a.connections, name: (a, b) => a.title.localeCompare(b.title, 'ko'),
  }
  return rows.sort(order[sort]).map((row, n) => ({ ...row, no: n + 1 }))
}

/** 카드가 있는 묶음과 장수(설정집 순서). 분류 메뉴가 쓴다. */
export const boardKindCounts = (entries: readonly BoardEntry[]) => KINDS.map((kind) => ({ kind, count: entries.filter((e) => e.kind === kind).length })).filter((k) => k.count > 0)
