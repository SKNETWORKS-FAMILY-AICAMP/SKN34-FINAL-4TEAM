import { expect, it } from 'vitest'

import { paginate } from './paginate'

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
