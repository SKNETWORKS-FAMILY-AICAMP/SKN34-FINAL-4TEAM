import { describe, expect, it } from 'vitest'

import { PUBLIC_WORLD_GENRES } from '../../domain/entities/publicWorld'
import { ALL_CHIP, UNSET_GENRE, WORLD_CHIPS, WORLD_GENRES, genreCode, genreLabel, worldLook } from './worldGenres'

describe('장르 라벨 ↔ 서버 코드', () => {
  it('일곱 장르 라벨이 서버 장르 코드와 일대일로 이어지고 서로 되돌려진다', () => {
    expect(WORLD_GENRES.map(genreCode)).toEqual([...PUBLIC_WORLD_GENRES])
    expect(PUBLIC_WORLD_GENRES.map(genreLabel)).toEqual([...WORLD_GENRES])
  })

  it('장르가 정해지지 않은 세계관(null)은 미지정 라벨이고 모르는 라벨은 코드가 없다', () => {
    expect(genreLabel(null)).toBe(UNSET_GENRE)
    expect([genreCode(UNSET_GENRE), genreCode('추천'), genreCode('✨ 판타지'), genreCode('')]).toEqual([undefined, undefined, undefined, undefined])
  })
})

describe('칩의 장르 값 → 목록 쿼리 코드', () => {
  it('추천 칩은 장르 쿼리를 보내지 않고(undefined) 장르 칩은 그 장르의 서버 코드이며 이모지가 붙은 칩 라벨은 코드가 아니다', () => {
    expect(genreCode(ALL_CHIP)).toBeUndefined()
    expect(WORLD_CHIPS.slice(1).map((c) => genreCode(c.genre))).toEqual([...PUBLIC_WORLD_GENRES])
    for (const c of WORLD_CHIPS.slice(1)) expect(genreCode(c.label), c.label).toBeUndefined()
  })
})

describe('WORLD_CHIPS', () => {
  it('첫 칩은 추천이고 나머지는 장르마다 이모지 라벨 칩 하나씩이다', () => {
    expect(WORLD_CHIPS[0]).toEqual({ label: ALL_CHIP, genre: ALL_CHIP })
    expect(WORLD_CHIPS.slice(1).map((c) => c.genre)).toEqual([...WORLD_GENRES])
    for (const c of WORLD_CHIPS.slice(1)) {
      expect(c.label.endsWith(` ${c.genre}`), c.label).toBe(true)
      expect(c.label.codePointAt(0), c.label).toBeGreaterThan(0x2000) // 이모지로 시작한다
    }
  })
})

describe('worldLook', () => {
  it('모든 장르에 표지 테마와 배경색이 있고 한지 테마만 밝은 면이다', () => {
    for (const genre of [...PUBLIC_WORLD_GENRES, null]) {
      const { theme, bg, lite } = worldLook(genre)
      expect(bg, String(genre)).toMatch(/^#[0-9A-F]{6}$/i)
      expect(lite, String(genre)).toBe(theme === 'hanji')
    }
  })
})
