import { expect, it } from 'vitest'

import { PAN_STEP, pannedCenter } from './mapPan'

const view = { width: 400, height: 300, zoom: 1 }

it('방향 버튼 한 번은 보이는 영역의 4분의 1만큼 화면 중심을 옮긴다(위·왼쪽은 좌표가 줄고 아래·오른쪽은 는다)', () => {
  expect(PAN_STEP).toBe(0.25)
  const from = { x: 10, y: 20 }
  expect(pannedCenter(from, 'right', view)).toEqual({ x: 110, y: 20 })
  expect(pannedCenter(from, 'left', view)).toEqual({ x: -90, y: 20 })
  expect(pannedCenter(from, 'down', view)).toEqual({ x: 10, y: 95 })
  expect(pannedCenter(from, 'up', view)).toEqual({ x: 10, y: -55 })
  expect(from).toEqual({ x: 10, y: 20 }) // 넘긴 중심은 바꾸지 않는다
})

it('확대할수록 한 번에 옮기는 그래프 거리가 줄어 화면에서 움직이는 정도는 같다', () => {
  expect(pannedCenter({ x: 0, y: 0 }, 'right', { ...view, zoom: 4 })).toEqual({ x: 25, y: 0 })
  expect(pannedCenter({ x: 0, y: 0 }, 'down', { ...view, zoom: 0.5 })).toEqual({ x: 0, y: 150 })
})
