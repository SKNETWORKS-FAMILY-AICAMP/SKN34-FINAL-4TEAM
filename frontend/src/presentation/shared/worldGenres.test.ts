import { describe, expect, it } from 'vitest'

import type { Genre } from '../../domain/entities/genre'
import { ALL_CHIP, UNSET_COLOR, UNSET_GENRE, genreCode, genreColor, genreKey, genreLabel, worldChips } from './worldGenres'

const g = (code: string, name: string, emoji: string | null = null): Genre => ({ code, name, emoji, featured: false })
const world = (genre: string | null, genreName?: string | null) => ({ genre, genreName })

describe('세계관 장르 라벨', () => {
  it('장르 이름이 있으면 그 이름이고 장르 없음·숨긴 장르(이름 없음)는 미지정이다', () => {
    expect(genreLabel(world('genre-14', 'SF'))).toBe('SF')
    expect([genreLabel(world(null, null)), genreLabel(world('genre-99', null)), genreLabel(world('genre-99'))]).toEqual([UNSET_GENRE, UNSET_GENRE, UNSET_GENRE])
    expect(UNSET_GENRE).toBe('미지정')
  })

  it('장르 구분 키는 이름을 아는 장르의 코드이고 장르 없음·숨긴 장르는 빈 키다', () => {
    expect(genreKey(world('genre-14', 'SF'))).toBe('genre-14')
    expect([genreKey(world(null, null)), genreKey(world('genre-99', null)), genreKey(world('genre-99'))]).toEqual(['', '', ''])
  })
})

describe('장르 색', () => {
  it('같은 장르는 늘 같은 색이고 시드 장르 일곱 개는 서로 다르며 장르 없음은 회색이다', () => {
    const codes = ['genre-01', 'genre-03', 'genre-06', 'genre-10', 'genre-14', 'genre-18', 'genre-28']
    expect(new Set(codes.map(genreColor)).size).toBe(7)
    expect(genreColor('genre-14')).toBe(genreColor('genre-14'))
    for (const code of [...codes, 'genre-31']) expect(genreColor(code), code).toMatch(/^#[0-9a-f]{6}$/i)
    expect(genreColor('')).toBe(UNSET_COLOR)
    expect(UNSET_COLOR).toMatch(/^#[0-9a-f]{6}$/i)
  })
})

describe('세계관 장르 칩', () => {
  const genres = [g('genre-01', '판타지', '✨'), g('genre-03', '무협'), g('genre-14', 'SF', '🛰')]

  it('첫 칩은 추천이고 세계관이 있는 장르마다 아이콘 이름 칩 하나씩이며 공개 장르 목록 순서다', () => {
    const worlds = [world('genre-14'), world('genre-01'), world('genre-14')]
    expect(worldChips(genres, worlds)).toEqual([{ label: ALL_CHIP, genre: ALL_CHIP }, { label: '✨ 판타지', genre: '판타지' }, { label: '🛰 SF', genre: 'SF' }])
  })

  it('세계관이 없는 장르와 목록에 없는 장르(숨김)·장르 없음은 칩이 없다', () => {
    expect(worldChips(genres, [world('genre-03'), world('genre-99'), world(null)])).toEqual([{ label: ALL_CHIP, genre: ALL_CHIP }, { label: '무협', genre: '무협' }])
    expect(worldChips(genres, [])).toEqual([{ label: ALL_CHIP, genre: ALL_CHIP }])
  })

  it('칩의 장르 값(이름)은 목록 쿼리 코드로 바뀌고 추천 칩·목록에 없는 값은 장르를 거르지 않는다(undefined)', () => {
    expect(genreCode(genres, 'SF')).toBe('genre-14')
    expect([genreCode(genres, ALL_CHIP), genreCode(genres, '없는 장르'), genreCode([], 'SF')]).toEqual([undefined, undefined, undefined])
  })
})
