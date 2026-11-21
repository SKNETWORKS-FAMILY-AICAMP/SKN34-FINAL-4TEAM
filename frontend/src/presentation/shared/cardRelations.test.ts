import { describe, expect, it } from 'vitest'
import { MAP_H, MAP_RY, MAP_W, RING_MAX, atEpisode, clip, edgeTexts, ellipsize, episodeTabs, groupNeighbors, layoutOf, nodeText, ringSpots, type RelationEntry } from './cardRelations'
import { textWidth } from './textWidth'
import type { CardKind } from './worldBoard'

let n = 0
const entry = (other: string, steps: [string, number | null, string?][], kind: CardKind = '인물'): RelationEntry => ({ id: 'r' + ++n, otherId: other, otherTitle: other, otherKind: kind, steps: steps.map(([name, episode, body]) => ({ name, episode, ...(body ? { body } : {}) })) })

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

describe('notes: 펼친 안에서만 보이는 관계 본문', () => {
  it('이웃마다 관계의 현재(마지막 단계) 본문을 이름과 함께 모으고 같은 본문은 한 번만, 빈 본문은 뺀다', () => {
    const [n1] = groupNeighbors([
      entry('길현', [['이복형', 2, '길현과 홍길동은 이복형제다.'], ['형님', 6, '길동은 길현을 형님이라 부른다.']]),
      entry('길현', [['동행', 3, '길현과 홍길동은 이복형제다.'], ['동행', 4]]), // 마지막 단계의 본문이 비었다
      entry('길현', [['형제', 5, '길동은 길현을 형님이라 부른다.']]), // 같은 본문
    ])
    expect(n1.notes).toEqual([{ name: '형님', body: '길동은 길현을 형님이라 부른다.' }])
    expect(groupNeighbors([entry('나', [['친구', 1]])])[0].notes).toEqual([])
  })
})

describe('글자 폭·말줄임', () => {
  it('clip은 8자를 넘으면 8자 뒤에 …를 붙이고 이하면 그대로다', () => {
    expect(clip('초부석을 들어 올려 보였다', 8)).toBe('초부석을 들어 …')
    expect(clip('이복형', 8)).toBe('이복형')
    expect(clip('가나다라마바사아', 8)).toBe('가나다라마바사아')
  })

  it('ellipsize는 폭(px)에 들게 뒤를 …로 줄이고, …도 못 담을 만큼 좁으면 빈 글이다', () => {
    expect(ellipsize('가'.repeat(20), 60, 12)).toBe('가가가가…') // 48 + …(6.7) ≤ 60
    expect(textWidth(ellipsize('가'.repeat(20), 60, 12), 12)).toBeLessThanOrEqual(60)
    expect(ellipsize('이복형', 60, 12)).toBe('이복형')
    expect(ellipsize('가나다', 5, 12)).toBe('')
  })
})

describe('ringSpots·nodeText: 이웃 이름이 상자 밖으로 잘리지 않는다', () => {
  const people = (count: number, title: string) => layoutOf(groupNeighbors(Array.from({ length: count }, (_, i) => entry(title + i, [['관계', 1 + i]])))).ring

  it('이웃은 타원 둘레에 위(가운데 위)에서 시계 방향으로 놓인다', () => {
    const spots = ringSpots(people(4, '이웃'))
    expect(spots).toHaveLength(4)
    expect([spots[0].x, spots[0].y]).toEqual([MAP_W / 2, MAP_H / 2 - MAP_RY])
    expect(spots[1].x).toBeGreaterThan(MAP_W / 2) // 시계 방향: 오른쪽
    expect(spots[2].y).toBeGreaterThan(MAP_H / 2) // 아래
    expect(spots[3].x).toBeLessThan(MAP_W / 2) // 왼쪽
  })

  it('왼쪽 이웃의 이름은 노드 왼쪽에 오른쪽 끝을 맞추고(end), 오른쪽 이웃은 오른쪽에 왼쪽 끝을 맞추며(start), 위·아래 이웃은 가운데(middle)다', () => {
    const [top, right, bottom, left] = ringSpots(people(4, '긴이름의이웃카드'))
    expect(nodeText(top).anchor).toBe('middle')
    expect(nodeText(bottom).anchor).toBe('middle')
    expect(nodeText(right).anchor).toBe('start')
    expect(nodeText(left).anchor).toBe('end')
    expect(nodeText(top).y).toBeLessThan(top.y) // 위쪽 노드의 이름은 노드 위
    expect(nodeText(bottom).y).toBeGreaterThan(bottom.y)
    expect(nodeText(right).x).toBeGreaterThan(right.x)
    expect(nodeText(left).x).toBeLessThan(left.x)
  })

  it('이웃 수가 1~16이고 이름이 아주 길어도 모든 이름의 글자 범위가 상자 폭 안이다(긴 이름은 말줄임)', () => {
    for (let count = 1; count <= 16; count++) {
      for (const spot of ringSpots(people(count, '다드 로드리고 가나다라마바사아자차카타파하'))) {
        const t = nodeText(spot), w = textWidth(t.text, 12)
        const [from, to] = t.anchor === 'start' ? [t.x, t.x + w] : t.anchor === 'end' ? [t.x - w, t.x] : [t.x - w / 2, t.x + w / 2]
        expect(from, count + ':' + spot.n.title).toBeGreaterThanOrEqual(0)
        expect(to, count + ':' + spot.n.title).toBeLessThanOrEqual(MAP_W)
      }
    }
    const left = ringSpots(people(4, '다드 로드리고 가나다라마바사아'))[3]
    expect(nodeText(left).text.endsWith('…')).toBe(true) // 왼쪽 이웃의 긴 이름은 잘리지 않고 말줄임이다
  })
})

describe('edgeTexts: 선 이름', () => {
  const spotsOf = (rows: RelationEntry[]) => ringSpots(layoutOf(groupNeighbors(rows)).ring)
  const center = { x: MAP_W / 2, y: MAP_H / 2 }

  it('선 이름은 관계 이름만이고(8자 넘으면 말줄임, 외 N은 붙이지 않는다) 선의 바깥쪽 60~70% 지점에 놓인다', () => {
    const spots = spotsOf([entry('가', [['초부석을 들어 올림 관계', 1]]), entry('가', [['친구', 2]])])
    const [text] = edgeTexts(spots)
    expect(text.text).toBe('친구') // 가장 늦은 회차의 이름
    const long = edgeTexts(spotsOf([entry('나', [['초부석을 들어 올려 보였다', 1]])]))[0]
    expect(long.text).toBe('초부석을 들어 …')
    const spot = spots[0], full = Math.hypot(spot.x - center.x, spot.y - center.y), at = Math.hypot(text.x - center.x, text.y - center.y)
    expect(at / full).toBeGreaterThan(0.58)
    expect(at / full).toBeLessThan(0.72)
  })

  it('겹치는 선 이름은 숨긴다(관계가 많은 이웃의 이름이 먼저 남는다) — 목록에 모두 있다', () => {
    // 위쪽에 가까이 놓인 두 이웃: 같은 방향이라 이름이 겹친다
    const rows = Array.from({ length: 16 }, (_, i) => entry('이웃' + i, [['아주 긴 관계 이름' + i, 1]]))
    rows[1].steps = [...rows[1].steps, { name: '더 많은 관계', episode: 2 }] // 이웃1이 가장 무겁다
    const spots = spotsOf(rows), shown = edgeTexts(spots)
    expect(shown.length).toBeLessThan(16)
    expect(shown.length).toBeGreaterThan(0)
    expect(shown.some((t) => t.id === '이웃1')).toBe(true)
    const boxes = shown.map((t) => ({ l: t.x - textWidth(t.text, 11) / 2, r: t.x + textWidth(t.text, 11) / 2, y: t.y }))
    for (const [i, a] of boxes.entries()) for (const b of boxes.slice(i + 1)) expect(a.r <= b.l || b.r <= a.l || Math.abs(a.y - b.y) >= 11, '겹치는 선 이름이 남았다').toBe(true)
  })

  it('겹치지 않으면 모두 남는다', () => {
    expect(edgeTexts(spotsOf([entry('가', [['친구', 1]]), entry('나', [['동료', 1]]), entry('다', [['스승', 1]]), entry('라', [['제자', 1]])]))).toHaveLength(4)
  })
})
