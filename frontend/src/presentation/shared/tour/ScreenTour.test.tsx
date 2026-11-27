// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StrictMode, useEffect, type ReactNode } from 'react'
import { afterEach, expect, it, vi } from 'vitest'

import { ScreenTour } from './ScreenTour'
import { isTourSeen, markTourSeen } from './tourPrefs'
import { TourAutoStart, type TourStep } from './useScreenTour'

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks() })

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

// ── 탭·패널별 투어 ─────────────────────────────────────────────

const INTRO: TourStep[] = [
  { target: 'manage-overview', title: '개요', text: '작품 현황을 봐요.' },
  { target: 'manage-settings', title: '운영 설정', text: '집필 방식을 정해요.' },
]
const TABS: Record<string, TourStep[]> = {
  settings: [
    { target: 'manage-settings-mode', title: '집필 방식', text: '직접·AI 협업·AI 자율 집필 중에서 골라요.' },
    { target: 'manage-settings-policy', title: '분기 정책', text: '분기를 허용할지 정해요.' },
  ],
  serial: [{ target: 'manage-serial-form', title: '연재 설정', text: '요일·시각·방향을 저장해요.' }],
}
const targetsOf = (tab?: string) => [...INTRO, ...(tab ? TABS[tab] ?? [] : [])].map((s) => s.target)

/** 화면(메뉴)은 늘 있고, 탭의 대상은 그 탭을 보는 동안만 그려진다. */
function TabHost({ tab = 'settings', auto = true, panel = false, ready = true, extra }: { tab?: string | null; auto?: boolean; panel?: boolean; ready?: boolean; extra?: ReactNode }) {
  const at = tab ?? undefined // null = 탭 내용을 아직 불러오는 중
  return (
    <TourAutoStart.Provider value={auto}>
      {targetsOf(at).map((name) => <div key={name} data-tour={name}>{name}</div>)}
      {extra}
      <ScreenTour screen="manage" steps={INTRO} tabs={TABS} tab={at} panel={panel} ready={ready} />
    </TourAutoStart.Provider>
  )
}
const quiet = () => act(async () => { await new Promise((r) => setTimeout(r, 60)) })
const press = (name: string) => fireEvent.click(screen.getByRole('button', { name }))

it('처음 들어온 화면은 화면 투어가 먼저 뜨고, 끝나면 지금 탭의 투어가 이어서 뜬다(둘이 같이 뜨지 않는다)', async () => {
  render(<TabHost />)
  await tip()
  expect(titleOf()).toBe('개요')
  expect(screen.getAllByRole('dialog')).toHaveLength(1)
  press('건너뛰기')
  await waitFor(() => expect(titleOf()).toBe('집필 방식'))
  expect(screen.getAllByRole('dialog')).toHaveLength(1)
  expect(progress()).toBe('1 / 2')
  expect(isTourSeen('manage')).toBe(true)
  expect(isTourSeen('manage', 'settings')).toBe(false)
  press('건너뛰기')
  await waitFor(() => expect(dialog()).toBeNull())
  expect(isTourSeen('manage', 'settings')).toBe(true)
})

// 앱은 StrictMode라 effect가 두 번 돈다: 첫 실행이 화면 투어를 고른 뒤 상태가 반영되기 전에 두 번째 실행이 '이미 띄움'만 보고 탭 투어로 덮어썼다(브라우저 작품 관리에서 메뉴 소개가 빠짐).
it('StrictMode에서도 첫 진입은 화면 투어가 먼저 뜬다(effect가 두 번 돌아도 탭 투어가 덮어쓰지 않는다)', async () => {
  render(<StrictMode><TabHost /></StrictMode>)
  await tip()
  expect(titleOf()).toBe('개요')
})

it('화면 투어를 이미 봤으면 첫 진입에 지금 탭의 투어가 바로 뜬다', async () => {
  markTourSeen('manage')
  render(<TabHost tab="serial" />)
  await tip()
  expect(titleOf()).toBe('연재 설정')
  expect(progress()).toBe('1 / 1')
})

it('다른 탭으로 처음 옮기면 그 탭의 투어가 한 번 뜨고, 본 탭은 다시 뜨지 않는다', async () => {
  markTourSeen('manage')
  markTourSeen('manage', 'settings')
  const { rerender } = render(<TabHost tab="settings" />)
  await quiet()
  expect(dialog()).toBeNull()
  rerender(<TabHost tab="serial" />)
  await tip()
  expect(titleOf()).toBe('연재 설정')
  press('완료')
  await waitFor(() => expect(dialog()).toBeNull())
  expect(isTourSeen('manage', 'serial')).toBe(true)
  rerender(<TabHost tab="settings" />)
  await quiet()
  rerender(<TabHost tab="serial" />)
  await quiet()
  expect(dialog()).toBeNull()
})

it('사용법 버튼은 지금 보는 탭의 투어를 연다(이미 본 탭도, 화면 투어는 다시 열지 않는다)', async () => {
  markTourSeen('manage'); markTourSeen('manage', 'settings'); markTourSeen('manage', 'serial')
  const { rerender } = render(<TabHost tab="settings" />)
  press('사용법')
  await tip()
  expect(titleOf()).toBe('집필 방식')
  expect(progress()).toBe('1 / 2')
  press('건너뛰기')
  await waitFor(() => expect(dialog()).toBeNull())
  rerender(<TabHost tab="serial" />)
  press('사용법')
  await tip()
  expect(titleOf()).toBe('연재 설정')
})

it('탭 투어가 없는 탭이거나 탭의 내용을 아직 불러오는 중(tab 없음)이면 사용법 버튼이 잠기고 시작하지 않는다', async () => {
  markTourSeen('manage')
  const { rerender } = render(<TabHost tab="history" />)
  expect((screen.getByRole('button', { name: '사용법' }) as HTMLButtonElement).disabled).toBe(true)
  rerender(<TabHost tab={null} />)
  expect((screen.getByRole('button', { name: '사용법' }) as HTMLButtonElement).disabled).toBe(true)
  await quiet()
  expect(dialog()).toBeNull()
  rerender(<TabHost tab="settings" />)
  await tip()
  expect(titleOf()).toBe('집필 방식')
  expect(screen.queryByRole('button', { name: '사용법' })).not.toBeNull()
})

it('panel이면 사용법 버튼은 화면 투어를 열고, 패널 투어는 패널이 처음 열릴 때 저절로 뜬다', async () => {
  markTourSeen('manage')
  const { rerender } = render(<TabHost tab={null} panel />)
  await quiet()
  expect(dialog()).toBeNull()
  press('사용법')
  await tip()
  expect(titleOf()).toBe('개요')
  press('건너뛰기')
  await waitFor(() => expect(dialog()).toBeNull())
  rerender(<TabHost tab="settings" panel />)
  await tip()
  expect(titleOf()).toBe('집필 방식')
})

const panelOwn = (extra: ReactNode = null) => (
  <TourAutoStart.Provider value>
    <div role="dialog" aria-label="패널">
      <div data-tour="manage-settings-mode">방식</div>
    </div>
    {extra}
    <ScreenTour screen="manage" steps={[]} tabs={TABS} tab="settings" panel />
  </TourAutoStart.Provider>
)

it('패널 자신의 대화 상자(안에 그 패널의 대상이 있는 것)는 패널 투어를 막지 않는다', async () => {
  markTourSeen('manage')
  render(panelOwn())
  const tipOfPanel = await screen.findByRole('dialog', { name: '집필 방식' })
  expect(tipOfPanel.querySelector('.tour-count')?.textContent).toBe('1 / 1') // 화면에 있는 대상만
})

it('패널 투어는 다른 시트가 열려 있으면 그 위에 뜨지 않는다', async () => {
  markTourSeen('manage')
  render(panelOwn(<div role="dialog" aria-label="다른 시트">다른 시트</div>))
  await quiet()
  expect(screen.queryByRole('dialog', { name: '집필 방식' })).toBeNull()
  expect(isTourSeen('manage', 'settings')).toBe(false)
})

it('투어가 떠 있는 동안 Esc는 아래 시트를 닫지 않고 투어만 닫으며, 끝난 뒤에는 시트가 다시 Esc를 받는다', async () => {
  markTourSeen('manage')
  const onEsc = vi.fn()
  function Sheetish() {
    useEffect(() => {
      const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onEsc() }
      document.addEventListener('keydown', onKey)
      return () => document.removeEventListener('keydown', onKey)
    }, [])
    return null
  }
  render(panelOwn(<Sheetish />))
  await screen.findByRole('dialog', { name: '집필 방식' })
  await waitFor(() => expect(document.querySelector<HTMLElement>('.react-joyride__floater')?.style.opacity).toBe('1'))
  fireEvent.keyDown(screen.getByRole('button', { name: '완료' }), { key: 'Escape' })
  await waitFor(() => expect(screen.queryByRole('dialog', { name: '집필 방식' })).toBeNull())
  expect(onEsc).not.toHaveBeenCalled()
  expect(isTourSeen('manage', 'settings')).toBe(true)
  fireEvent.keyDown(document.body, { key: 'Escape' })
  expect(onEsc).toHaveBeenCalledTimes(1)
})

it('기억을 저장할 수 없는 브라우저에서도 끝낸 투어가 다시 뜨지 않는다', async () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full') })
  render(<TabHost />)
  await tip()
  press('건너뛰기')
  await waitFor(() => expect(titleOf()).toBe('집필 방식'))
  press('건너뛰기')
  await waitFor(() => expect(dialog()).toBeNull())
  await quiet()
  expect(dialog()).toBeNull()
})
