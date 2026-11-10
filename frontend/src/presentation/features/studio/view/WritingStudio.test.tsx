// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { Provider } from 'react-redux'
import { MemoryRouter, useLocation } from 'react-router'
import { createAppStore } from '../../../../app/store'
import { WritingStudio } from './WritingStudio'

const model = vi.hoisted(() => ({
  active: { number: 1, draft: { title: '첫 회차', body: '원고', revision: 1 }, versions: [{ id: 'v1', title: '저장본', body: '저장 원고', savedAt: '2026-11-04T00:00:00Z' }], inherited: false, hasDraft: true, checkpoints: [] as { versionId: string; publishedAt: string; active: boolean }[] },
  episodes: [], draft: { title: '첫 회차', body: '원고', revision: 1 },
  busy: false, error: '', notice: '', ready: true, dirty: false, editingLocked: false,
  save: vi.fn(), reload: vi.fn(), publish: vi.fn().mockResolvedValue(true), revertCheckpoint: vi.fn().mockResolvedValue(true), restore: vi.fn(), mayLeave: vi.fn(() => true),
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
const Where = () => { const l = useLocation(); return <p hidden data-testid="where">{l.pathname + l.search}</p> }
const where = () => screen.getByTestId('where').textContent
const renderStudio = () => {
  const store = createAppStore()
  return render(<WritingStudio id="work-id" />, {
    wrapper: ({ children }) => <Provider store={store}><MemoryRouter initialEntries={['/studio/work-id']}>{children}<Where /></MemoryRouter></Provider>,
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

const checkpointRows = [
  { versionId: 'v1', publishedAt: '2026-11-01T00:00:00Z', active: false },
  { versionId: 'v2', publishedAt: '2026-11-02T00:00:00Z', active: true },
]
const openVersions = () => fireEvent.click(screen.getByRole('button', { name: '원고 버전 · 비교 · 공개' }))
const revertRights = '이 체크포인트를 다시 공개할 권리가 있음을 확인합니다.'

it('발행 체크포인트를 시각순으로 보여 주고 현재 공개가 아닌 항목만 권리 확인 후 되돌린다', async () => {
  model.active = { ...originalActive, checkpoints: checkpointRows }
  renderStudio()
  openVersions()
  const items = within(screen.getByRole('region', { name: '발행 체크포인트' })).getAllByRole('listitem')
  expect(items).toHaveLength(2)
  expect(items[0].textContent).toContain('체크포인트 1')
  expect(items[0].textContent).toContain(new Date(checkpointRows[0].publishedAt).toLocaleString('ko-KR'))
  expect(items[0].textContent).not.toContain('현재 공개')
  expect(items[1].textContent).toContain('체크포인트 2')
  expect(items[1].textContent).toContain('현재 공개')
  expect(within(items[1]).queryByRole('button')).toBeNull()
  const revert = within(items[0]).getByRole('button', { name: '이 체크포인트로 되돌리기' }) as HTMLButtonElement
  expect(revert.disabled).toBe(true)
  fireEvent.click(screen.getByLabelText(revertRights))
  expect(revert.disabled).toBe(false)
  await act(async () => { fireEvent.click(revert) })
  expect(model.revertCheckpoint).toHaveBeenCalledWith('v1', true)
  expect(model.publish).not.toHaveBeenCalled()
  expect(revert.disabled).toBe(true)
})

it('저장하지 않은 입력이 있으면 권리를 확인해도 되돌리기를 막는다', () => {
  model.active = { ...originalActive, checkpoints: checkpointRows }
  model.dirty = true
  try {
    renderStudio()
    openVersions()
    fireEvent.click(screen.getByLabelText(revertRights))
    expect((screen.getByRole('button', { name: '이 체크포인트로 되돌리기' }) as HTMLButtonElement).disabled).toBe(true)
  } finally {
    model.dirty = false
  }
})

it('현재 공개 체크포인트뿐이면 되돌리기 버튼과 권리 확인을 보이지 않는다', () => {
  model.active = { ...originalActive, checkpoints: [checkpointRows[1]] }
  renderStudio()
  openVersions()
  expect(within(screen.getByRole('region', { name: '발행 체크포인트' })).getAllByRole('listitem')).toHaveLength(1)
  expect(screen.queryByRole('button', { name: '이 체크포인트로 되돌리기' })).toBeNull()
  expect(screen.queryByLabelText(revertRights)).toBeNull()
})

it('발행한 적 없는 회차에는 체크포인트 영역을 보이지 않는다', () => {
  renderStudio()
  openVersions()
  expect(screen.queryByRole('region', { name: '발행 체크포인트' })).toBeNull()
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

it('내가 쓰는 소설·플롯 링크는 전체 새로고침 없이 앱 안에서 이동한다', () => {
  renderStudio()
  expect(fireEvent.click(screen.getByRole('link', { name: '플롯' }))).toBe(false)
  expect(where()).toBe('/studio/work-id?view=narrative')
  expect(fireEvent.click(screen.getByRole('link', { name: '내가 쓰는 소설' }))).toBe(false)
  expect(where()).toBe('/lib?tab=write')
  expect(model.mayLeave).toHaveBeenCalledTimes(2)
})

it('저장하지 않은 입력이나 진행 중 요청 때문에 이동할 수 없으면 링크가 이동하지 않는다', () => {
  renderStudio()
  model.mayLeave.mockReturnValueOnce(false)
  expect(fireEvent.click(screen.getByRole('link', { name: '플롯' }))).toBe(false)
  expect(where()).toBe('/studio/work-id')
  model.mayLeave.mockReturnValueOnce(false)
  fireEvent.click(screen.getByRole('link', { name: '내가 쓰는 소설' }))
  expect(where()).toBe('/studio/work-id')
})

it('회차 편집 영역은 건너뛰기 링크가 닿는 하나의 main 안에 있고 h1은 하나다', () => {
  renderStudio()
  const main = screen.getByRole('main')
  expect(screen.getAllByRole('main')).toHaveLength(1)
  expect(main.id).toBe('main')
  expect(main.getAttribute('tabindex')).toBe('-1')
  expect(main.contains(screen.getByLabelText('원고 본문'))).toBe(true)
  expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual(['집필실'])
})

it('회차를 불러오는 동안에도 main은 하나다', () => {
  model.ready = false
  try {
    renderStudio()
    expect(screen.getAllByRole('main')).toHaveLength(1)
    expect(screen.getByRole('main').id).toBe('main')
    expect(within(screen.getByRole('main')).getByText('회차를 불러오고 있어요…')).toBeTruthy()
  } finally {
    model.ready = true
  }
})

it('탭 제목에 집필실을 쓴다', () => {
  renderStudio()
  expect(document.title).toBe('집필실 · STORYFORK')
  cleanup()
  expect(document.title).toBe('STORYFORK')
})
