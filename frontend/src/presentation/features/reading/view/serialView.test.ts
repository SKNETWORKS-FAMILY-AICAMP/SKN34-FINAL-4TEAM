import { expect, it } from 'vitest'

import { serialView } from './WorkInfo'

it('연재 중·휴재는 요일과 상태 배지를 함께 보이고 완결은 요일을 감추고 완결만 보인다', () => {
  expect(serialView({ serial: '연재 중', schedule: ['화', '금'] })).toEqual({ badge: '연재 중', days: '화·금 연재', scheduleRow: '화·금 연재', statusRow: '연재 중' })
  expect(serialView({ serial: '휴재', schedule: ['월'] })).toEqual({ badge: '휴재', days: '월 연재', scheduleRow: '월 연재', statusRow: '휴재' })
  expect(serialView({ serial: '완결', schedule: ['월', '수', '금'] })).toEqual({ badge: '완결', days: null, scheduleRow: '완결', statusRow: '완결' })
})

it('상태가 없으면(서버 작품) 배지를 만들지 않고, 값이 없는 상태·연재 주기 행은 null이라 상세 정보에서 감춘다', () => {
  expect(serialView({})).toEqual({ badge: null, days: null, scheduleRow: null, statusRow: null })
  expect(serialView({ schedule: ['화'] })).toEqual({ badge: null, days: '화 연재', scheduleRow: '화 연재', statusRow: null })
})
