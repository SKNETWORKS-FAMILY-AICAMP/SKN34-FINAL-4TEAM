// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter, useNavigate } from 'react-router'
import { useState } from 'react'
import { afterEach, expect, it } from 'vitest'

import { createAppStore } from '../../../app/store'
import { Sheet } from '../Sheet'
import { OnboardingSheet } from './OnboardingSheet'
import { onboardingKey } from './onboardingPrefs'

afterEach(() => { cleanup(); localStorage.clear() })

let go: (path: string) => void = () => {}
function Nav() { go = useNavigate(); return null }

const renderAt = (path: string, extra?: React.ReactNode, store = createAppStore()) => render(
  <Provider store={store}>
    <MemoryRouter initialEntries={[path]}><Nav /><OnboardingSheet />{extra}</MemoryRouter>
  </Provider>,
)
const sheet = () => screen.queryByRole('dialog', { name: '처음 오셨나요?' })

it('처음 홈에 들어오면 핵심 흐름 4단계를 순서대로 안내한다', () => {
  renderAt('/')
  expect(sheet()).toBeTruthy()
  const steps = screen.getAllByRole('listitem').map((li) => li.querySelector('b')?.textContent)
  expect(steps).toEqual(['작품 읽기', 'Fork', '집필실', 'AI 집필·피드백'])
})

it('홈이 아닌 화면에서는 열리지 않는다', () => {
  renderAt('/work/w1')
  expect(sheet()).toBeNull()
})

it('건너뛰기는 이번만 닫고, 저장하지 않으며 같은 방문 중 홈으로 돌아와도 다시 열지 않는다', () => {
  renderAt('/')
  fireEvent.click(screen.getByRole('button', { name: '건너뛰기' }))
  expect(sheet()).toBeNull()
  expect(localStorage.getItem(onboardingKey)).toBeNull()
  act(() => go('/rank'))
  act(() => go('/'))
  expect(sheet()).toBeNull()
})

it('Esc로 닫아도 다시 보지 않기로 저장하지 않는다', () => {
  renderAt('/')
  expect(sheet()).toBeTruthy()
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(sheet()).toBeNull()
  expect(localStorage.getItem(onboardingKey)).toBeNull()
})

it('건너뛰기 뒤 다음 방문(새로 연 앱)에서는 다시 안내한다', () => {
  renderAt('/')
  fireEvent.click(screen.getByRole('button', { name: '건너뛰기' }))
  cleanup()
  renderAt('/')
  expect(sheet()).toBeTruthy()
})

it('다시 보지 않기를 누르면 다음 방문에도 열지 않는다', () => {
  renderAt('/')
  fireEvent.click(screen.getByRole('button', { name: '다시 보지 않기' }))
  expect(sheet()).toBeNull()
  cleanup()
  renderAt('/')
  expect(sheet()).toBeNull()
})

it('다른 시트가 열려 대신 닫혀도 다시 보지 않기로 저장하지 않는다', async () => {
  function Other() {
    const [open, setOpen] = useState(false)
    return <>
      <button type="button" onClick={() => setOpen(true)}>다른 시트 열기</button>
      {open && <Sheet sid="U23" label="다른 시트" onClose={() => setOpen(false)}><button type="button">확인</button></Sheet>}
    </>
  }
  renderAt('/', <Other />)
  expect(sheet()).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '다른 시트 열기', hidden: true }))
  expect(await screen.findByRole('dialog', { name: '다른 시트' })).toBeTruthy()
  expect(sheet()).toBeNull()
  expect(localStorage.getItem(onboardingKey)).toBeNull()
})

it('안내가 그려지지 않는 화면(/status)을 거쳐 돌아와도 같은 방문에서는 건너뛰기가 유지된다', () => {
  const store = createAppStore()
  const app = (shown: boolean) => (
    <Provider store={store}>
      <MemoryRouter initialEntries={['/']}><Nav />{shown && <OnboardingSheet />}</MemoryRouter>
    </Provider>
  )
  const { rerender } = render(app(true))
  fireEvent.click(screen.getByRole('button', { name: '건너뛰기' }))
  rerender(app(false))
  rerender(app(true))
  expect(sheet()).toBeNull()
})

it('다른 시트가 열린 채로 홈에 오면 안내를 띄우지 않고 그 시트도 닫지 않는다', async () => {
  function Other() {
    const [open, setOpen] = useState(true)
    return open ? <Sheet sid="U23" label="정책 시트" onClose={() => setOpen(false)}><button type="button">확인</button></Sheet> : null
  }
  renderAt('/me/pay', <Other />)
  expect(await screen.findByRole('dialog', { name: '정책 시트' })).toBeTruthy()
  act(() => go('/'))
  expect(sheet()).toBeNull()
  expect(screen.getByRole('dialog', { name: '정책 시트' })).toBeTruthy()
})
