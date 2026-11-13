import { expect, it } from 'vitest'

import { scheduleLabel } from './WorkInfo'

it('연재 요일을 요일 순서대로 묶어 표시하고 없으면 null이다', () => {
  expect(scheduleLabel(['금', '화'])).toBe('화·금 연재')
  expect(scheduleLabel(['월', '화', '수', '목', '금'])).toBe('월~금 연재')
  expect(scheduleLabel(['월', '화', '수', '목', '금', '토', '일'])).toBe('매일 연재')
  expect(scheduleLabel(['비정기'])).toBe('비정기 연재')
  expect(scheduleLabel([])).toBeNull()
  expect(scheduleLabel(undefined)).toBeNull()
})

it('새 소설 만들기가 저장하는 전체 요일 이름(월요일)도 같은 표시이고 알아볼 수 없는 값은 표시하지 않는다', () => {
  expect(scheduleLabel(['수요일', '월요일', '금요일'])).toBe('월·수·금 연재')
  expect(scheduleLabel(['월요일', '화요일', '수요일', '목요일', '금요일'])).toBe('월~금 연재')
  expect(scheduleLabel(['foo'])).toBeNull()
})
