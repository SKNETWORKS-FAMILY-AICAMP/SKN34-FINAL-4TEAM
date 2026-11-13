import { describe, expect, it } from 'vitest'

import {
  BOOK_SORTS, CARD_COLORS, CARD_KIND, boardKindCounts, boardRows, parseBookSort, type BoardEntry, type CardKind,
} from './worldBoard'

/** 제목·본문 검색은 title·text에서, 연결 수는 connections에서 본다. 분류 이름(type)은 화면용 글자라 필터에 쓰이지 않는다. */
const entry = (title: string, kind: CardKind, connections = 0, text = `${title} 설명`): BoardEntry => ({ cardId: title, title, text, type: kind, kind, connections, badge: connections })
// 넣은 순서(사건·인물·기타·장소·인물)와 설정집 순서(인물 → 장소 → 사건 → 기타)가 다르다.
const mixed = [entry('e사건', '사건', 3), entry('c인물', '인물', 2), entry('z기타', '기타', 0), entry('a장소', '장소', 2), entry('d인물', '인물', 2)]
const titles = (rows: { title: string }[]) => rows.map((r) => r.title)

describe('CARD_KIND·CARD_COLORS', () => {
  it('능력·사물·기타 카드는 한 묶음(기타)이고 묶음마다 색이 하나씩 있다', () => {
    expect(CARD_KIND).toEqual({ character: '인물', location: '장소', organization: '조직', rule: '규칙', event: '사건', ability: '기타', object: '기타', other: '기타' })
    expect(Object.keys(CARD_COLORS)).toEqual(['인물', '장소', '조직', '규칙', '사건', '기타'])
  })
})

describe('boardRows', () => {
  it('넣은 순서와 상관없이 설정집 순서(인물·장소·조직·규칙·사건·기타 순, 같은 묶음 안에서는 넣은 순서)로 내고 순번을 1부터 매긴다', () => {
    expect(boardRows(mixed).map((r) => [r.no, r.title])).toEqual([[1, 'c인물'], [2, 'd인물'], [3, 'a장소'], [4, 'e사건'], [5, 'z기타']])
  })

  it('분류 필터와 검색어(제목 또는 본문, 대소문자·앞뒤 공백 무시)가 함께 적용되고 순번은 보이는 목록 기준이다', () => {
    expect(titles(boardRows(mixed, { kind: '인물' }))).toEqual(['c인물', 'd인물'])
    expect(boardRows(mixed, { kind: '장소' }).map((r) => r.no)).toEqual([1])
    expect(titles(boardRows(mixed, { query: ' A장소 ' }))).toEqual(['a장소'])
    expect(titles(boardRows(mixed, { query: '설명' }))).toEqual(['c인물', 'd인물', 'a장소', 'e사건', 'z기타']) // 본문에만 있는 글자
    expect(titles(boardRows(mixed, { kind: '인물', query: 'D' }))).toEqual(['d인물'])
    expect(titles(boardRows(mixed, { kind: '장소', query: 'D' }))).toEqual([])
    expect(titles(boardRows(mixed, { query: '   ' }))).toHaveLength(5)
    expect(titles(boardRows([entry('SF 정거장', '장소')], { query: 'sf' }))).toEqual(['SF 정거장']) // 제목의 대문자도 무시
  })

  it('연결 많은 순은 연결 수 내림차순(같으면 설정집 순서), 가나다순은 제목의 한국어 사전 순이고 순번은 정렬한 순서대로 매긴다', () => {
    expect(boardRows(mixed, { sort: 'links' }).map((r) => [r.no, r.title, r.connections])).toEqual([[1, 'e사건', 3], [2, 'c인물', 2], [3, 'd인물', 2], [4, 'a장소', 2], [5, 'z기타', 0]])
    const korean = [entry('다 항구', '장소'), entry('가 항구', '장소'), entry('나 항구', '장소')]
    expect(boardRows(korean, { sort: 'name' }).map((r) => [r.no, r.title])).toEqual([[1, '가 항구'], [2, '나 항구'], [3, '다 항구']])
    expect(titles(boardRows(korean, { sort: 'book' }))).toEqual(['다 항구', '가 항구', '나 항구'])
  })

  it('입력 배열은 바꾸지 않고 한 줄의 값(cardId·연결 수·제목 옆 수)은 그대로 싣는다', () => {
    const before = structuredClone(mixed)
    expect(boardRows(mixed, { sort: 'name' })[0]).toEqual({ ...mixed[3], no: 1 })
    expect(mixed).toEqual(before)
  })
})

describe('boardKindCounts', () => {
  it('카드가 있는 묶음과 장수를 설정집 순서로 준다', () => {
    expect(boardKindCounts(mixed)).toEqual([{ kind: '인물', count: 2 }, { kind: '장소', count: 1 }, { kind: '사건', count: 1 }, { kind: '기타', count: 1 }])
    expect(boardKindCounts([])).toEqual([])
  })
})

describe('parseBookSort', () => {
  it('정렬 값이 설정집 순·연결 많은 순·가나다순 중 하나면 그대로고 모르는 값이면 설정집 순이다', () => {
    expect(BOOK_SORTS.map(([key, label]) => [key, label])).toEqual([['book', '설정집 순'], ['links', '연결 많은 순'], ['name', '가나다순']])
    expect(['book', 'links', 'name'].map(parseBookSort)).toEqual(['book', 'links', 'name'])
    expect(['', 'LINKS', 'popular'].map(parseBookSort)).toEqual(['book', 'book', 'book'])
  })
})
