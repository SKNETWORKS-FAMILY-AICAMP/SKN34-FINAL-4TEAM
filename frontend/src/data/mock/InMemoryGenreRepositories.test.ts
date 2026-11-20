import { describe, expect, it } from 'vitest'

import { HOME_GENRE_LIMIT } from '../../domain/entities/genre'
import { OperationsError, OperationsRejected } from '../../domain/entities/operations'
import { InMemoryGenreRepository, InMemoryOperationsGenreRepository } from './InMemoryGenreRepositories'

const setup = () => {
  const operations = new InMemoryOperationsGenreRepository()
  return { operations, genres: new InMemoryGenreRepository(operations) }
}

describe('메모리 장르 저장소', () => {
  it('시드는 서버 시드와 같은 30개(genre-01 판타지 … genre-30 기타)이고 판타지·SF·고전만 홈에 보이며 아이콘은 ✨·🛰·📜다', async () => {
    const all = await setup().operations.list()
    expect(all).toHaveLength(30)
    expect([all[0], all[13], all[27], all[29]].map((g) => [g.code, g.name])).toEqual([['genre-01', '판타지'], ['genre-14', 'SF'], ['genre-28', '고전'], ['genre-30', '기타']])
    expect(all.filter((g) => g.featured).map((g) => [g.code, g.emoji])).toEqual([['genre-01', '✨'], ['genre-14', '🛰'], ['genre-28', '📜']])
    expect(all.every((g) => g.active && g.emoji === (g.featured ? g.emoji : null))).toBe(true)
    expect(all.map((g) => g.position)).toEqual(Array.from({ length: 30 }, (_, i) => i + 1))
  })

  it('공개 목록은 숨긴 장르를 빼고 표시 순서대로 코드·이름·아이콘·홈 노출만 준다', async () => {
    const { operations, genres } = setup()
    await operations.update('genre-02', { active: false })
    await operations.reorder(['genre-03', ...(await operations.list()).map((g) => g.code).filter((c) => c !== 'genre-03')])
    const list = await genres.list()
    expect(list).toHaveLength(29)
    expect(list.slice(0, 3)).toEqual([
      { code: 'genre-03', name: '무협', emoji: null, featured: false },
      { code: 'genre-01', name: '판타지', emoji: '✨', featured: true },
      { code: 'genre-04', name: '선협', emoji: null, featured: false },
    ])
  })

  it('추가는 다음 코드(genre-31)로 맨 뒤에 활성·홈 숨김으로 붙고 같은 이름은 거절한다', async () => {
    const { operations } = setup()
    await operations.create({ name: '사극', emoji: '🎬' })
    expect((await operations.list()).at(-1)).toEqual({ code: 'genre-31', name: '사극', emoji: '🎬', active: true, featured: false, position: 31, workCount: 0, worldCount: 0 })
    await expect(operations.create({ name: '사극' })).rejects.toThrow(new OperationsRejected('이미 같은 이름의 장르가 있어요.'))
    await expect(operations.create({ name: '판타지' })).rejects.toBeInstanceOf(OperationsRejected)
  })

  it('수정은 이름·아이콘(빈 문자열은 지움)·숨김을 운영·공개 목록에 같이 반영하고 이름 중복·없는 코드는 거절한다', async () => {
    const { operations, genres } = setup()
    await operations.update('genre-02', { name: '퓨전 판타지', emoji: '🔮' })
    await operations.update('genre-01', { emoji: '' })
    await operations.update('genre-03', { active: false })
    expect((await operations.list()).slice(0, 3).map((g) => [g.name, g.emoji, g.active])).toEqual([['판타지', null, true], ['퓨전 판타지', '🔮', true], ['무협', null, false]])
    expect((await genres.list()).some((g) => g.code === 'genre-03')).toBe(false)
    await expect(operations.update('genre-02', { name: '판타지' })).rejects.toBeInstanceOf(OperationsRejected)
    await expect(operations.update('genre-02', { name: '퓨전 판타지' })).resolves.toBeUndefined() // 자기 이름은 중복이 아니다
    await expect(operations.update('genre-99', { active: false })).rejects.toBeInstanceOf(OperationsError)
  })

  it('홈 노출은 일곱 번째를 거절하고 하나를 끄면 다시 켤 수 있다', async () => {
    const { operations } = setup()
    for (const code of ['genre-02', 'genre-03', 'genre-04']) await operations.update(code, { featured: true })
    expect((await operations.list()).filter((g) => g.featured)).toHaveLength(HOME_GENRE_LIMIT)
    await expect(operations.update('genre-05', { featured: true })).rejects.toThrow(new OperationsRejected('홈에 보이는 장르는 최대 6개예요. 다른 장르의 홈 노출을 먼저 꺼 주세요.'))
    await operations.update('genre-02', { featured: false })
    await expect(operations.update('genre-05', { featured: true })).resolves.toBeUndefined()
  })

  it('순서는 전체 코드의 새 순서로 바꾸고 빠짐·중복·없는 코드는 거절한다', async () => {
    const { operations } = setup()
    const codes = (await operations.list()).map((g) => g.code)
    await operations.reorder([codes[1], codes[0], ...codes.slice(2)])
    expect((await operations.list()).slice(0, 2).map((g) => [g.code, g.position])).toEqual([['genre-02', 1], ['genre-01', 2]])
    for (const bad of [codes.slice(1), [...codes.slice(1), 'genre-02'], [...codes.slice(1), 'genre-99']]) {
      await expect(operations.reorder(bad)).rejects.toBeInstanceOf(OperationsError)
    }
  })
})
