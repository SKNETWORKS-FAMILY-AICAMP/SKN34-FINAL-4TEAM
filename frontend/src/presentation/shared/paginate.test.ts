import { describe, expect, it } from 'vitest'

import { pageNumbers, pageParam, paginate } from './paginate'

const nums = (n: number) => Array.from({ length: n }, (_, i) => i + 1)

it('빈 목록은 1쪽 하나로 본다', () => {
  expect(paginate([], 1)).toEqual({ items: [], page: 1, pages: 1 })
})

it('한 쪽은 10개이고, 10개까지는 쪽이 하나다', () => {
  expect(paginate(nums(10), 1)).toEqual({ items: nums(10), page: 1, pages: 1 })
})

it('11개부터 쪽이 나뉘고 마지막 쪽에는 나머지만 보인다', () => {
  expect(paginate(nums(11), 1)).toEqual({ items: nums(10), page: 1, pages: 2 })
  expect(paginate(nums(11), 2)).toEqual({ items: [11], page: 2, pages: 2 })
  expect(paginate(nums(25), 3)).toEqual({ items: [21, 22, 23, 24, 25], page: 3, pages: 3 })
})

it('범위를 벗어난 쪽은 처음 쪽이나 마지막 쪽으로 보정한다(목록이 줄어든 뒤 남은 쪽 번호 포함)', () => {
  expect(paginate(nums(25), 0).page).toBe(1)
  expect(paginate(nums(25), -3).page).toBe(1)
  expect(paginate(nums(11), 5)).toEqual({ items: [11], page: 2, pages: 2 })
  expect(paginate(nums(3), 2)).toEqual({ items: nums(3), page: 1, pages: 1 })
})

describe('쪽 번호 목록 (#505)', () => {
  it('7쪽까지는 번호를 전부 보인다', () => {
    expect(pageNumbers(1, 1)).toEqual([1])
    expect(pageNumbers(1, 2)).toEqual([1, 2])
    expect(pageNumbers(4, 7)).toEqual([1, 2, 3, 4, 5, 6, 7])
  })

  it('8쪽부터는 처음·끝과 현재 쪽 주변만 보이고 사이는 …로 줄인다(항상 7칸)', () => {
    expect(pageNumbers(1, 20)).toEqual([1, 2, 3, 4, 5, '…', 20])
    expect(pageNumbers(4, 20)).toEqual([1, 2, 3, 4, 5, '…', 20])
    expect(pageNumbers(5, 20)).toEqual([1, '…', 4, 5, 6, '…', 20])
    expect(pageNumbers(10, 20)).toEqual([1, '…', 9, 10, 11, '…', 20])
    expect(pageNumbers(16, 20)).toEqual([1, '…', 15, 16, 17, '…', 20])
    expect(pageNumbers(17, 20)).toEqual([1, '…', 16, 17, 18, 19, 20])
    expect(pageNumbers(20, 20)).toEqual([1, '…', 16, 17, 18, 19, 20])
    expect(pageNumbers(1, 8)).toEqual([1, 2, 3, 4, 5, '…', 8])
    expect(pageNumbers(8, 8)).toEqual([1, '…', 4, 5, 6, 7, 8])
  })

  it('…는 건너뛴 번호가 둘 이상일 때만 들어가 1·끝 번호는 늘 보인다', () => {
    for (let pages = 8; pages <= 40; pages++) {
      for (let page = 1; page <= pages; page++) {
        const list = pageNumbers(page, pages)
        expect(list, `${page}/${pages}`).toHaveLength(7)
        expect([list[0], list[6]]).toEqual([1, pages])
        expect(list).toContain(page)
        const numbers = list.filter((n): n is number => n !== '…')
        expect(numbers, `${page}/${pages}`).toEqual(numbers.toSorted((a, b) => a - b))
        list.forEach((n, i) => { if (n === '…') expect((list[i + 1] as number) - (list[i - 1] as number)).toBeGreaterThan(2) })
      }
    }
  })
})

describe('주소 page 값 (#505)', () => {
  it('1 이상의 정수 글자만 그 쪽으로 읽는다', () => {
    expect(pageParam('2')).toBe(2)
    expect(pageParam('12')).toBe(12)
    expect(pageParam('007')).toBe(7)
    expect(pageParam('999999')).toBe(999999)
  })

  it('없음·빈 값·0·음수·소수·글자·너무 큰 값은 1쪽이다', () => {
    for (const bad of [null, '', '0', '000', '-2', '2.5', '1e3', 'abc', '3쪽', ' 3', '0x10', '1000000', '99999999999999999999']) expect(pageParam(bad), String(bad)).toBe(1)
  })
})
