import { describe, expect, it } from 'vitest'
import { cardLinkMarkdown } from '../../../../domain/entities/cardLinks'
import { putRelation } from '../../../../domain/entities/studioRelations'
import { newSetting, type StudioWorld } from '../../../../domain/entities/studioWorld'
import { EXPORT_SCHEMA_VERSION, exportFileName, worldToJson, worldToMarkdown } from './worldExport'

/** 홍문(인물)이 길동(인물)의 아버지고, 길동이 항구(장소)를 지키는 세계. 길동의 본문은 홍문 카드로 가는 링크를 담는다. */
function world(): StudioWorld {
  const father = newSetting('people'), son = newSetting('people'), port = newSetting('places')
  father.item.title = '홍문'; father.item.text = '길동의 아버지.'; father.revealFromEpisode = 1
  son.item.title = '길동'; son.aliases = ['홍길동']; son.tags = ['주인공']; son.revealFromEpisode = 3
  son.item.text = '아버지 ' + cardLinkMarkdown(father.item.id, '홍문') + '를 부른다.'
  port.item.title = '항구'; port.item.text = ''
  let rows = [father, son, port]
  rows = putRelation(rows, { subjectId: son.item.id, targetId: father.item.id, predicate: 'custom_relation_directed', polarity: 'asserted', text: '아버지', fromEpisode: 2 })
  rows = putRelation(rows, { subjectId: son.item.id, targetId: port.item.id, predicate: 'custom_relation_directed', polarity: 'asserted', text: '지킴' })
  return { id: 'w1', name: '홍길동: 세계/설정', description: '조선 배경의 세계관.', version: 4, settings: rows } as StudioWorld
}

describe('worldToJson', () => {
  it('저장한 세계관의 카드(id·유형·제목·별칭·태그·본문·공개 회차)와 관계(출발·도착·이름·설명·시작 회차)를 스키마 버전 하나와 함께 낸다', () => {
    const out = JSON.parse(worldToJson(world()))
    expect(out.schemaVersion).toBe(EXPORT_SCHEMA_VERSION)
    expect(Object.keys(out).sort()).toEqual(['cards', 'relations', 'schemaVersion', 'world'])
    expect(out.world).toEqual({ id: 'w1', name: '홍길동: 세계/설정', description: '조선 배경의 세계관.' })
    expect(out.cards.map((c: { title: string }) => c.title)).toEqual(['홍문', '길동', '항구'])
    const son = out.cards[1]
    expect(son).toEqual({ id: expect.any(String), type: 'character', title: '길동', aliases: ['홍길동'], tags: ['주인공'], text: expect.stringContaining('card:'), revealFromEpisode: 3 })
    expect(out.cards[2].revealFromEpisode).toBeNull() // 작가 전용
    expect(out.cards[2].type).toBe('location')
    expect(out.relations).toHaveLength(2)
    expect(out.relations[0]).toEqual({ id: expect.any(String), source: son.id, target: out.cards[0].id, name: '아버지', description: '', fromEpisode: 2 })
    expect(out.relations[1].fromEpisode).toBeNull()
  })

  it('관계의 끝점 카드가 없으면(지워진 설정) 그 관계는 내지 않는다', () => {
    const w = world()
    w.settings = w.settings.filter((s) => s.item.title !== '항구')
    expect(JSON.parse(worldToJson(w)).relations).toHaveLength(1)
  })
})

describe('worldToMarkdown', () => {
  it('세계관 제목·설명 아래 유형별 ## 아래 카드마다 ### 이름·본문(카드 링크는 글자만)과 관계 줄(들어오는 관계는 ←, N화부터)을 쓴다', () => {
    const md = worldToMarkdown(world())
    const lines = md.split('\n')
    expect(lines[0]).toBe('# 홍길동: 세계/설정')
    expect(lines[2]).toBe('조선 배경의 세계관.')
    expect(md.indexOf('## 인물')).toBeLessThan(md.indexOf('## 장소')) // 카드 유형 순서
    expect(md).not.toContain('## 조직') // 카드가 없는 유형은 쓰지 않는다
    expect(md).toContain('### 길동')
    expect(md).toContain('아버지 홍문를 부른다.') // 링크는 글자만
    expect(md).not.toContain('card:')
    expect(md).toContain('- 홍문 — 아버지 (2화부터)') // 길동 → 홍문
    expect(md).toContain('- ← 길동 — 아버지 (2화부터)') // 홍문 쪽에서 본 같은 관계
    expect(md).toContain('- 항구 — 지킴') // 시작 회차가 없으면 괄호 없음
    expect(md.indexOf('### 홍문')).toBeLessThan(md.indexOf('### 길동'))
  })

  it('설명이 없으면 설명 줄을 쓰지 않고 이름이 없는 카드는 이름 없는 설정이라 쓴다', () => {
    const w = world(); w.description = ''; w.settings[2].item.title = ''
    const md = worldToMarkdown(w)
    expect(md.split('\n')[1]).toBe('')
    expect(md).toContain('### 이름 없는 설정')
  })
})

describe('exportFileName', () => {
  it('세계관 이름-YYYYMMDD.확장자이고 파일 이름에 못 쓰는 글자는 _로 바꾸며 이름이 비면 세계관이다', () => {
    const day = new Date(2026, 10, 21, 9, 5)
    expect(exportFileName('홍길동: 세계/설정', 'json', day)).toBe('홍길동_ 세계_설정-20261121.json')
    expect(exportFileName('  ', 'md', day)).toBe('세계관-20261121.md')
    expect(exportFileName('가', 'md', new Date(2026, 0, 3))).toBe('가-20260103.md')
  })
})

describe('서버에서 읽은 자유 관계', () => {
  it('이름은 label(항목 이름)이고 설명은 본문이다 — 본문 문장이 이름으로 내려가지 않는다', () => {
    const [a, b] = [newSetting('people'), newSetting('people')]
    a.item.title = '길동'; b.item.title = '길현'
    const rows = putRelation([a, b], { subjectId: a.item.id, targetId: b.item.id, predicate: 'custom_relation_directed', polarity: 'asserted', title: '이복형', text: '길동은 길현을 이복형으로 따랐다.', fromEpisode: 2 })
    const w = { id: 'w', name: '홍길동전', description: '', version: 1, settings: rows } as StudioWorld
    expect(JSON.parse(worldToJson(w)).relations[0]).toMatchObject({ name: '이복형', description: '길동은 길현을 이복형으로 따랐다.', fromEpisode: 2 })
    expect(worldToMarkdown(w)).toContain('- 길현 — 이복형 (2화부터)')
  })
})

describe('운영자가 추가한 카테고리의 카드(운영자 콘텐츠 관리 결정 E)', () => {
  /** 기본 8종 다음에 쓰이는 추가 유형 카드 한 장짜리 세계관. */
  const custom = (): StudioWorld => {
    const hero = newSetting('people'), tribe = newSetting()
    hero.item.title = '길동'; hero.item.text = '주인공.'
    Object.assign(tribe.item, { kind: 'entity', entityType: 'category-09', title: '해월족', text: '바다에 사는 종족.' })
    return { id: 'w2', name: '바다 세계', description: '', version: 1, settings: [tribe, hero] } as StudioWorld
  }

  it('JSON은 추가 유형 코드를 그대로 낸다', () => {
    const out = JSON.parse(worldToJson(custom()))
    expect(out.cards.map((c: { type: string }) => c.type).sort()).toEqual(['category-09', 'character'])
  })

  it('Markdown은 기본 8종 묶음 다음에 추가 유형 카드를 쓴다(이름은 서버 목록에만 있어 기타 제목으로 묶는다)', () => {
    const md = worldToMarkdown(custom())
    expect(md.indexOf('## 인물')).toBeGreaterThan(-1)
    expect(md.indexOf('## 기타')).toBeGreaterThan(md.indexOf('## 인물'))
    expect(md).toContain('### 해월족')
  })
})
