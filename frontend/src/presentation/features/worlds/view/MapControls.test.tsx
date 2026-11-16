// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { MapControls } from './useMapCanvas'

afterEach(cleanup)

/** 캔버스 훅 값 중 컨트롤이 읽는 것만 흉내 낸다: 400×300 캔버스, 확대 배율 2, 화면 중심 (10, 20). centerAt은 인자가 없으면 지금 중심을 돌려준다. */
const setup = (reduced = false) => {
  let center = { x: 10, y: 20 }
  const centerAt = vi.fn((x?: number, y?: number, _ms?: number) => { if (x !== undefined && y !== undefined) center = { x, y }; return center })
  const canvas = {
    host: { current: { clientWidth: 400, clientHeight: 300 } }, graph: { current: { centerAt, zoom: () => 2 } },
    reduced, paused: false, setPaused: vi.fn(), setSettled: vi.fn(),
  }
  render(<MapControls canvas={canvas as never} onReplay={() => {}} />)
  const pan = within(screen.getByRole('group', { name: '지도 이동' }))
  return { centerAt, pan, press: (name: string) => fireEvent.click(pan.getByRole('button', { name })) }
}

it('지도 이동 묶음에는 이름이 붙은 방향 버튼 네 개가 그려진 아이콘으로 있다', () => {
  const { pan } = setup()
  const buttons = pan.getAllByRole('button')
  expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual(['왼쪽으로 이동', '위로 이동', '아래로 이동', '오른쪽으로 이동'])
  for (const button of buttons) {
    expect(button.querySelector('svg[aria-hidden="true"] path')).not.toBeNull()
    expect(button.textContent).toBe('') // 글리프·이모지가 아니라 그린 아이콘이다
    expect(button.className).toBe('btn sm')
  }
})

it('방향 버튼을 누르면 지금 중심에서 보이는 영역(캔버스 크기 ÷ 확대 배율)의 4분의 1만큼 옮긴다', () => {
  const { centerAt, press } = setup()
  press('오른쪽으로 이동') // 400 ÷ 2 × 1/4 = 50
  expect(centerAt).toHaveBeenLastCalledWith(60, 20, 200)
  press('위로 이동') // 300 ÷ 2 × 1/4 = 37.5, 앞서 옮긴 중심에서 이어 간다
  expect(centerAt).toHaveBeenLastCalledWith(60, -17.5, 200)
  press('왼쪽으로 이동')
  press('아래로 이동')
  expect(centerAt).toHaveBeenLastCalledWith(10, 20, 200)
})

it('동작 줄이기 설정이면 전환 없이 바로 옮긴다', () => {
  const { centerAt, press } = setup(true)
  press('아래로 이동')
  expect(centerAt).toHaveBeenLastCalledWith(10, 57.5, 0)
})
