import { describe, expect, it } from 'vitest'

import { PUBLIC_WORLD_GENRES } from '../../domain/entities/publicWorld'
import { DEMO_WORLDS } from './demoPublicWorlds'

describe('DEMO_WORLDS', () => {
  it('id가 겹치지 않아 /worlds/:id가 한 세계관만 가리키고 주소에 쓸 수 있는 글자만 쓴다', () => {
    const ids = DEMO_WORLDS.map((w) => w.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/)
  })

  it('모든 장르 칩에 세계관이 하나 이상 있고 칩에 없는 장르는 없다', () => {
    for (const genre of PUBLIC_WORLD_GENRES) expect(DEMO_WORLDS.filter((w) => w.genre === genre).length, genre).toBeGreaterThan(0)
    for (const w of DEMO_WORLDS) expect(PUBLIC_WORLD_GENRES, w.id).toContain(w.genre)
  })

  it('세계관마다 히어로 둘째 줄에 들어갈 13자 이하의 한 줄 소개가 있다', () => {
    for (const w of DEMO_WORLDS) {
      expect(w.hook.trim().length, w.id).toBeGreaterThan(0)
      expect(w.hook.length, w.id).toBeLessThanOrEqual(13)
    }
  })

  it('세계관마다 이름·설명·작가가 있고 설정 카드는 3~6개이며 카드 제목이 겹치지 않는다', () => {
    for (const w of DEMO_WORLDS) {
      expect([w.name, w.description, w.author].every((text) => text.trim().length > 0), w.id).toBe(true)
      expect(w.cards.length, w.id).toBeGreaterThanOrEqual(3)
      expect(w.cards.length, w.id).toBeLessThanOrEqual(9) // 상위 8개 세계관은 상세 탭 데모를 위해 인물 카드를 더해 최대 9장이다(나머지는 6장 이하)
      const titles = w.cards.map((c) => c.title)
      expect(new Set(titles).size, w.id).toBe(titles.length)
      expect(w.cards.every((c) => c.title.trim() && c.text.trim()), w.id).toBe(true)
    }
  })

  it('카드 연관의 대상은 같은 세계관의 다른 카드 제목이라 끊긴 연결이 없다', () => {
    for (const w of DEMO_WORLDS) {
      const titles = new Set(w.cards.map((c) => c.title))
      for (const c of w.cards) for (const link of c.links ?? []) {
        expect(titles.has(link.to), `${w.id}: ${c.title} → ${link.to}`).toBe(true)
        expect(link.to, `${w.id}: ${c.title}`).not.toBe(c.title)
      }
    }
  })
})

describe('DEMO_WORLDS 파생·조합', () => {
  const ids = new Set(DEMO_WORLDS.map((w) => w.id))

  it('세계관 지도가 풍성해 보이도록 공개 세계관이 20~30개다', () => {
    expect(DEMO_WORLDS.length).toBeGreaterThanOrEqual(20)
    expect(DEMO_WORLDS.length).toBeLessThanOrEqual(30)
  })

  it('원본 id는 모두 실제 세계관이고 자기 자신이 아니며 한 세계관이 파생과 조합을 함께 갖지 않는다', () => {
    for (const w of DEMO_WORLDS) {
      for (const origin of [...(w.derivedFrom ? [w.derivedFrom] : []), ...(w.combinedFrom ?? [])]) {
        expect(ids.has(origin), `${w.id} ← ${origin}`).toBe(true)
        expect(origin, w.id).not.toBe(w.id)
      }
      expect(Boolean(w.derivedFrom && w.combinedFrom), w.id).toBe(false)
    }
  })

  it('조합은 서로 다른 원본 둘 이상을 섞는다', () => {
    for (const w of DEMO_WORLDS.filter((x) => x.combinedFrom)) expect(new Set(w.combinedFrom).size, w.id).toBeGreaterThanOrEqual(2)
  })

  it('원본→파생→재파생 체인과 조합 세계관이 지도에 여럿 보인다', () => {
    const derived = new Map(DEMO_WORLDS.flatMap((w) => (w.derivedFrom ? [[w.id, w.derivedFrom] as const] : [])))
    expect([...derived.values()].filter((origin) => derived.has(origin)).length).toBeGreaterThanOrEqual(2)
    expect(DEMO_WORLDS.filter((w) => w.combinedFrom).length).toBeGreaterThanOrEqual(3)
  })
})

describe('DEMO_WORLDS 데모 작품', () => {
  it('상위 8개 세계관만 이 세계관으로 쓴 작품 1~3편을 갖고 나머지는 비어 있어 빈 상태도 보인다', () => {
    for (const w of DEMO_WORLDS.slice(0, 8)) {
      expect(w.works?.length, w.id).toBeGreaterThanOrEqual(1)
      expect(w.works?.length, w.id).toBeLessThanOrEqual(3)
    }
    for (const w of DEMO_WORLDS.slice(8)) expect(w.works ?? [], w.id).toEqual([])
  })

  it('작품마다 제목·작가가 있고 화 수는 양의 정수이며 장르는 세계관 장르 칩에 있고 제목이 한 세계관 안에서 겹치지 않는다', () => {
    for (const w of DEMO_WORLDS) {
      for (const work of w.works ?? []) {
        expect([work.title, work.author].every((text) => text.trim().length > 0), w.id).toBe(true)
        expect(Number.isInteger(work.episodes) && work.episodes > 0, `${w.id} ${work.title}`).toBe(true)
        expect(PUBLIC_WORLD_GENRES, `${w.id} ${work.title}`).toContain(work.genre)
      }
      const titles = (w.works ?? []).map((work) => work.title)
      expect(new Set(titles).size, w.id).toBe(titles.length)
    }
  })
})
