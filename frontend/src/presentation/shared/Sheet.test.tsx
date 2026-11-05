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
