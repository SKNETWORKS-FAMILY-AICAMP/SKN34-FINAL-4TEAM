// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter, useLocation, useNavigate } from 'react-router'
import { useState } from 'react'
import { afterEach, expect, it } from 'vitest'

import { createAppStore } from '../../../app/store'
import { Sheet } from '../Sheet'
import { OnboardingSheet } from './OnboardingSheet'
import { onboardingKey } from './onboardingPrefs'

afterEach(() => { cleanup(); localStorage.clear() })

let go: (path: string) => void = () => {}
let here = ''
function Nav() { go = useNavigate(); const l = useLocation(); here = l.pathname + l.search; return null }

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

it('Fork 단계는 세계관이 연결된 원작에서만 분기할 수 있다는 조건을 알린다(#971)', () => {
  renderAt('/')
  const fork = screen.getAllByRole('listitem').find((li) => li.querySelector('b')?.textContent === 'Fork')!
  expect(fork.textContent).toContain('세계관이 연결된')
})

it('단계 목록 아래에 문장을 눌러 작가에게 오류 제보나 수정 제안을 보낼 수 있다고 한 줄 알린다(#971)', () => {
  renderAt('/')
  expect(sheet()!.textContent).toContain('읽다가 문장을 누르면 작가에게 오류 제보나 수정 제안을 보낼 수 있어요.')
  expect(screen.getAllByRole('listitem')).toHaveLength(4) // 단계 구조는 그대로다
})

it('홈이 아닌 화면에서는 열리지 않는다', () => {
  renderAt('/work/w1')
  expect(sheet()).toBeNull()
})

const close = () => fireEvent.click(screen.getByRole('button', { name: '닫기' }))
const never = () => screen.getByRole('checkbox', { name: '다음부터 보지 않기' })

it('닫기(✕)는 이번만 닫고, 저장하지 않으며 같은 방문 중 홈으로 돌아와도 다시 열지 않는다', () => {
  renderAt('/')
  close()
  expect(sheet()).toBeNull()
  expect(localStorage.getItem(onboardingKey)).toBeNull()
  act(() => go('/rank'))
  act(() => go('/'))
  expect(sheet()).toBeNull()
})

it('Esc로 닫아도 다음부터 보지 않기를 고르지 않았으면 저장하지 않는다', () => {
  renderAt('/')
  expect(sheet()).toBeTruthy()
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(sheet()).toBeNull()
  expect(localStorage.getItem(onboardingKey)).toBeNull()
})

it('닫은 뒤 다음 방문(새로 연 앱)에서는 다시 안내한다', () => {
  renderAt('/')
  close()
  cleanup()
  renderAt('/')
  expect(sheet()).toBeTruthy()
})

// UX 개선: 같은 일(이번만 닫기)을 하던 건너뛰기·닫기·작품 둘러보기 셋과 다시 보지 않기 버튼을, 닫기·주 버튼 둘과 '다음부터 보지 않기' 선택 하나로 줄였다.
it.each([
  ['작품 둘러보기', () => fireEvent.click(screen.getByRole('button', { name: '작품 둘러보기' }))],
  ['닫기', close],
  ['Esc', () => fireEvent.keyDown(document, { key: 'Escape' })],
  ['바로가기', () => fireEvent.click(screen.getByRole('link', { name: '포크 소설 둘러보기' }))],
])('다음부터 보지 않기를 고르고 %s로 닫으면 다음 방문에도 열지 않는다', (_how, closeBy) => {
  renderAt('/')
  fireEvent.click(never())
  closeBy()
  expect(sheet()).toBeNull()
  expect(localStorage.getItem(onboardingKey)).toBe('dismissed')
  cleanup()
  renderAt('/')
  expect(sheet()).toBeNull()
})

it('닫는 버튼은 닫기(✕)와 주 버튼 작품 둘러보기 둘뿐이다', () => {
  renderAt('/')
  const names = [...sheet()!.querySelectorAll('button')].map((b) => b.getAttribute('aria-label') ?? b.textContent)
  expect(names).toEqual(['닫기', '작품 둘러보기'])
  expect(screen.getByRole('button', { name: '작품 둘러보기' }).classList.contains('pri')).toBe(true)
  expect((never() as HTMLInputElement).checked).toBe(false)
})

it('작가 도구의 사용법 버튼으로 화면 안내를 다시 볼 수 있다고 알린다(#971)', () => {
  renderAt('/')
  expect(sheet()!.textContent).toContain('작가 도구에서는 사용법 버튼으로')
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

it('안내가 그려지지 않는 화면(/status)을 거쳐 돌아와도 같은 방문에서는 닫힌 채다', () => {
  const store = createAppStore()
  const app = (shown: boolean) => (
    <Provider store={store}>
      <MemoryRouter initialEntries={['/']}><Nav />{shown && <OnboardingSheet />}</MemoryRouter>
    </Provider>
  )
  const { rerender } = render(app(true))
  close()
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

// #930: 단계별 바로가기. 홈 목록 바로가기는 홈 위에서 여는 시트라 작품 둘러보기와 같은 일을 해 뺐다(UX 개선).
it('Fork·집필실 단계에만 바로가기를 둔다', () => {
  renderAt('/')
  const items = screen.getAllByRole('listitem')
  const hrefs = items.map((li) => li.querySelector('a')?.getAttribute('href') ?? null)
  expect(hrefs).toEqual([null, '/rank?t=if', '/lib?tab=write', null])
})

it.each([
  ['포크 소설 둘러보기', '/rank?t=if'],
  ['내가 쓰는 소설로 가기', '/lib?tab=write'],
])('바로가기 %s는 그 화면으로 이동하며 안내를 이번 방문만 닫는다', (name, to) => {
  renderAt('/')
  fireEvent.click(screen.getByRole('link', { name }))
  expect(here).toBe(to)
  expect(sheet()).toBeNull()
  expect(localStorage.getItem(onboardingKey)).toBeNull()
  act(() => go('/rank'))
  act(() => go('/'))
  expect(sheet()).toBeNull()
})

it('단계 목록은 바로가기를 링크 모양으로 보이는 onb-steps 클래스를 단다(storyfork.css 규칙과 짝)', () => {
  renderAt('/')
  expect(screen.getByRole('list').classList.contains('onb-steps')).toBe(true)
})

it('작품 둘러보기는 홈에 머문 채 이번 방문만 닫는다', () => {
  renderAt('/')
  fireEvent.click(screen.getByRole('button', { name: '작품 둘러보기' }))
  expect(sheet()).toBeNull()
  expect(here).toBe('/')
  expect(localStorage.getItem(onboardingKey)).toBeNull()
})
