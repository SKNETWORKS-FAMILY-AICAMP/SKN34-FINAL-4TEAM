import { describe, expect, it } from 'vitest'
import { putRelation } from '../../../../domain/entities/studioRelations'
import { newSetting, type StudioSetting } from '../../../../domain/entities/studioWorld'
import { COLUMN_CAP, PAGE_COLUMNS, buildTimeline } from './worldTimeline'

const event = (title: string, reveal?: number, item: Partial<StudioSetting['item']> = {}): StudioSetting => {
  const row = newSetting()
  Object.assign(row.item, { kind: 'event', title, timeText: '', ...item })
  if (reveal) row.revealFromEpisode = reveal
  return row
}
const card = (title: string, section: 'people' | 'places' | 'object' = 'people') => {
  const row = newSetting(section === 'object' ? 'people' : section)
  row.item.title = title
  if (section === 'object') row.item.entityType = 'object'
  return row
}
const relate = (rows: StudioSetting[], from: StudioSetting, to: StudioSetting, text: string, fromEpisode?: number) =>
  putRelation(rows, { subjectId: from.item.id, targetId: to.item.id, predicate: 'custom_relation_directed', polarity: 'asserted', text, ...(fromEpisode ? { fromEpisode } : {}) })
const names = (rows: StudioSetting[]) => buildTimeline(rows).columns.map((c) => [c.label, c.events.map((e) => e.item.title)])

describe('buildTimeline 정렬: ①사건 카드 공개 회차 ②걸린 관계의 가장 이른 시작 회차 ③afterId 사슬 ④기존 순서', () => {
  it('① 공개 회차가 같은 사건은 같은 열에 모이고, 열은 회차 오름차순이며 라벨은 N화다', () => {
    expect(names([event('가', 5), event('나', 2), event('다', 2)])).toEqual([['2화', ['나', '다']], ['5화', ['가']]])
    expect(buildTimeline([event('가', 5)]).columns[0]).toMatchObject({ key: '5', episode: 5, label: '5화' })
  })

  it('② 공개 회차가 없으면 그 사건에 걸린 관계의 가장 이른 시작 회차를 쓰고, 공개 회차가 있으면 그것이 이긴다', () => {
    const [a, b, hero] = [event('가'), event('나', 7), card('주인공')]
    let rows = relate([a, b, hero], hero, a, '참여', 4)
    rows = relate(rows, hero, a, '목격', 3) // 같은 사건에 걸린 더 이른 관계
    rows = relate(rows, hero, b, '참여', 2)
    expect(names(rows)).toEqual([['3화', ['가']], ['7화', ['나']]]) // 나는 공개 회차 7이 관계 2보다 앞선다
  })

  it('③ 둘 다 없으면 afterId로 이은 앞선 사건의 회차를 따라 같은 열 아래에 놓이고, 같은 열에서는 사슬이 앞선 사건이 위다', () => {
    const [x, y] = [event('엑스'), event('와이', 5)]
    x.item.afterId = y.item.id // 엑스는 와이 뒤(기존 순서로는 엑스가 앞)
    expect(names([x, y])).toEqual([['5화', ['와이', '엑스']]])
  })

  it('④ 회차 단서가 없는 사건은 마지막 시점 미정 열에 기존 순서로 모인다', () => {
    const t = buildTimeline([event('가'), event('나', 1), event('다')])
    expect(t.columns.map((c) => [c.label, c.key, c.episode])).toEqual([['1화', '1', 1], ['시점 미정', 'none', null]])
    expect(t.columns[1].events.map((e) => e.item.title)).toEqual(['가', '다'])
  })

  it('승인하지 않은 사건·사건이 아닌 카드는 무시하고, 없으면 빈 시간선이다', () => {
    const pending = event('후보'); pending.item.decision = 'candidate' as never
    expect(buildTimeline([pending, card('가람')])).toEqual({ columns: [], arrows: [] })
  })

  it('afterId가 서로를 가리켜도(순환) 끝나고 열이 만들어진다', () => {
    const [a, b] = [event('가'), event('나')]
    a.item.afterId = b.item.id; b.item.afterId = a.item.id
    expect(buildTimeline([a, b]).columns[0].events).toHaveLength(2)
  })
})

describe('buildTimeline 참여 인물·장소와 화살표', () => {
  it('사건에 걸린 관계의 상대 중 인물·장소만 참여 칩이 된다(정보 관계·다른 유형·중복은 뺀다)', () => {
    const [e, hero, port, rule, other] = [event('전투', 3), card('주인공'), card('항구', 'places'), card('명검', 'object'), card('목격자')]
    let rows = [e, hero, port, rule, other]
    rows = relate(rows, hero, e, '참여')
    rows = relate(rows, hero, e, '지휘') // 같은 인물의 두 번째 관계: 한 번만
    rows = relate(rows, e, port, '발생 장소')
    rows = relate(rows, e, rule, '관련')
    rows = relate(rows, other, e, '알고 있음') // 정보 관계: 참여가 아니다
    const [event0] = buildTimeline(rows).columns[0].events
    expect(event0.participants.map((p) => [p.title, p.type])).toEqual([['주인공', 'character'], ['항구', 'location']])
  })

  it('afterId가 가리키는 사건이 있으면 화살표(앞선 → 뒤)를 만들고 없으면 만들지 않는다', () => {
    const [a, b, c] = [event('가', 1), event('나', 2), event('다', 3)]
    b.item.afterId = a.item.id
    c.item.afterId = '없는-사건'
    expect(buildTimeline([a, b, c]).arrows).toEqual([{ from: a.item.id, to: b.item.id }])
  })
})

it('회차마다 사건이 많으면 한 열을 접고, 한 쪽에 20열씩 보인다(상수)', () => {
  expect([PAGE_COLUMNS, COLUMN_CAP]).toEqual([20, 6])
})

it('큰 세계관(사건 1634·회차 199·관계 4732)도 한도 안에서 회차 열로 묶는다', () => {
  const people = Array.from({ length: 570 }, (_, i) => card('인물' + i))
  const events = Array.from({ length: 1634 }, (_, i) => event('사건' + i, 1 + (i % 199)))
  let rows: StudioSetting[] = [...people, ...events]
  const t0 = performance.now()
  const relations = Array.from({ length: 4732 }, (_, i) => ({ subjectId: people[i % 570].item.id, targetId: events[(i * 7) % 1634].item.id, predicate: 'custom_relation_directed', polarity: 'asserted' as const, text: '참여' + (i % 700) }))
  // putRelation은 쓰는 쪽 검사가 무거우므로 관계 행은 직접 만든다
  rows = [...rows, ...relations.map((r) => { const row = newSetting(); Object.assign(row.item, { kind: 'relation', ...r, title: r.text }); return row })]
  const timeline = buildTimeline(rows)
  expect(timeline.columns).toHaveLength(199)
  expect(timeline.columns.reduce((sum, c) => sum + c.events.length, 0)).toBe(1634)
  expect(Math.max(...timeline.columns.map((c) => c.events.length))).toBeLessThanOrEqual(9)
  expect(performance.now() - t0).toBeLessThan(3000)
})
