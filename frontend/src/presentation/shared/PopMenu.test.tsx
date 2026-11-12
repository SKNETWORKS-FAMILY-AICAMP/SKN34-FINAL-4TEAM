// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { PopMenu } from './PopMenu'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

const trigger = () => screen.getByRole('button', { name: '더보기' })
const item = (name: string) => screen.getByRole('menuitem', { name })

it('고를 수 있는 항목이 있으면 열 때 첫 항목으로 초점을 옮기고 방향키는 잠긴 항목을 건너뛴다', () => {
  render(<PopMenu label="더보기" icon="⋮">
    <button type="button" role="menuitem" disabled>설정 수집</button>
    <button type="button" role="menuitem">회차 설정</button>
    <button type="button" role="menuitem" disabled>회차 삭제</button>
    <button type="button" role="menuitem">발행 이력</button>
  </PopMenu>)
  fireEvent.click(trigger())
  expect(document.activeElement).toBe(item('회차 설정'))
  fireEvent.keyDown(item('회차 설정'), { key: 'ArrowDown' })
  expect(document.activeElement).toBe(item('발행 이력'))
  fireEvent.keyDown(item('발행 이력'), { key: 'ArrowDown' })
  expect(document.activeElement).toBe(item('회차 설정'))
})

it('잠긴 항목에 건 사유(aria-describedby)는 초점이 닿지 않아도 읽히도록 메뉴의 설명으로 잇는다', () => {
  render(<PopMenu label="더보기" icon="⋮">
    <button type="button" role="menuitem">회차 설정</button>
    <button type="button" role="menuitem" disabled aria-describedby="blocker">회차 삭제</button>
    <p id="blocker">발행한 회차는 삭제할 수 없어요.</p>
  </PopMenu>)
  fireEvent.click(trigger())
  const menu = screen.getByRole('menu', { name: '더보기' })
  expect(menu.getAttribute('aria-describedby')).toBe('blocker')
  expect(document.getElementById('blocker')?.textContent).toBe('발행한 회차는 삭제할 수 없어요.')
  // 고를 수 있는 항목이 있으면 초점은 그 항목으로 간다.
  expect(document.activeElement).toBe(item('회차 설정'))
})

it('고를 수 있는 항목이 하나도 없으면 메뉴 자체로 초점을 옮겨 메뉴 이름과 사유가 읽히게 하고, Escape로 닫으면 버튼으로 돌아온다', () => {
  render(<PopMenu label="더보기" icon="+">
    <button type="button" role="menuitem" disabled aria-describedby="soon">이미지 첨부</button>
    <button type="button" role="menuitem" disabled aria-describedby="soon">음성 첨부</button>
    <p id="soon">이미지·음성 첨부는 준비 중이에요.</p>
  </PopMenu>)
  fireEvent.click(trigger())
  const menu = screen.getByRole('menu', { name: '더보기' })
  expect(document.activeElement).toBe(menu)
  // 같은 사유를 두 항목이 가리켜도 한 번만 잇는다.
  expect(menu.getAttribute('aria-describedby')).toBe('soon')
  fireEvent.keyDown(menu, { key: 'ArrowDown' })
  expect(document.activeElement).toBe(menu)
  fireEvent.keyDown(menu, { key: 'Escape' })
  expect(screen.queryByRole('menu')).toBeNull()
  expect(document.activeElement).toBe(trigger())
})

it('메뉴 안의 안내 문단(id가 있는 .pop-menu-note)은 고를 항목이 없어도 읽히도록 메뉴의 설명으로 잇는다', () => {
  render(<PopMenu label="더보기" icon="⋮">
    <p id="why" className="pop-menu-note">가져올 설정을 먼저 선택해 주세요.</p>
  </PopMenu>)
  fireEvent.click(trigger())
  const menu = screen.getByRole('menu', { name: '더보기' })
  expect(document.activeElement).toBe(menu)
  expect(menu.getAttribute('aria-describedby')).toBe('why')
})

it('잠긴 항목이 없거나 가리키는 사유가 화면에 없으면 메뉴에 설명을 달지 않는다', () => {
  render(<PopMenu label="더보기" icon="⋮">
    <button type="button" role="menuitem" aria-describedby="hint">회차 설정</button>
    <button type="button" role="menuitem" disabled aria-describedby="missing">회차 삭제</button>
    <p id="hint">회차 제목과 공개 범위를 바꿔요.</p>
  </PopMenu>)
  fireEvent.click(trigger())
  expect(screen.getByRole('menu').hasAttribute('aria-describedby')).toBe(false)
})

/** 목록을 불러오는 동안에는 안내만 있고, 다 읽으면 항목이 채워지는 메뉴(공개 세계관의 '선택한 설정 가져오기'). */
const LateMenu = ({ ready }: { ready: boolean }) => <>
  <PopMenu label="더보기" icon="⋮">
    {ready
      ? <><button type="button" role="menuitem">첫 세계관</button><button type="button" role="menuitem">둘째 세계관</button></>
      : <p role="status">내 세계관을 불러오고 있어요.</p>}
  </PopMenu>
  <button type="button">다른 버튼</button>
</>

it('불러오는 중에 연 메뉴는 항목이 도착하면 초점을 메뉴에서 첫 항목으로 옮긴다', async () => {
  const view = render(<LateMenu ready={false} />)
  fireEvent.click(trigger())
  expect(document.activeElement).toBe(screen.getByRole('menu'))
  view.rerender(<LateMenu ready />)
  await waitFor(() => expect(document.activeElement).toBe(item('첫 세계관')))
  fireEvent.keyDown(item('첫 세계관'), { key: 'ArrowDown' })
  expect(document.activeElement).toBe(item('둘째 세계관'))
})

it('항목이 도착하기 전에 초점이 메뉴 밖으로 나갔으면 늦게 온 항목이 초점을 가져오지 않는다', async () => {
  const view = render(<LateMenu ready={false} />)
  fireEvent.click(trigger())
  const other = screen.getByRole('button', { name: '다른 버튼' })
  other.focus()
  view.rerender(<LateMenu ready />)
  await act(async () => {})
  expect(item('첫 세계관')).toBeTruthy()
  expect(document.activeElement).toBe(other)
})

/** jsdom은 배치를 계산하지 않으므로 버튼과 목록의 화면 좌표를 정해 준다. */
function layout(windowHeight: number, button: [top: number, bottom: number], menu: [top: number, bottom: number]) {
  vi.stubGlobal('innerHeight', windowHeight)
  const rect = ([top, bottom]: [number, number]) => ({ top, bottom, height: bottom - top, left: 0, right: 0, width: 0, x: 0, y: top, toJSON: () => ({}) })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return rect(this.getAttribute('role') === 'menu' ? menu : this.classList.contains('pop-menu-btn') ? button : [0, 0])
  })
}
const openMenu = () => {
  render(<PopMenu label="더보기" icon="⋮"><button type="button" role="menuitem">회차 설정</button><button type="button" role="menuitem">발행 이력</button></PopMenu>)
  fireEvent.click(trigger())
  return screen.getByRole('menu')
}

it.each([
  ['아래가 잘리고 버튼 위에 자리가 있으면 버튼 위로 뒤집는다(간격은 그대로)', 768, [700, 740], [744, 1044], 'translateY(-348px)'],
  ['아래가 잘리는데 위에도 자리가 없으면 창 안에 들 만큼만 올린다', 300, [150, 190], [194, 444], 'translateY(-152px)'],
  ['위로 연 목록의 위가 잘리면 버튼 아래로 뒤집는다', 768, [100, 136], [-58, 92], 'translateY(202px)'],
  ['창 안에 다 들어가면 쓰는 화면의 배치를 그대로 둔다', 1000, [700, 740], [744, 900], ''],
] as const)('열린 목록이 창 밖으로 잘릴 때: %s', (_name, windowHeight, button, menu, transform) => {
  layout(windowHeight, [...button], [...menu])
  expect(openMenu().style.transform).toBe(transform)
})
