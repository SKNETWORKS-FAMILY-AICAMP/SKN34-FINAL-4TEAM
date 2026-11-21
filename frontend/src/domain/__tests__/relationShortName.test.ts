import { describe, expect, it } from 'vitest'
import { putRelation, relationShortName } from '../entities/studioRelations'
import { newSetting, type SettingItem, type StudioSetting } from '../entities/studioWorld'

const card = (title: string) => { const row = newSetting('people'); row.item.title = title; return row }
const [a, b] = [card('가람'), card('나래')]
const titleOf = (id: string | null) => [a, b].find((s) => s.item.id === id)?.item.title
const relation = (over: Partial<SettingItem> & { predicate: string }): StudioSetting => putRelation([a, b], { subjectId: a.item.id, targetId: b.item.id, polarity: 'asserted', ...over }).find((s) => s.item.kind === 'relation')!
const name = (row: StudioSetting) => relationShortName(row.item, titleOf)

describe('relationShortName: 그림·관계 종류·내보내기가 쓰는 짧은 이름', () => {
  it('서버에서 읽은 자유 관계는 항목 이름(label)이다 — 본문(text)이 이름으로 나오지 않는다', () => {
    const read = relation({ predicate: 'custom_relation_directed', title: '이복형', text: '길동은 초부석을 들어 올려 이복형 길현에게 보였다.' })
    expect(name(read)).toBe('이복형')
  })

  it('항목 이름이 비었거나 자동으로 지은 것(가람 · 관계 · 나래)이면 관계 문구(text)가 이름이다', () => {
    expect(name(relation({ predicate: 'custom_relation_directed', text: '친구' }))).toBe('친구') // 이름 없이 만든 관계: 자동 이름이 붙고 문구가 이름이다
    const blank = relation({ predicate: 'custom_relation', text: '동료' })
    expect(name({ ...blank, item: { ...blank.item, title: '  ' } })).toBe('동료')
  })

  it('정해진 관계는 정의 이름이고(항목 이름과 상관없다), 부정된 관계는 아님이 붙는다', () => {
    expect(name(relation({ predicate: 'friend_of', title: '아무 말', text: '설명' }))).toBe('친구')
    expect(name(relation({ predicate: 'custom_emotion', title: '질투', text: '긴 설명', polarity: 'denied' }))).toBe('질투 아님')
    expect(name(relation({ predicate: 'trusts', polarity: 'denied' }))).toBe('신뢰 아님')
  })

  it('양 끝 카드 이름을 모르면(지워진 카드) 선택 안 함으로 지은 이름과 비교한다(던지지 않는다)', () => {
    const read = relation({ predicate: 'custom_relation_directed', title: '이복형', text: '본문' })
    expect(relationShortName(read.item, () => undefined)).toBe('이복형')
  })
})
