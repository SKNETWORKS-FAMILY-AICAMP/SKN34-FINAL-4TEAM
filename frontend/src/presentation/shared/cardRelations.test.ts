import { describe, expect, it } from 'vitest'
import { RING_MAX, atEpisode, episodeTabs, groupNeighbors, layoutOf, type RelationEntry } from './cardRelations'
import type { CardKind } from './worldBoard'

let n = 0
const entry = (other: string, steps: [string, number | null][], kind: CardKind = '인물'): RelationEntry => ({ id: 'r' + ++n, otherId: other, otherTitle: other, otherKind: kind, steps: steps.map(([name, episode]) => ({ name, episode })) })

describe('groupNeighbors', () => {
  it('같은 상대의 관계는 하나로 묶고 이름은 가장 늦은 회차의 관계 이름(+외 N), 이력은 회차 순서대로 쓴다', () => {
    const [guard] = groupNeighbors([entry('세라핀', [['경계', 1]]), entry('세라핀', [['보호', 3]]), entry('세라핀', [['동행', 2]])])
    expect(guard).toMatchObject({ id: '세라핀', name: '보호', more: 2, weight: 3, first: 1 })
    expect(guard.history).toBe('경계(1화) → 동행(2화) → 보호(3화)')
  })

  it('한 관계의 이름이 바뀐 이력도 그 관계의 마지막 이름이 대표이고, 바뀐 횟수만큼 무게가 늘며, 회차를 모르면 이력이 없다', () => {
    const [a, b] = groupNeighbors([entry('가', [['경계', 1], ['보호', 3]]), entry('나', [['친구', null]])])
    expect([a.name, a.weight, a.history]).toEqual(['보호', 2, '경계(1화) → 보호(3화)'])
    expect([b.name, b.weight, b.history, b.first]).toEqual(['친구', 1, '', null])
  })

  it('같은 이름이 이어지면(설명만 바뀐 변화) 이력에 한 번만 쓴다', () => {
    expect(groupNeighbors([entry('가', [['동료', 1], ['동료', 2], ['적', 4]])])[0].history).toBe('동료(1화) → 적(4화)')
  })
})

describe('atEpisode·episodeTabs', () => {
  const rows = [entry('가', [['경계', 1], ['보호', 3]]), entry('나', [['동료', 5]]), entry('다', [['친구', null]])]
  it('탭 값은 관계가 바뀌거나 생기는 회차의 서로 다른 값을 오름차순으로 준다(회차를 모르는 것은 뺀다)', () => {
    expect(episodeTabs(rows)).toEqual([1, 3, 5])
    expect(episodeTabs([])).toEqual([])
  })

  it('N화 시점에는 그때까지의 관계만 남고 그 시점의 관계 이름을 쓴다(null은 전체, 회차를 모르는 관계는 늘 보인다)', () => {
    expect(atEpisode(rows, null)).toHaveLength(3)
    const at1 = atEpisode(rows, 1)
    expect(at1.map((e) => e.otherId)).toEqual(['가', '다'])
    expect(groupNeighbors(at1)[0].name).toBe('경계')
    expect(groupNeighbors(atEpisode(rows, 3))[0].name).toBe('보호')
    expect(atEpisode(rows, 5).map((e) => e.otherId)).toEqual(['가', '나', '다'])
    expect(atEpisode(rows, 0).map((e) => e.otherId)).toEqual(['다'])
  })
})

describe('layoutOf', () => {
  it('사건이 아닌 이웃을 많은 순으로 16개까지 둘레에 두고(인물 먼저·유형별로 모음) 넘치면 개수를 알리며, 사건은 회차순으로 따로 모은다', () => {
    const people = Array.from({ length: 20 }, (_, i) => entry('인물' + i, Array.from({ length: i === 0 ? 3 : 1 }, (_, k) => ['관계', k + 1] as [string, number]), '인물'))
    const places = [entry('항구', [['장소', 1]], '장소'), entry('성', [['장소', 2]], '장소')]
    const events = [entry('늦은 전투', [['참여', 9]], '사건'), entry('이른 전투', [['참여', 2]], '사건'), entry('미정 전투', [['참여', null]], '사건')]
    const { ring, rest, events: ev } = layoutOf(groupNeighbors([...places, ...people, ...events]))
    expect(RING_MAX).toBe(16)
    expect(ring).toHaveLength(16)
    expect(rest).toBe(22 - 16) // 사건을 뺀 22명 중 둘레에 못 둔 수
    expect(ring[0].id).toBe('인물0') // 관계·바뀐 횟수가 가장 많은 이웃이 먼저
    expect(ring.at(-1)!.id).toBe('성') // 많은 순(같으면 이름순)으로 뽑힌 뒤 유형 묶음 순이라 뽑힌 장소는 인물 뒤에 붙는다
    const kinds = ring.map((x) => x.kind)
    expect(kinds).toEqual([...kinds].sort((a, b) => ['인물', '장소'].indexOf(a) - ['인물', '장소'].indexOf(b))) // 인물이 먼저, 장소는 그 뒤
    expect(ev.map((x) => x.id)).toEqual(['이른 전투', '늦은 전투', '미정 전투'])
    expect(ring.some((x) => x.kind === '사건')).toBe(false)
  })

  it('해리 포터급(이웃 89명·사건 80개)에서도 그림은 16개이고 나머지는 목록으로 남는다', () => {
    const rows = [...Array.from({ length: 89 }, (_, i) => entry('이웃' + i, [['관계', 1 + (i % 7)]], i % 3 ? '인물' : '장소')), ...Array.from({ length: 80 }, (_, i) => entry('사건' + i, [['참여', 1 + (i % 50)]], '사건'))]
    const { ring, rest, events } = layoutOf(groupNeighbors(rows))
    expect([ring.length, rest, events.length]).toEqual([16, 73, 80])
  })

  it('이웃이 없으면 모두 비어 있다', () => {
    expect(layoutOf([])).toEqual({ ring: [], rest: 0, people: [], events: [] })
  })
})
