// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { Provider } from 'react-redux'
import { createAppStore } from '../../../../app/store'
import { WritingStudio } from './WritingStudio'

const model = vi.hoisted(() => ({
  active: { number: 1, draft: { title: '첫 회차', body: '원고', revision: 1 }, versions: [{ id: 'v1', title: '저장본', body: '저장 원고', savedAt: '2026-11-04T00:00:00Z' }], inherited: false, hasDraft: true },
  episodes: [], draft: { title: '첫 회차', body: '원고', revision: 1 },
  busy: false, error: '', notice: '', ready: true, dirty: false, editingLocked: false,
  save: vi.fn(), reload: vi.fn(), publish: vi.fn().mockResolvedValue(true), restore: vi.fn(),
}))
vi.mock('../viewmodel/useWritingViewModel', () => ({ useWritingViewModel: () => model }))
vi.mock('../../../shared/screenIds', () => ({ useScreenId: () => {} }))
vi.mock('../../../shared/media/MediaPanel', () => ({ ManuscriptBody: ({ body }: { body: string }) => <p>{body}</p> }))
vi.mock('./SettingHistoryPanel', () => ({ SettingHistoryPanel: ({ workId }: { workId: string }) => <section aria-label="연결된 설정 이력">{workId}</section> }))
afterEach(() => { cleanup(); vi.clearAllMocks() })
const renderStudio = () => render(<Provider store={createAppStore()}><WritingStudio id="work-id" /></Provider>)

it('팀 서재로 돌아가며 공개 시트에서 버전 선택과 권리 확인 후 기존 API 동작을 사용한다', async () => {
  renderStudio()
  expect(screen.getByRole('link', { name: '내가 쓰는 소설' }).getAttribute('href')).toBe('/lib?tab=write')
  expect(screen.queryByRole('dialog')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '원고 버전 · 비교 · 공개' }))
  expect(screen.getByRole('dialog', { name: '원고 저장본 · 공개' })).toBeTruthy()
  expect(screen.getByRole('heading', { level: 2, name: '원고 저장본 · 공개' })).toBeTruthy()
  fireEvent.change(screen.getByLabelText('검토할 저장 버전'), { target: { value: 'v1' } })
  const publish = screen.getByRole('button', { name: '선택한 저장 버전 공개' }) as HTMLButtonElement
  expect(publish.disabled).toBe(true)
  fireEvent.click(screen.getByRole('checkbox'))
  expect(publish.disabled).toBe(false)
  await act(async () => { fireEvent.click(publish) })
  expect(model.publish).toHaveBeenCalledWith('v1', true)
})

it('집필실에서 같은 작품의 설정 이력을 열고 단일 시트 안에서 원고 비교로 이동한다', () => {
  renderStudio()
  fireEvent.click(screen.getByRole('button', { name: '설정 버전 이력' }))
  expect(screen.getByRole('region', { name: '연결된 설정 이력' }).textContent).toBe('work-id')
  expect(screen.getAllByRole('dialog')).toHaveLength(1)
  expect(screen.getByRole('dialog', { name: '설정 버전 이력' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '원고 버전 비교' }))
  expect(screen.getByRole('dialog', { name: '1화 원고 버전 비교' })).toBeTruthy()
  expect(screen.getByText('비교하려면 이 회차의 저장 버전이 두 개 이상 필요해요.')).toBeTruthy()
  expect(model.save).not.toHaveBeenCalled()
  expect(model.publish).not.toHaveBeenCalled()
})

it('관리 화면을 전환해도 같은 시트와 탐색 초점을 유지하고 Escape로 진입 버튼에 복귀한다', () => {
  renderStudio()
  const opener = screen.getByRole('button', { name: '원고 버전 · 비교 · 공개' })
  opener.focus()
  fireEvent.click(opener)
  const dialog = screen.getByRole('dialog', { name: '원고 저장본 · 공개' })
  const close = within(dialog).getByRole('button', { name: '닫기' })
  expect(document.activeElement).toBe(close)
  for (const [button, label] of [
    ['원고 버전 비교', '1화 원고 버전 비교'],
    ['설정 버전 이력', '설정 버전 이력'],
    ['원고 저장본 · 공개', '원고 저장본 · 공개'],
  ]) {
    const target = within(dialog).getByRole('button', { name: button })
    target.focus()
    fireEvent.click(target)
    expect(screen.getByRole('dialog', { name: label })).toBe(dialog)
    expect(within(dialog).getByRole('region', { name: label })).toBeTruthy()
    expect(document.activeElement).toBe(target)
    expect(target.getAttribute('aria-pressed')).toBe('true')
  }
  const last = within(dialog).getByLabelText('검토할 저장 버전')
  last.focus()
  fireEvent.keyDown(last, { key: 'Tab' })
  expect(document.activeElement).toBe(close)
  fireEvent.keyDown(close, { key: 'Tab', shiftKey: true })
  expect(document.activeElement).toBe(last)
  fireEvent.keyDown(last, { key: 'Escape' })
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(document.activeElement).toBe(opener)
  expect(model.save).not.toHaveBeenCalled()
  expect(model.publish).not.toHaveBeenCalled()
  expect(model.restore).not.toHaveBeenCalled()
})

it('초안이 없을 때 안내에 실제 버전 관리 진입 버튼명을 사용한다', () => {
  model.active.hasDraft = false
  try {
    renderStudio()
    expect(screen.getByText('작업 초안이 없어요. 입력하면 새 초안으로 저장되며, 상단의 원고 버전 · 비교 · 공개에서 이전 버전을 복원할 수 있어요.')).toBeTruthy()
    expect(screen.getByRole('button', { name: '원고 버전 · 비교 · 공개' })).toBeTruthy()
  } finally {
    model.active.hasDraft = true
  }
})
