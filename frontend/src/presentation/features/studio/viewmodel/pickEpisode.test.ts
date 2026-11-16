import { describe, expect, it } from 'vitest'

import { pickEpisode } from './pickEpisode'

const rows = [1, 2, 3].map((number) => ({ number, title: `${number}화` }))

describe('집필실이 처음 여는 회차', () => {
  it('주소의 ?ep=n이 회차 목록에 있으면 그 회차를 연다', () => {
    expect(pickEpisode(rows, 2)).toBe(rows[1])
    expect(pickEpisode(rows, 3)).toBe(rows[2])
  })

  it('?ep가 없으면 첫 회차를 연다 (기존 동작)', () => {
    expect(pickEpisode(rows)).toBe(rows[0])
    expect(pickEpisode(rows, undefined)).toBe(rows[0])
  })

  it.each([[9], [0], [-1], [1.5], [Number.NaN]])('없는 회차·범위 밖·정수가 아닌 값(%s)은 다른 회차로 보내지 않고 첫 회차를 연다', (ep) => {
    expect(pickEpisode(rows, ep)).toBe(rows[0])
  })

  it('목록 순서가 번호순이 아니어도 번호로 찾고, 회차가 하나도 없으면 undefined다', () => {
    const shuffled = [rows[2], rows[0], rows[1]]
    expect(pickEpisode(shuffled, 2)).toBe(rows[1])
    expect(pickEpisode(shuffled)).toBe(rows[2])
    expect(pickEpisode([], 1)).toBeUndefined()
  })
})
