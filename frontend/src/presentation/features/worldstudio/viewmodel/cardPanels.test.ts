import { describe, expect, it } from 'vitest'
import { CARD_PANES, DEFAULT_PANE, paneBadges, parseCardPane, setPaneQuery, tabName } from './cardPanels'

describe('화면(pane) 종류', () => {
  it('활동 막대 위에서 아래로 개요·문서·관계·버전·공개 순서이고 기본은 문서다', () => {
    expect(CARD_PANES.map((p) => [p.id, p.label])).toEqual([['overview', '개요'], ['doc', '문서'], ['relations', '관계'], ['versions', '버전'], ['order', '공개 순서']])
    expect(DEFAULT_PANE).toBe('doc')
  })

  it('parseCardPane은 주소의 pane 값을 화면으로 바꾸고 없거나 모르는 값이면 문서다', () => {
    expect(['overview', 'doc', 'relations', 'versions', 'order'].map(parseCardPane)).toEqual(['overview', 'doc', 'relations', 'versions', 'order'])
    expect([null, '', 'nope', 'cards', 'ORDER'].map(parseCardPane)).toEqual(['doc', 'doc', 'doc', 'doc', 'doc'])
  })
})

describe('setPaneQuery: 주소에 화면 쓰기', () => {
  it('기본(문서)이면 주소에서 pane을 지우고 그 밖은 pane에 써서 다른 쿼리(card)는 그대로 둔다', () => {
    const query = new URLSearchParams('card=a&pane=order')
    setPaneQuery(query, 'doc')
    expect(query.toString()).toBe('card=a')
    setPaneQuery(query, 'relations')
    expect(query.toString()).toBe('card=a&pane=relations')
    setPaneQuery(query, 'overview')
    expect(query.toString()).toBe('card=a&pane=overview')
  })
})

describe('paneBadges: 아이콘 위 배지', () => {
  it('관계는 수, 버전은 확정 버전 수이고 저장하지 않은 변경이 있으면 수 대신 점이다', () => {
    expect(paneBadges({ relations: 12, versions: 3, dirty: false, issues: 0 })).toEqual({ relations: { text: '12', label: '12개' }, versions: { text: '3', label: '3개' } })
    expect(paneBadges({ relations: 0, versions: 3, dirty: true, issues: 0 }).versions).toEqual({ text: '', label: '저장 안 됨' })
    expect(paneBadges({ relations: 0, versions: 0, dirty: false, issues: 0 })).toEqual({}) // 0은 배지가 없다
  })

  it('공개 순서는 문제가 있을 때만 수를 보이고, 99를 넘으면 글자는 99+이지만 읽는 이름은 실제 수다', () => {
    expect(paneBadges({ relations: 0, versions: 0, dirty: false, issues: 5 }).order).toEqual({ text: '5', label: '5건' })
    expect(paneBadges({ relations: 140, versions: 0, dirty: false, issues: 0 }).relations).toEqual({ text: '99+', label: '140개' })
  })

  it('tabName은 아이콘 버튼의 읽는 이름이다: 배지가 있으면 뒤에 붙인다', () => {
    expect(tabName('관계')).toBe('관계')
    expect(tabName('관계', { text: '12', label: '12개' })).toBe('관계 12개')
    expect(tabName('버전', { text: '', label: '저장 안 됨' })).toBe('버전 저장 안 됨')
  })
})
