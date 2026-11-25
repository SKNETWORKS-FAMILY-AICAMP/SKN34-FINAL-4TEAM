import { describe, expect, it } from 'vitest'
import type { OrderIssue } from '../../../../domain/entities/worldReview'
import { groupOrderIssues } from './orderGroups'

const issue = (named: string, over: Partial<OrderIssue> = {}, from: number | null = 64): OrderIssue => ({ cardId: 'me', source: 'body', name: named, named: { cardId: 'c-' + named, title: named, ...(from === null ? {} : { from }) }, visibleFrom: 1, ...over })
const relation = (named: string, relationId: string, visibleFrom: number, from: number | null = 64) => issue(named, { source: 'relation', relationId, visibleFrom }, from)

describe('groupOrderIssues: 같은 카드 이름이 반복되는 경고를 카드별 한 줄로 묶는다', () => {
  it('경고가 없으면 묶음도 없다', () => {
    expect(groupOrderIssues([])).toEqual([])
  })

  it('한 카드의 본문 경고와 관계 글 경고를 `카드 — N화부터 공개 · 본문 1 · 관계 글 5곳 (17·20·23·40·62화)` 한 줄로 쓴다', () => {
    const groups = groupOrderIssues([issue('위즐리네 캠프장'), ...[62, 17, 40, 20, 23].map((ep, i) => relation('위즐리네 캠프장', 'r' + i, ep))])
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ cardId: 'c-위즐리네 캠프장', title: '위즐리네 캠프장', detail: '64화부터 공개 · 본문 1 · 관계 글 5곳 (17·20·23·40·62화)', summary: '위즐리네 캠프장 — 64화부터 공개 · 본문 1 · 관계 글 5곳 (17·20·23·40·62화)' })
    expect(groups[0].issues).toHaveLength(6) // 펼침 상세에는 경고가 하나씩 모두 있다
  })

  it('작가 전용 카드는 공개 회차 대신 작가 전용이고, 없는 종류(본문·관계 글)는 쓰지 않는다', () => {
    expect(groupOrderIssues([issue('비밀', {}, null)])[0].detail).toBe('작가 전용 · 본문 1')
    expect(groupOrderIssues([relation('비밀', 'r1', 3, null)])[0].detail).toBe('작가 전용 · 관계 글 1곳 (3화)')
  })

  it('소설에 없는 회차로 정해진 카드는 N화부터 공개가 아니라 작가 전용 · N화는 아직 없어요로 쓴다(소설의 마지막 회차를 알 때만)', () => {
    expect(groupOrderIssues([issue('캠프', {}, 193)], 0)[0].detail).toBe('작가 전용 · 193화는 아직 없어요 · 본문 1')
    expect(groupOrderIssues([relation('캠프', 'r1', 3, 193)], 5)[0].detail).toBe('작가 전용 · 193화는 아직 없어요 · 관계 글 1곳 (3화)')
    expect(groupOrderIssues([issue('캠프', {}, 5)], 5)[0].detail).toBe('5화부터 공개 · 본문 1') // 마지막 회차 안이면 그대로
    expect(groupOrderIssues([issue('캠프', {}, 193)])[0].detail).toBe('193화부터 공개 · 본문 1') // 회차 수를 모르면 지어내지 않는다
  })

  it('같은 관계 글이 이름을 두 번 불러도 한 곳이고 같은 회차는 한 번만 쓴다', () => {
    const groups = groupOrderIssues([relation('가', 'r1', 20), relation('가', 'r1', 20), relation('가', 'r2', 20)])
    expect(groups[0].detail).toBe('64화부터 공개 · 관계 글 2곳 (20화)')
  })

  it('회차가 많으면 앞 6개만 쓰고 나머지 수를 알린다', () => {
    const many = Array.from({ length: 10 }, (_, i) => relation('가', 'r' + i, i + 1))
    expect(groupOrderIssues(many)[0].detail).toBe('64화부터 공개 · 관계 글 10곳 (1·2·3·4·5·6 외 4화)')
  })

  it('카드마다 따로 묶고 경고가 많은 카드가 먼저, 같으면 이름 순이다', () => {
    const groups = groupOrderIssues([issue('나'), issue('가'), relation('가', 'r1', 2), issue('다')])
    expect(groups.map((g) => g.title)).toEqual(['가', '나', '다'])
    expect(groups.map((g) => g.issues.length)).toEqual([2, 1, 1])
  })

  it('이름이 빈 카드는 이름 없는 설정으로 쓴다', () => {
    expect(groupOrderIssues([{ ...issue('x'), named: { cardId: 'z', title: '', from: 2 } }])[0].title).toBe('이름 없는 설정')
  })

  it('같은 카드가 제목과 별칭 두 가지 이름으로 나와도 한 묶음이다(이름이 아니라 카드 기준)', () => {
    const groups = groupOrderIssues([issue('캠프'), issue('캠프', { name: '위즐리네 캠프장' })])
    expect(groups).toHaveLength(1)
    expect(groups[0].issues.map((i) => i.name)).toEqual(['캠프', '위즐리네 캠프장'])
  })
})
