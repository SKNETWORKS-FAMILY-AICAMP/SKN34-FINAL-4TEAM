import { describe, expect, it } from 'vitest'

import { HOME_CHIP_ALL, HOME_CHIP_FORKS, HOME_CHIP_FREE, HOME_GENRE_LIMIT, emojiName, genreNameOf, genreOptions, homeChips, moveCode, type Genre } from '../entities/genre'

const g = (code: string, name: string, emoji: string | null = null, featured = false): Genre => ({ code, name, emoji, featured })

describe('홈 장르 칩', () => {
  it('추천 · 홈에 보이는 장르(아이콘 이름, 서버 순서) · 무료 · 포크 많은 순서로 칩이 된다', () => {
    const genres = [g('genre-01', '판타지', '✨', true), g('genre-02', '현대판타지'), g('genre-14', 'SF', '🛰', true), g('genre-28', '고전', '📜', true)]
    expect(homeChips(genres)).toEqual([HOME_CHIP_ALL, '✨ 판타지', '🛰 SF', '📜 고전', HOME_CHIP_FREE, HOME_CHIP_FORKS])
    expect([HOME_CHIP_ALL, HOME_CHIP_FREE, HOME_CHIP_FORKS]).toEqual(['추천', '🆓 무료', '✎ 포크 많은'])
  })

  it('홈에 보이는 장르는 최대 여섯 개까지만 칩이 되고 아이콘이 없으면 이름만 쓴다', () => {
    const genres = Array.from({ length: 8 }, (_, i) => g(`genre-${i + 1}`, `장르${i + 1}`, i === 0 ? null : '🔥', true))
    const chips = homeChips(genres)
    expect(HOME_GENRE_LIMIT).toBe(6)
    expect(chips).toEqual([HOME_CHIP_ALL, '장르1', '🔥 장르2', '🔥 장르3', '🔥 장르4', '🔥 장르5', '🔥 장르6', HOME_CHIP_FREE, HOME_CHIP_FORKS])
  })

  it('홈에 보이는 장르가 없으면 장르 칩 없이 추천·무료·포크 많은만 남는다', () => {
    expect(homeChips([g('genre-01', '판타지')])).toEqual([HOME_CHIP_ALL, HOME_CHIP_FREE, HOME_CHIP_FORKS])
    expect(homeChips([])).toEqual([HOME_CHIP_ALL, HOME_CHIP_FREE, HOME_CHIP_FORKS])
  })
})

describe('장르 이름', () => {
  const genres = [g('genre-01', '판타지', '✨'), g('genre-14', 'SF')]

  it('코드로 이름을 찾고 목록에 없는 코드(숨긴 장르)·장르 없음은 이름이 없다(null)', () => {
    expect(genreNameOf(genres, 'genre-14')).toBe('SF')
    expect(genreNameOf(genres, 'genre-99')).toBeNull()
    expect(genreNameOf(genres, null)).toBeNull()
  })

  it('아이콘이 있으면 아이콘과 이름을, 없으면 이름만 쓴다', () => {
    expect(genres.map(emojiName)).toEqual(['✨ 판타지', 'SF'])
  })
})

describe('순서 옮기기', () => {
  const codes = ['a', 'b', 'c']

  it('코드를 위·아래로 한 칸 옮긴 전체 순서를 돌려주고 원본은 바꾸지 않는다', () => {
    expect(moveCode(codes, 'b', -1)).toEqual(['b', 'a', 'c'])
    expect(moveCode(codes, 'b', 1)).toEqual(['a', 'c', 'b'])
    expect(codes).toEqual(['a', 'b', 'c'])
  })

  it('맨 앞을 위로·맨 뒤를 아래로 옮기거나 없는 코드를 옮기면 null이다', () => {
    expect([moveCode(codes, 'a', -1), moveCode(codes, 'c', 1), moveCode(codes, 'x', 1)]).toEqual([null, null, null])
  })
})

describe('작품 장르 선택지', () => {
  const genres = [g('genre-01', '판타지'), g('genre-14', 'SF')]

  it('활성 장르 이름을 서버 순서대로 주고 이미 고른 값이 목록에 없으면(숨긴 장르) 맨 앞에 더해 그대로 보이게 한다', () => {
    expect(genreOptions(genres, [])).toEqual(['판타지', 'SF'])
    expect(genreOptions(genres, ['SF', ''])).toEqual(['판타지', 'SF'])
    expect(genreOptions(genres, ['사극', 'SF'])).toEqual(['사극', '판타지', 'SF'])
  })

  it('목록을 아직 읽지 못했어도(빈 목록) 이미 고른 값은 선택지에 남는다', () => {
    expect(genreOptions([], ['판타지', '', '판타지'])).toEqual(['판타지'])
  })
})
