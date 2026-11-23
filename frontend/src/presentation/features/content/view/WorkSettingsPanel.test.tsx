// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { Provider } from 'react-redux'
import { afterEach, expect, it, vi } from 'vitest'

import { createAppStore } from '../../../../app/store'
import type { WorkSettings, WritingMode } from '../../../../domain/entities/operatingSettings'
import { WorkSettingsPanel } from './WorkSettingsPanel'

afterEach(cleanup)

const defaults = { worldUpdateMode: 'manual', proofreadingMode: 'review', autoserialState: 'off' } as const
const settingsOf = (writingMode: WritingMode | null, revision = writingMode ? 1 : 0): WorkSettings => {
  const current = writingMode ? { revision, writingMode, changedAt: '2026-11-22T03:00:00Z' } : { revision: 0 as const, writingMode: null, changedAt: null }
  return { ...defaults, current, history: writingMode ? [{ revision, writingMode, changedAt: current.changedAt! }] : [] }
}
/** 시트는 Redux(uiSlice)를 쓰므로 Provider로 감싼다. saved는 서버에 저장된 집필 방식이고, onOpenWorld를 빼면 호출 측이 이동을 잠근 경우다. */
const open = async (saved: WritingMode | null, { world = true }: { world?: boolean } = {}) => {
  const useCase = {
    workSettings: vi.fn().mockResolvedValue(settingsOf(saved)),
    updateWorkSettings: vi.fn(async (_id: string, revision: number, mode: WritingMode) => settingsOf(mode, revision + 1)),
  }
  const onSaved = vi.fn()
  const onOpenWorld = vi.fn()
  render(<Provider store={createAppStore()}><WorkSettingsPanel workId='w' useCase={useCase as never} onSaved={onSaved} onOpenWorld={world ? onOpenWorld : undefined} /></Provider>)
  const select = await screen.findByRole('combobox', { name: '집필 방식' })
  return { useCase, onSaved, onOpenWorld, select, save: screen.getByRole('button', { name: '집필 방식 저장' }) }
}
const TITLE = 'AI 자율 집필로 저장할까요?'
// 계약 'AI 자율 집필 선택 경고': 회차 집필이 연결된 세계관의 인물 카드로 인물 시뮬레이션을 돌리므로 없으면 회차 실행이 실패한다.
const MESSAGE = 'AI 자율 집필은 연결된 세계관의 인물 카드로 인물 시뮬레이션을 돌려 회차를 씁니다. 세계관을 연결하고 인물 카드(성격·말투·목표·관계)를 꼭 작성해 주세요. 없으면 회차 실행이 실패해요.'
const dialog = () => screen.getByRole('alertdialog', { name: TITLE })
const choose = (select: HTMLElement, mode: WritingMode) => fireEvent.change(select, { target: { value: mode } })

// ── 계약 'AI 자율 집필 선택 경고': 저장할 때 확인 대화 상자로 경고한다(저장을 막지 않는다) ──
it('AI 자율 집필을 고르고 저장을 누르면 곧바로 저장하지 않고 경고 대화 상자(alertdialog)를 연다: 제목·인물 카드 안내·세 버튼', async () => {
  const { useCase, select, save } = await open('direct')
  choose(select, 'autonomous')
  save.focus()
  fireEvent.click(save)
  const alert = dialog()
  expect(alert.getAttribute('aria-modal')).toBe('true')
  expect(within(alert).getByRole('heading', { name: TITLE })).toBeTruthy()
  const message = within(alert).getByText(MESSAGE)
  expect(alert.getAttribute('aria-describedby')).toBe(message.id) // 열릴 때 메시지가 읽힌다
  expect(within(alert).getAllByRole('button').map((b) => b.textContent)).toEqual(['취소', '계속 저장', '세계관·설정집으로']) // 시각 순서 = DOM 순서
  expect(useCase.updateWorkSettings).not.toHaveBeenCalled()
  expect(screen.queryByText('집필 방식을 저장했어요.')).toBeNull()
})

it('처음 초점은 저장이 아닌 안전한 주 행동 세계관·설정집으로에 놓이고, Tab은 대화 상자 안을 돈다', async () => {
  const { select, save } = await open(null)
  choose(select, 'autonomous')
  fireEvent.click(save)
  const [cancel, proceed, world] = within(dialog()).getAllByRole('button')
  expect(document.activeElement).toBe(world)
  expect(document.activeElement).not.toBe(proceed) // 저장을 누른 손이 Enter를 한 번 더 눌러도 저장되지 않는다
  expect(fireEvent.keyDown(world, { key: 'Tab' })).toBe(false) // 마지막에서 처음으로 돈다
  expect(document.activeElement).toBe(cancel)
})

it('계속 저장을 누르면 그때 저장하고 대화 상자를 닫으며 저장 완료를 알리고 호출 측에 알린다', async () => {
  const { useCase, onSaved, select, save } = await open('assisted')
  choose(select, 'autonomous')
  fireEvent.click(save)
  fireEvent.click(within(dialog()).getByRole('button', { name: '계속 저장' }))
  expect(await screen.findByText('집필 방식을 저장했어요.')).toBeTruthy()
  expect(useCase.updateWorkSettings).toHaveBeenCalledWith('w', 1, 'autonomous', expect.any(AbortSignal))
  expect(screen.queryByRole('alertdialog')).toBeNull()
  expect(onSaved).toHaveBeenCalledTimes(1)
})

it('취소(버튼·Esc·배경 클릭)는 저장하지 않고 닫으며 고른 값을 두고 저장 버튼으로 초점을 돌려준다', async () => {
  const { useCase, onOpenWorld, select, save } = await open('direct')
  choose(select, 'autonomous')
  const closers = [
    () => fireEvent.click(within(dialog()).getByRole('button', { name: '취소' })),
    () => fireEvent.keyDown(document, { key: 'Escape' }),
    () => { const dim = dialog().parentElement!; fireEvent.pointerDown(dim); fireEvent.click(dim) },
  ]
  for (const close of closers) {
    save.focus()
    fireEvent.click(save)
    close()
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect((select as HTMLSelectElement).value).toBe('autonomous')
    expect(document.activeElement).toBe(save)
  }
  expect(useCase.updateWorkSettings).not.toHaveBeenCalled()
  expect(onOpenWorld).not.toHaveBeenCalled()
})

it('세계관·설정집으로는 저장하지 않고 대화 상자를 닫은 뒤 호출 측이 세계관·설정집으로 옮기게 한다', async () => {
  const { useCase, onSaved, onOpenWorld, select, save } = await open('direct')
  choose(select, 'autonomous')
  fireEvent.click(save)
  fireEvent.click(within(dialog()).getByRole('button', { name: '세계관·설정집으로' }))
  expect(onOpenWorld).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('alertdialog')).toBeNull()
  expect(useCase.updateWorkSettings).not.toHaveBeenCalled()
  expect(onSaved).not.toHaveBeenCalled()
})

it('호출 측이 이동을 잠근 동안에는 세계관·설정집으로도 잠기고, 처음 초점은 취소로 간다(잠긴 버튼에 초점을 주지 않는다)', async () => {
  const { onOpenWorld, select, save } = await open('direct', { world: false })
  choose(select, 'autonomous')
  fireEvent.click(save)
  const world = within(dialog()).getByRole('button', { name: '세계관·설정집으로' }) as HTMLButtonElement
  expect(world.disabled).toBe(true)
  fireEvent.click(world)
  expect(onOpenWorld).not.toHaveBeenCalled()
  expect(document.activeElement).toBe(within(dialog()).getByRole('button', { name: '취소' }))
})

it('폼을 Enter로 제출해도 같은 확인을 거친다', async () => {
  const { useCase, select } = await open('direct')
  choose(select, 'autonomous')
  fireEvent.submit(select.closest('form')!)
  expect(dialog()).toBeTruthy()
  expect(useCase.updateWorkSettings).not.toHaveBeenCalled()
})
