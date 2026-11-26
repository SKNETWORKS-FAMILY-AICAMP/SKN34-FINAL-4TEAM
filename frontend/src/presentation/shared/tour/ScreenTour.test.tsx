// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, expect, it, vi } from 'vitest'

import { ScreenTour } from './ScreenTour'
import { isTourSeen, markTourSeen } from './tourPrefs'
import { TourAutoStart, type TourStep } from './useScreenTour'

afterEach(() => { cleanup(); localStorage.clear() })

const STEPS: TourStep[] = [
  { target: 'studio-episodes', title: '회차 목록', text: '쓸 회차를 골라요.' },
  { target: 'studio-editor', title: '원고', text: '본문을 써요.' },
  { target: 'studio-save', title: '버전 저장', text: '되돌릴 지점을 남겨요.' },
]
const ALL = STEPS.map((s) => s.target)

function Host({ present = ALL, auto = true, ready = true, extra }: { present?: string[]; auto?: boolean; ready?: boolean; extra?: ReactNode }) {
  return (
    <TourAutoStart.Provider value={auto}>
      {present.map((name) => <div key={name} data-tour={name}>{name}</div>)}
      {extra}
      <ScreenTour screen="studio" steps={STEPS} ready={ready} />
    </TourAutoStart.Provider>
  )
}

/** 투어 말풍선이 자리를 잡고(불투명해지고) 키보드·버튼을 받을 수 있을 때까지 기다린다. */
async function tip() {
  const dialog = await screen.findByRole('dialog')
  await waitFor(() => expect(document.querySelector<HTMLElement>('.react-joyride__floater')?.style.opacity).toBe('1'))
  return dialog
}
const titleOf = () => screen.getByRole('dialog').querySelector('h3')?.textContent
const progress = () => screen.getByRole('dialog').querySelector('.tour-count')?.textContent
const dialog = () => screen.queryByRole('dialog')

it('처음 들어온 화면은 저절로 시작하고, 화면에 없는 대상의 단계는 건너뛴다', async () => {
  render(<Host present={['studio-episodes', 'studio-save']} />)
  await tip()
  expect(titleOf()).toBe('회차 목록')
  expect(progress()).toBe('1 / 2')
  fireEvent.click(screen.getByRole('button', { name: '다음' }))
  await waitFor(() => expect(titleOf()).toBe('버전 저장'))
  expect(progress()).toBe('2 / 2')
})

it('이미 본 화면은 저절로 시작하지 않는다', async () => {
  markTourSeen('studio')
  render(<Host />)
  await act(async () => { await new Promise((r) => setTimeout(r, 50)) })
  expect(dialog()).toBeNull()
})

it('자동 시작을 켜지 않은 곳(화면만 따로 그린 곳)에서는 저절로 시작하지 않는다', async () => {
  render(<Host auto={false} />)
  await act(async () => { await new Promise((r) => setTimeout(r, 50)) })
  expect(dialog()).toBeNull()
})

it('이미 다른 대화 상자가 열려 있으면 그 위에 투어를 띄우지 않는다', async () => {
  render(<Host extra={<div role="alertdialog" aria-label="경고">열린 경고</div>} />)
  await act(async () => { await new Promise((r) => setTimeout(r, 50)) })
  expect(dialog()).toBeNull()
  expect(isTourSeen('studio')).toBe(false)
})

it('화면이 준비되기 전에는 시작하지 않고 사용법 버튼도 잠가 둔다', async () => {
  const { rerender } = render(<Host ready={false} />)
  expect((screen.getByRole('button', { name: '사용법' }) as HTMLButtonElement).disabled).toBe(true)
  await act(async () => { await new Promise((r) => setTimeout(r, 50)) })
  expect(dialog()).toBeNull()
  rerender(<Host ready />)
  await tip()
  expect(titleOf()).toBe('회차 목록')
})

it('대상이 하나도 없으면 시작하지 않는다', async () => {
  render(<Host present={[]} />)
  await act(async () => { await new Promise((r) => setTimeout(r, 50)) })
  expect(dialog()).toBeNull()
})

it('사용법 버튼으로 이미 본 화면도 언제든 처음부터 다시 시작한다', async () => {
  markTourSeen('studio')
  render(<Host />)
  expect(dialog()).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '사용법' }))
  await tip()
  expect(titleOf()).toBe('회차 목록')
  expect(progress()).toBe('1 / 3')
})

it('말풍선은 한국어 이름의 이전·다음·건너뛰기·투어 닫기 버튼과 단계 문구를 가진다', async () => {
  render(<Host />)
  await tip()
  const d = screen.getByRole('dialog')
  expect(d.textContent).toContain('쓸 회차를 골라요.')
  expect(screen.queryByRole('button', { name: '이전' })).toBeNull()
  for (const name of ['다음', '건너뛰기', '투어 닫기']) expect(screen.getByRole('button', { name })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '다음' }))
  await waitFor(() => expect(titleOf()).toBe('원고'))
  fireEvent.click(screen.getByRole('button', { name: '이전' }))
  await waitFor(() => expect(titleOf()).toBe('회차 목록'))
})

it('마지막 단계의 주 버튼은 완료이고 건너뛰기는 없다', async () => {
  render(<Host present={['studio-save']} />)
  await tip()
  expect(screen.queryByRole('button', { name: '건너뛰기' })).toBeNull()
  expect(screen.getByRole('button', { name: '완료' })).toBeTruthy()
})

const endings: [string, () => void][] = [
  ['건너뛰기', () => fireEvent.click(screen.getByRole('button', { name: '건너뛰기' }))],
  ['투어 닫기', () => fireEvent.click(screen.getByRole('button', { name: '투어 닫기' }))],
  ['Esc', () => fireEvent.keyDown(document.body, { key: 'Escape' })],
  ['완료', () => {
    for (let i = 0; i < 2; i++) fireEvent.click(screen.getByRole('button', { name: '다음' }))
  }],
]
it.each(endings)('%s로 끝내면 그 화면을 본 것으로 기억하고 말풍선을 닫는다', async (name, end) => {
  render(<Host />)
  await tip()
  if (name === '완료') {
    for (let i = 0; i < 2; i++) {
      fireEvent.click(screen.getByRole('button', { name: '다음' }))
      await waitFor(() => expect(progress()).toBe(`${i + 2} / 3`))
    }
    fireEvent.click(screen.getByRole('button', { name: '완료' }))
  } else end()
  await waitFor(() => expect(dialog()).toBeNull())
  expect(isTourSeen('studio')).toBe(true)
})

it('끝낸 뒤에도 사용법 버튼으로 같은 화면의 투어를 처음 단계부터 다시 시작한다', async () => {
  render(<Host />)
  await tip()
  fireEvent.click(screen.getByRole('button', { name: '다음' }))
  await waitFor(() => expect(titleOf()).toBe('원고'))
  fireEvent.click(screen.getByRole('button', { name: '건너뛰기' }))
  await waitFor(() => expect(dialog()).toBeNull())
  fireEvent.click(screen.getByRole('button', { name: '사용법' }))
  await tip()
  expect(titleOf()).toBe('회차 목록')
  expect(progress()).toBe('1 / 3')
})

it('움직임을 줄이는 설정이어도 투어는 같은 단계로 동작한다', async () => {
  const media = vi.fn((query: string) => ({ matches: query.includes('reduce'), media: query, addEventListener() {}, removeEventListener() {} }))
  vi.stubGlobal('matchMedia', media)
  try {
    render(<Host />)
    await tip()
    expect(titleOf()).toBe('회차 목록')
    expect(media).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)')
  } finally { vi.unstubAllGlobals() }
})

it('끝낸 뒤에는 같은 화면을 다시 그려도 저절로 시작하지 않는다', async () => {
  const { unmount } = render(<Host />)
  await tip()
  fireEvent.click(screen.getByRole('button', { name: '건너뛰기' }))
  await waitFor(() => expect(dialog()).toBeNull())
  unmount()
  render(<Host />)
  await act(async () => { await new Promise((r) => setTimeout(r, 50)) })
  expect(dialog()).toBeNull()
})
