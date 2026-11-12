import { describe, expect, it } from 'vitest'

import { cardTypePatch, type CardType } from '../../../../domain/entities/studioCards'
import { putRelation } from '../../../../domain/entities/studioRelations'
import { newSetting, type StudioSetting } from '../../../../domain/entities/studioWorld'
import { boardKindCounts, boardRows } from '../../../shared/worldBoard'
import { settingBoardEntries, settingLinks } from './settingBoard'

const card = (title: string, type: CardType, text = ''): StudioSetting => {
  const s = newSetting()
  Object.assign(s.item, cardTypePatch(s.item, type, []), { title, text })
  return s
}
const friends = (settings: StudioSetting[], a: StudioSetting, b: StudioSetting, predicate = 'friend_of') => putRelation(settings, { subjectId: a.item.id, targetId: b.item.id, predicate, polarity: 'asserted' })
const names = (links: { title: string; label: string }[]) => links.map((l) => `${l.title}·${l.label}`)

describe('settingBoardEntries', () => {
  it('관계·메모·분류 확인 항목은 게시판에서 빼고 카드만 유형 이름·묶음과 함께 싣는다(제목이 비면 이름 없는 설정)', () => {
    const [orr, harbor, ability, blank] = [card('오르', 'character', '스승'), card('새벽항', 'location'), card('빗결 보법', 'ability'), card('', 'rule', '금기')]
    const note = newSetting('notes'), review = newSetting()
    const settings = friends([orr, harbor, ability, blank, note, review], orr, harbor)
    expect(settings).toHaveLength(7) // 관계 하나가 더해졌다
    expect(settingBoardEntries(settings).map((e) => [e.cardId === orr.item.id, e.title, e.type, e.kind, e.text])).toEqual([
      [true, '오르', '인물', '인물', '스승'], [false, '새벽항', '장소', '장소', ''], [false, '빗결 보법', '능력', '기타', ''], [false, '이름 없는 설정', '규칙', '규칙', '금기'],
    ])
  })

  it('요약 열은 공개 설정집처럼 마크다운 기호를 벗긴 한 줄 글로 싣는다', () => {
    const lore = card('율도국', 'location', '## 개요\n**섬나라**이고 - 이상향')
    expect(settingBoardEntries([lore])[0].text).not.toMatch(/[#*]/)
  })

  it('연결 수는 이어진 카드 수라 같은 두 카드를 관계·감정으로 여러 번 이어도 하나이고, 인물의 제목 옆 수는 관계로 이어진 상대 수다', () => {
    const [garam, narae, harbor] = [card('가람', 'character'), card('나래', 'character'), card('항구', 'location')]
    let settings = friends([garam, narae, harbor], garam, narae)
    settings = friends(settings, garam, narae, 'trusts')
    settings = friends(settings, garam, harbor, 'custom_relation')
    const by = Object.fromEntries(settingBoardEntries(settings).map((e) => [e.title, e]))
    expect([by.가람.connections, by.가람.badge]).toEqual([2, 2]) // 나래(관계 2개)·항구
    expect([by.나래.connections, by.나래.badge]).toEqual([1, 1])
    expect([by.항구.connections, by.항구.badge]).toEqual([1, 1]) // 인물이 아니면 제목 옆 수도 연결 수
  })

  it('관련 설정(relatedIds)과 앞선 사건(afterId)도 연결이고 어느 쪽에서 썼든 양쪽 카드에 한 번씩 센다', () => {
    const [gate, war, peace] = [card('성문', 'location'), card('전쟁', 'event'), card('평화', 'event')]
    war.item.relatedIds = [gate.item.id]
    peace.item.afterId = war.item.id
    const by = Object.fromEntries(settingBoardEntries([gate, war, peace]).map((e) => [e.title, e.connections]))
    expect(by).toEqual({ 성문: 1, 전쟁: 2, 평화: 1 })
  })

  it('게시판 규칙(boardRows)과 이어 붙이면 설정집 순서·연결 많은 순으로 번호가 매겨진다', () => {
    const [garam, narae, harbor] = [card('가람', 'character'), card('나래', 'character'), card('항구', 'location')]
    const entries = settingBoardEntries(friends([harbor, narae, garam], garam, harbor))
    expect(boardRows(entries).map((r) => [r.no, r.title])).toEqual([[1, '나래'], [2, '가람'], [3, '항구']]) // 인물(넣은 순서) → 장소
    expect(boardRows(entries, { sort: 'links' }).map((r) => r.title)).toEqual(['가람', '항구', '나래']) // 연결 1·1·0은 가람·항구 순으로 설정집 순서
    expect(boardKindCounts(entries)).toEqual([{ kind: '인물', count: 2 }, { kind: '장소', count: 1 }])
  })
})

describe('settingLinks', () => {
  it('카드 한 장에 이어진 카드를 쓴 순서로 모으고 관계는 관계 이름을, 연관은 관련 설정·앞선 사건·이후 사건을 이름으로 단다', () => {
    const [garam, narae, harbor, war] = [card('가람', 'character'), card('나래', 'character'), card('항구', 'location'), card('전쟁', 'event')]
    garam.item.relatedIds = [war.item.id]
    harbor.item.relatedIds = [garam.item.id]
    war.item.afterId = harbor.item.id
    const settings = friends(friends([garam, narae, harbor, war], garam, narae), narae, garam, 'trusts')
    expect(names(settingLinks(settings, garam.item.id))).toEqual(['나래·친구', '나래·신뢰', '전쟁·관련 설정', '항구·관련 설정'])
    expect(names(settingLinks(settings, harbor.item.id))).toEqual(['가람·관련 설정', '전쟁·이후 사건'])
    expect(names(settingLinks(settings, war.item.id))).toEqual(['가람·관련 설정', '항구·앞선 사건'])
    expect(settingLinks(settings, garam.item.id).map((l) => l.via)).toEqual(['relation', 'relation', 'link', 'link'])
  })

  it('없는 카드·자기 자신·카드가 아닌 항목(메모)을 가리키는 연결은 버리고 연결이 없으면 빈 목록이다', () => {
    const [garam, narae] = [card('가람', 'character'), card('나래', 'character')]
    const note = newSetting('notes')
    garam.item.relatedIds = [garam.item.id, note.item.id, 'missing']
    expect(settingLinks([garam, narae, note], garam.item.id)).toEqual([])
    expect(settingLinks([garam, narae, note], 'missing')).toEqual([])
  })
})
