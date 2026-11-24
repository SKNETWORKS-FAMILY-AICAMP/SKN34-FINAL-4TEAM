import { describe, expect, it } from 'vitest'
import { filterByName } from '../entities/nameSearch'

const worlds = [{ id: 'a', name: '빈 세계' }, { id: 'b', name: 'Alpha World' }, { id: 'c', name: '둘째 빈 세계' }]
const ids = (query: string) => filterByName(worlds, query).map((w) => w.id)

describe('filterByName: 이름으로 목록 거르기', () => {
  it('검색어가 비었거나 공백뿐이면 전체를 순서대로 남긴다', () => {
    expect(filterByName(worlds, '')).toEqual(worlds)
    expect(filterByName(worlds, '   ')).toEqual(worlds)
  })

  it('이름에 검색어가 들어 있는 항목만 원래 순서대로 남긴다', () => {
    expect(ids('빈')).toEqual(['a', 'c'])
    expect(ids('둘째')).toEqual(['c'])
  })

  it('대소문자와 검색어 앞뒤 공백은 무시한다', () => {
    expect(ids('  aLPHA ')).toEqual(['b'])
  })

  it('맞는 이름이 없으면 빈 목록이다', () => {
    expect(ids('없는 이름')).toEqual([])
  })
})
