// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { Provider } from 'react-redux'
import { createAppStore } from '../../app/store'
import { Sheet } from './Sheet'

afterEach(cleanup)

function renderSheet(children: ReactNode, onClose = vi.fn()) {
  return render(<Provider store={createAppStore()}>
    <Sheet sid="U21" label="키보드 검증" onClose={onClose}>{children}</Sheet>
  </Provider>)
}

it('summary가 첫 조작 요소이면 시트를 열 때 포커스를 준다', () => {
  renderSheet(<details><summary>원문 보기</summary><p>저장 원고</p></details>)
  expect(document.activeElement).toBe(screen.getByText('원문 보기'))
})

it('마지막 선택란의 Tab을 막지 않고 마지막 summary의 Tab에서 처음으로 순환한다', () => {
  renderSheet(<>
    <button>닫기</button>
    <select aria-label="비교 버전"><option>버전 1</option></select>
    <details><summary>원문 보기</summary><p>저장 원고</p></details>
  </>)
  const select = screen.getByLabelText('비교 버전')
  select.focus()
  expect(fireEvent.keyDown(select, { key: 'Tab' })).toBe(true)
  const summary = screen.getByText('원문 보기')
  summary.focus()
  expect(fireEvent.keyDown(summary, { key: 'Tab' })).toBe(false)
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '닫기' }))
})

it('첫 요소의 Shift+Tab은 마지막 summary로 이동한다', () => {
  renderSheet(<>
    <button>닫기</button>
    <select aria-label="비교 버전"><option>버전 1</option></select>
    <details><summary>원문 보기</summary><p>저장 원고</p></details>
  </>)
  fireEvent.keyDown(screen.getByRole('button', { name: '닫기' }), { key: 'Tab', shiftKey: true })
  expect(document.activeElement).toBe(screen.getByText('원문 보기'))
})

it('tabIndex가 -1인 summary는 포커스 순환 대상에서 제외한다', () => {
  renderSheet(<>
    <button>닫기</button>
    <select aria-label="비교 버전"><option>버전 1</option></select>
    <details><summary tabIndex={-1}>원문 보기</summary><p>저장 원고</p></details>
  </>)
  fireEvent.keyDown(screen.getByRole('button', { name: '닫기' }), { key: 'Tab', shiftKey: true })
  expect(document.activeElement).toBe(screen.getByLabelText('비교 버전'))
})

it('Escape로 닫기를 요청하고 시트가 닫히면 열었던 요소로 포커스를 돌린다', () => {
  render(<button>버전 관리 열기</button>)
  const opener = screen.getByRole('button', { name: '버전 관리 열기' })
  opener.focus()
  const close = vi.fn()
  const { unmount } = renderSheet(<details><summary>원문 보기</summary><p>저장 원고</p></details>, close)
  fireEvent.keyDown(screen.getByText('원문 보기'), { key: 'Escape' })
  expect(close).toHaveBeenCalledOnce()
  unmount()
  expect(document.activeElement).toBe(opener)
})

it('시트 안에서 누르기 시작해 배경에서 뗀 클릭(입력 글자를 끌어 고르다 벗어난 경우)은 닫지 않고, 배경을 누른 클릭은 닫는다', () => {
  const close = vi.fn()
  renderSheet(<textarea aria-label="내용" />, close)
  const dim = screen.getByRole('dialog').parentElement!
  // 브라우저는 누른 곳과 뗀 곳이 다르면 click을 둘의 공통 조상(배경)에 보낸다.
  fireEvent.pointerDown(screen.getByLabelText('내용'))
  fireEvent.click(dim)
  expect(close).not.toHaveBeenCalled()
  fireEvent.pointerDown(dim)
  fireEvent.click(dim)
  expect(close).toHaveBeenCalledOnce()
  // 포인터 없이 온 클릭(보조기기의 활성화)도 배경이면 닫는다.
  fireEvent.click(dim)
  expect(close).toHaveBeenCalledTimes(2)
  // 시트 안을 누른 클릭은 닫지 않는다.
  fireEvent.pointerDown(screen.getByRole('dialog'))
  fireEvent.click(screen.getByRole('dialog'))
  expect(close).toHaveBeenCalledTimes(2)
})

it('한글 조합 중 Escape(isComposing·Safari의 keyCode 229)는 조합을 취소하는 키라 시트를 닫지 않는다', () => {
  const close = vi.fn()
  renderSheet(<input aria-label="댓글" />, close)
  const input = screen.getByLabelText('댓글')
  for (const init of [{ isComposing: true }, { isComposing: false, keyCode: 229 }]) fireEvent.keyDown(input, { key: 'Escape', ...init })
  expect(close).not.toHaveBeenCalled()
  fireEvent.keyDown(input, { key: 'Escape' })
  expect(close).toHaveBeenCalledOnce()
})

it('숨긴 입력(hidden 속성·type=hidden·inert 안)은 첫 포커스와 Tab 순환 대상에서 제외한다', () => {
  renderSheet(<>
    <input type="file" hidden aria-label="숨긴 파일 선택" />
    <button>닫기</button>
    <input aria-label="이름" />
    <input type="hidden" name="token" />
    <div inert><button>잠긴 버튼</button></div>
    <div hidden><button>접힌 버튼</button></div>
  </>)
  const [closeButton, name] = [screen.getByRole('button', { name: '닫기' }), screen.getByLabelText('이름')]
  // 맨 앞의 숨은 파일 입력이 아니라 처음 보이는 요소가 포커스를 받는다.
  expect(document.activeElement).toBe(closeButton)
  name.focus()
  expect(fireEvent.keyDown(name, { key: 'Tab' })).toBe(false)
  expect(document.activeElement).toBe(closeButton)
  fireEvent.keyDown(closeButton, { key: 'Tab', shiftKey: true })
  expect(document.activeElement).toBe(name)
})

it('브라우저가 visibility까지 따져 보이지 않는다고 답한 요소(visibility: hidden)는 초점 후보에서 뺀다', () => {
  // jsdom에는 checkVisibility가 없어 대역을 둔다. 실제 브라우저처럼 visibilityProperty를 넘겨야만 visibility로 숨은 요소를 가려 준다.
  HTMLElement.prototype.checkVisibility = function (this: HTMLElement, options?: CheckVisibilityOptions) { return !(options?.visibilityProperty && this.dataset.invisible) }
  try {
    renderSheet(<><button data-invisible="1">가려진 버튼</button><button>닫기</button><input aria-label="이름" /></>)
    // focus()가 아무 일도 하지 않는 가려진 버튼이 아니라 처음 보이는 요소가 포커스를 받는다.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '닫기' }))
  } finally {
    Reflect.deleteProperty(HTMLElement.prototype, 'checkVisibility')
  }
})

it('시트의 빈 곳을 눌러 초점이 시트 자체에 있을 때 Shift+Tab은 뒤 화면으로 새지 않고 마지막 요소로 간다', () => {
  renderSheet(<><button>닫기</button><button>저장</button></>)
  const dialog = screen.getByRole('dialog')
  dialog.focus()
  expect(fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true })).toBe(false)
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '저장' }))
})
