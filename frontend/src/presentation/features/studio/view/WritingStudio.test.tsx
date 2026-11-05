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
vi.mock('./SettingHistoryPanel', () => ({ SettingHistoryPanel: ({ workId }: { workId: string }) => <section aria-label="설정 버전 이력"><h2>설정 버전 이력</h2><p>{workId}</p></section> }))
const originalActive = model.active
const comparisonVersions = [
  ...originalActive.versions,
  { ...originalActive.versions[0], id: 'v2', body: '변경 원고' },
  { ...originalActive.versions[0], id: 'v3', body: '추가 원고' },
]
afterEach(() => { cleanup(); vi.clearAllMocks(); model.active = originalActive })
const renderStudio = () => {
  const store = createAppStore()
  return render(<WritingStudio id="work-id" />, {
    wrapper: ({ children }) => <Provider store={store}>{children}</Provider>,
  })
}

function chooseComparison() {
  fireEvent.click(screen.getByRole('button', { name: '원고 버전 · 비교 · 공개' }))
  fireEvent.click(screen.getByRole('button', { name: '원고 버전 비교' }))
  fireEvent.change(screen.getByLabelText('기준 원고 버전'), { target: { value: 'v1' } })
  fireEvent.change(screen.getByLabelText('비교 원고 버전'), { target: { value: 'v2' } })
}

function expectComparisonSelection(before: string, after: string) {
  expect(screen.getByLabelText('기준 원고 버전')).toHaveProperty('value', before)
  expect(screen.getByLabelText('비교 원고 버전')).toHaveProperty('value', after)
}

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
  expect(screen.getAllByRole('region', { name: '설정 버전 이력' })).toHaveLength(1)
  expect(within(screen.getByRole('region', { name: '설정 버전 이력' })).getByText('work-id')).toBeTruthy()
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
    expect(within(dialog).getByRole('heading', { level: 2, name: label })).toBeTruthy()
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

it('열린 시트의 관리 탭을 왕복해도 비교 선택과 결과를 유지하며 저장 API를 호출하지 않는다', () => {
  model.active = { ...originalActive, versions: comparisonVersions }
  renderStudio()
  chooseComparison()
  for (const tab of ['원고 저장본 · 공개', '설정 버전 이력']) {
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: tab }))
    expect(screen.queryByLabelText('기준 원고 버전')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '원고 버전 비교' }))
    expectComparisonSelection('v1', 'v2')
    expect(screen.getByRole('region', { name: '원고 변경 내용' })).toBeTruthy()
  }
  expect(model.save).not.toHaveBeenCalled()
  expect(model.publish).not.toHaveBeenCalled()
  expect(model.restore).not.toHaveBeenCalled()
})

it('시트를 닫았다 다시 열면 비교 선택을 초기화한다', () => {
  model.active = { ...originalActive, versions: comparisonVersions }
  renderStudio()
  chooseComparison()
  fireEvent.click(screen.getByRole('button', { name: '닫기' }))
  fireEvent.click(screen.getByRole('button', { name: '원고 버전 · 비교 · 공개' }))
  fireEvent.click(screen.getByRole('button', { name: '원고 버전 비교' }))
  expectComparisonSelection('', '')
})

it.each(['회차', '작품'])('%s가 바뀌면 같은 버전 ID가 있어도 비교 선택을 초기화한다', scope => {
  model.active = { ...originalActive, versions: comparisonVersions }
  const { rerender } = renderStudio()
  chooseComparison()
  model.active = { ...model.active, number: scope === '회차' ? 2 : 1 }
  rerender(<WritingStudio id={scope === '작품' ? 'other-work' : 'work-id'} />)
  expectComparisonSelection('', '')
  model.active = { ...originalActive, versions: comparisonVersions }
  rerender(<WritingStudio id="work-id" />)
  expectComparisonSelection('', '')
})

it.each(['v1', 'v2'])('다른 탭에서 선택 버전 %s가 사라졌다 재등장해도 선택을 복구하지 않는다', removedId => {
  model.active = { ...originalActive, versions: comparisonVersions }
  const { rerender } = renderStudio()
  chooseComparison()
  fireEvent.click(screen.getByRole('button', { name: '원고 저장본 · 공개' }))
  model.active = { ...model.active, versions: comparisonVersions.filter(v => v.id !== removedId) }
  rerender(<WritingStudio id="work-id" />)
  model.active = { ...model.active, versions: comparisonVersions }
  rerender(<WritingStudio id="work-id" />)
  fireEvent.click(screen.getByRole('button', { name: '원고 버전 비교' }))
  expectComparisonSelection(removedId === 'v1' ? '' : 'v1', removedId === 'v2' ? '' : 'v2')
  expect(screen.queryByRole('region', { name: '원고 변경 내용' })).toBeNull()
})

it('새 저장 버전이 추가돼도 유효한 기존 비교 선택을 유지한다', () => {
  model.active = { ...originalActive, versions: comparisonVersions.slice(0, 2) }
  const { rerender } = renderStudio()
  chooseComparison()
  model.active = { ...model.active, versions: comparisonVersions }
  rerender(<WritingStudio id="work-id" />)
  expectComparisonSelection('v1', 'v2')
  expect(screen.getByRole('region', { name: '원고 변경 내용' })).toBeTruthy()
})

it('버전이 두 개 미만으로 줄어 비교 화면이 사라져도 제거된 선택을 정리한다', () => {
  model.active = { ...originalActive, versions: comparisonVersions.slice(0, 2) }
  const { rerender } = renderStudio()
  chooseComparison()
  model.active = { ...model.active, versions: comparisonVersions.slice(0, 1) }
  rerender(<WritingStudio id="work-id" />)
  expect(screen.getByText('비교하려면 이 회차의 저장 버전이 두 개 이상 필요해요.')).toBeTruthy()
  model.active = { ...model.active, versions: comparisonVersions }
  rerender(<WritingStudio id="work-id" />)
  expectComparisonSelection('v1', '')
  expect(screen.queryByRole('region', { name: '원고 변경 내용' })).toBeNull()
})
