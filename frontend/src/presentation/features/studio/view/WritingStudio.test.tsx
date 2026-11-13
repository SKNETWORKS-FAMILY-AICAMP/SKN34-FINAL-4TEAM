// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { Editor } from '@tiptap/core'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import { Provider } from 'react-redux'
import { MemoryRouter, useLocation } from 'react-router'
import { createAppStore } from '../../../../app/store'
import { stubRangeGeometry } from '../../../../test/rangeGeometry'
import { WritingStudio } from './WritingStudio'

const model = vi.hoisted(() => ({
  active: { number: 1, draft: { title: '첫 회차', body: '원고', revision: 1 }, versions: [{ id: 'v1', title: '저장본', body: '저장 원고', savedAt: '2026-11-04T00:00:00Z' }], inherited: false, hasDraft: true, publishedVersionId: null as string | null, checkpoints: [] as { versionId: string; publishedAt: string; active: boolean }[] },
  episodes: [] as { number: number; draft: { title: string }; inherited: boolean; publishedVersionId: string | null; publicationStatus: string; versions: unknown[]; checkpoints: { versionId: string; publishedAt: string; active: boolean }[] }[],
  draft: { title: '첫 회차', body: '원고', revision: 1 },
  busy: false, error: '', notice: '', ready: true, dirty: false, editingLocked: false,
  deleteBlocker: '', deleteBlockerOf: vi.fn((e: { inherited: boolean; publishedVersionId: string | null }) => e.inherited ? '원작 기준 회차는 삭제할 수 없어요.' : e.publishedVersionId ? '발행본이 있는 회차는 삭제할 수 없어요.' : ''),
  addImage: vi.fn().mockResolvedValue(true), orderLookup: null as null | { status: 'loading' } | { status: 'failed'; message: string } | { status: 'ready'; scope: { number: number; candidateNumbers: number[]; reasons: string[]; executable: false } },
  checkOrder: vi.fn(), deleteDraft: vi.fn(),
  edit: vi.fn(), save: vi.fn(), reload: vi.fn(), deleteEpisode: vi.fn(), publish: vi.fn().mockResolvedValue(true), revertCheckpoint: vi.fn().mockResolvedValue(true), restore: vi.fn(), mayLeave: vi.fn(() => true),
  create: vi.fn().mockResolvedValue(true), select: vi.fn<(e: { number: number }) => boolean>(() => true),
  cancel: vi.fn(), loadPublicationHistory: vi.fn(), historyLoading: false, historyError: '', publicationHistory: null as null | unknown[],
  changeVisibility: vi.fn().mockResolvedValue(true),
}))
// 호출 인자(주소의 ?ep=n)를 확인하려고 훅 호출을 기록한다. 실제 ViewModel의 삭제는 그 렌더의 활성 회차를 지우므로 함수가 렌더 시점의 active를 붙잡도록 흉내 낸다.
const useModel = vi.hoisted(() => vi.fn())
vi.mock('../viewmodel/useWritingViewModel', () => ({ useWritingViewModel: (...args: unknown[]) => { useModel(...args); const { active } = model; return { ...model, deleteEpisode: () => model.deleteEpisode(active) } } }))
vi.mock('../../../shared/screenIds', () => ({ useScreenId: () => {} }))
vi.mock('../../../shared/media/MediaPanel', () => ({ ManuscriptBody: ({ body }: { body: string }) => <p>{body}</p>, StoredImage: () => null }))
vi.mock('./SettingHistoryPanel', () => ({ SettingHistoryPanel: ({ workId }: { workId: string }) => <section aria-label="설정 버전 이력"><h2>설정 버전 이력</h2><p>{workId}</p></section> }))
beforeAll(stubRangeGeometry)
const originalActive = model.active
const originalDraft = model.draft
// 공개에는 본문 5,000자 이상이 필요하다(UC-10 U13). 공개 경로를 시험하는 저장 버전은 정확히 5,000자로 만든다.
const LONG = '저장 원고'.padEnd(5000, '가')
const savedVersion = (id: string, body = LONG) => ({ ...originalActive.versions[0], id, body })
const comparisonVersions = [
  ...originalActive.versions,
  { ...originalActive.versions[0], id: 'v2', body: '변경 원고' },
  { ...originalActive.versions[0], id: 'v3', body: '추가 원고' },
]
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllEnvs(); model.active = originalActive; model.draft = originalDraft; model.deleteBlocker = ''; model.orderLookup = null; model.episodes = []; model.busy = false; model.dirty = false; model.editingLocked = false; model.publicationHistory = null; model.error = ''; model.notice = '' })
const Where = () => { const l = useLocation(); return <p hidden data-testid="where">{l.pathname + l.search}</p> }
const where = () => screen.getByTestId('where').textContent
const renderStudio = (ui: Parameters<typeof createAppStore>[1] = {}, episode?: number) => {
  const store = createAppStore({}, ui)
  const view = render(<WritingStudio id="work-id" episode={episode} />, {
    wrapper: ({ children }) => <Provider store={store}><MemoryRouter initialEntries={['/studio/work-id']}>{children}<Where /></MemoryRouter></Provider>,
  })
  return { ...view, store }
}
// 원고 외 기능(작가의 말·이미지·내보내기·회차 관리·삭제)은 편집기 하단의 '회차 설정' 시트에 있다.
const openSettings = () => fireEvent.click(screen.getByRole('button', { name: '회차 설정' }))
const renderSettings = () => { const view = renderStudio(); openSettings(); return view }
// 상단 바에서 버튼 하나로 여는 '더보기' 메뉴
const openMore = () => fireEvent.click(screen.getByRole('button', { name: '더보기' }))
const versionsButton = () => screen.getByRole('button', { name: '버전 · 공개' })
// 편집기 하단의 한 줄 바(글자 수·저장 안내·회차 설정)
const footer = () => screen.getByRole('button', { name: '회차 설정' }).closest('.writing-foot') as HTMLElement

it('connects the whole episode deletion button and disables it for inherited episodes', () => {
  const { rerender } = renderSettings()
  fireEvent.click(screen.getByRole('button', { name: '회차 삭제' }))
  expect(model.deleteEpisode).toHaveBeenCalledTimes(1)
  model.active = { ...originalActive, inherited: true }
  rerender(<WritingStudio id="work-id" />)
  expect(screen.getByRole('button', { name: '회차 삭제' })).toHaveProperty('disabled', true)
})

it('passes the ?ep=n episode number to the writing view model so the studio opens that episode, and nothing when there is none', () => {
  renderStudio({}, 2)
  expect(useModel).toHaveBeenLastCalledWith('work-id', undefined, undefined, 2)
  cleanup()
  renderStudio()
  expect(useModel).toHaveBeenLastCalledWith('work-id', undefined, undefined, undefined)
})

const manage = () => screen.getByRole('region', { name: '회차 관리' })
const danger = () => screen.getByRole('region', { name: '위험 영역' })

it('uses the danger style for both deletion buttons and keeps them in the danger zone', () => {
  renderSettings()
  expect(screen.getByRole('button', { name: '초안 삭제' }).className).toContain('danger')
  expect(screen.getByRole('button', { name: '회차 삭제' }).className).toContain('danger')
  expect(danger().contains(screen.getByRole('button', { name: '초안 삭제' }))).toBe(true)
  expect(danger().contains(screen.getByRole('button', { name: '회차 삭제' }))).toBe(true)
})

it('disables an unavailable episode deletion and links the reason with aria-describedby', () => {
  model.deleteBlocker = '저장한 버전이 있는 회차는 삭제할 수 없어요.'
  renderSettings()
  const button = screen.getByRole('button', { name: '회차 삭제' })
  expect(button).toHaveProperty('disabled', true)
  const reason = document.getElementById(button.getAttribute('aria-describedby') ?? '')
  expect(reason?.textContent).toBe('저장한 버전이 있는 회차는 삭제할 수 없어요.')
  expect(danger().contains(reason)).toBe(true)
  fireEvent.click(button)
  expect(model.deleteEpisode).not.toHaveBeenCalled()
})

it('neither disables nor describes an episode deletion that has no known blocker', () => {
  renderSettings()
  const button = screen.getByRole('button', { name: '회차 삭제' })
  expect(button).toHaveProperty('disabled', false)
  expect(button.hasAttribute('aria-describedby')).toBe(false)
})

it.each([['회차 삭제', 'deleteEpisode'], ['초안 삭제', 'deleteDraft']] as const)('%s moves focus to main only after the deletion is committed', async (name, action) => {
  renderSettings()
  const button = screen.getByRole('button', { name })
  button.focus()
  model[action].mockResolvedValueOnce(false)
  await act(async () => { fireEvent.click(button) })
  expect(document.activeElement).toBe(button)
  expect(screen.getByRole('dialog', { name: '회차 설정' })).toBeTruthy()
  model[action].mockResolvedValueOnce(true)
  await act(async () => { fireEvent.click(button) })
  // 확정되면 시트를 닫고, 시트가 열었던 버튼으로 초점을 돌려준 뒤에 main으로 옮긴다.
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(document.activeElement).toBe(screen.getByRole('main'))
})

const orderButton = () => screen.getByRole('button', { name: '순서 변경 가능 범위 확인' })
const orderLive = () => orderButton().nextElementSibling as HTMLElement

it('keeps an always-mounted live region right under the order button inside the management section', () => {
  renderSettings()
  expect(manage().contains(orderButton())).toBe(true)
  expect(orderLive().getAttribute('role')).toBe('status')
  expect(orderLive().getAttribute('aria-live')).toBe('polite')
  expect(orderLive().textContent).toBe('')
  expect(orderButton()).toHaveProperty('disabled', false)
  fireEvent.click(orderButton())
  expect(model.checkOrder).toHaveBeenCalledTimes(1)
})

it('shows the lookup in progress in that region and blocks repeated lookups with aria-busy', () => {
  model.orderLookup = { status: 'loading' }
  renderSettings()
  expect(orderLive().textContent).toBe('순서 변경 후보를 확인하고 있어요…')
  expect(screen.getAllByText('순서 변경 후보를 확인하고 있어요…')).toHaveLength(1)
  expect(orderButton()).toHaveProperty('disabled', true)
  expect(orderButton().getAttribute('aria-busy')).toBe('true')
})

it('names the candidates as N화 and keeps the reasons in the same region', () => {
  model.orderLookup = { status: 'ready', scope: { number: 1, candidateNumbers: [1, 2], reasons: ['저장 버전 제한'], executable: false } }
  renderSettings()
  expect(orderLive().textContent).toContain('검토 후보 위치 1화, 2화')
  expect(within(orderLive()).getByText('저장 버전 제한')).toBeTruthy()
  expect(orderButton().getAttribute('aria-busy')).not.toBe('true')
  expect(orderButton()).toHaveProperty('disabled', false)
})

it('says when there is no candidate and shows a lookup failure in the same region', () => {
  model.orderLookup = { status: 'ready', scope: { number: 1, candidateNumbers: [], reasons: [], executable: false } }
  const view = renderSettings()
  expect(orderLive().textContent).toContain('검토 후보 위치 없음')
  model.orderLookup = { status: 'failed', message: '후보 조회 실패' }
  view.rerender(<WritingStudio id="work-id" />)
  expect(orderLive().textContent).toBe('후보 조회 실패')
  expect(screen.getAllByText('후보 조회 실패')).toHaveLength(1)
})

function chooseComparison() {
  fireEvent.click(screen.getByRole('button', { name: '버전 · 공개' }))
  fireEvent.click(screen.getByRole('button', { name: '원고 버전 비교' }))
  fireEvent.change(screen.getByLabelText('기준 원고 버전'), { target: { value: 'v1' } })
  fireEvent.change(screen.getByLabelText('비교 원고 버전'), { target: { value: 'v2' } })
}

function expectComparisonSelection(before: string, after: string) {
  expect(screen.getByLabelText('기준 원고 버전')).toHaveProperty('value', before)
  expect(screen.getByLabelText('비교 원고 버전')).toHaveProperty('value', after)
}

it('팀 서재로 돌아가며 공개 시트에서 버전 선택과 권리 확인 후 기존 API 동작을 사용한다', async () => {
  model.active = { ...originalActive, versions: [savedVersion('v1')] }
  renderStudio()
  expect(screen.getByRole('link', { name: '내가 쓰는 소설' }).getAttribute('href')).toBe('/lib?tab=write')
  expect(screen.queryByRole('dialog')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '버전 · 공개' }))
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
const openVersions = () => fireEvent.click(screen.getByRole('button', { name: '버전 · 공개' }))
const revertRights = '이 체크포인트를 다시 공개할 권리가 있음을 확인합니다.'

it('발행 체크포인트를 시각순으로 보여 주고 현재 공개가 아닌 항목만 권리 확인 후 되돌린다', async () => {
  model.active = { ...originalActive, versions: [savedVersion('v1'), savedVersion('v2')], checkpoints: checkpointRows }
  renderStudio()
  openVersions()
  const items = within(screen.getByRole('region', { name: '발행 체크포인트' })).getAllByRole('listitem')
  expect(items).toHaveLength(2)
  expect(items[0].textContent).toContain('체크포인트 1')
  expect(items[0].textContent).toContain(new Date(checkpointRows[0].publishedAt).toLocaleString('ko-KR'))
  expect(items[0].textContent).not.toContain('현재 공개')
  expect(items[1].textContent).toContain('체크포인트 2')
  expect(items[1].textContent).toContain('현재 공개')
  expect(within(items[1]).queryByRole('button', { name: '이 체크포인트로 되돌리기' })).toBeNull()
  const detail = within(items[0]).getByRole('button', { name: /^체크포인트 1/ })
  expect(detail.getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(detail)
  expect(detail.getAttribute('aria-expanded')).toBe('true')
  expect(within(items[0]).getByRole('heading', { name: '저장본' })).toBeTruthy()
  expect(within(items[0]).getByText(LONG)).toBeTruthy()
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
  model.active = { ...originalActive, versions: [savedVersion('v1'), savedVersion('v2')], checkpoints: checkpointRows }
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
  openMore()
  fireEvent.click(screen.getByRole('menuitem', { name: '설정 버전 이력' }))
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
  const opener = screen.getByRole('button', { name: '버전 · 공개' })
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
    // 작품 관리 화면의 탭과 같은 표현(nav 안의 버튼 + aria-current)으로 지금 보는 화면을 알린다.
    expect(target.getAttribute('aria-current')).toBe('page')
    expect(target.hasAttribute('aria-pressed')).toBe(false)
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
    expect(screen.getByText('작업 초안이 없어요. 입력하면 새 초안으로 저장되며, 상단의 버전 · 공개에서 이전 버전을 복원할 수 있어요.')).toBeTruthy()
    expect(screen.getByRole('button', { name: '버전 · 공개' })).toBeTruthy()
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
  fireEvent.click(screen.getByRole('button', { name: '버전 · 공개' }))
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
  openMore()
  expect(fireEvent.click(screen.getByRole('menuitem', { name: '플롯' }))).toBe(false)
  expect(where()).toBe('/studio/work-id?view=narrative')
  // 항목을 고르면 메뉴가 닫힌다
  expect(screen.queryByRole('menu')).toBeNull()
  expect(fireEvent.click(screen.getByRole('link', { name: '내가 쓰는 소설' }))).toBe(false)
  expect(where()).toBe('/lib?tab=write')
  expect(model.mayLeave).toHaveBeenCalledTimes(2)
})

it('저장하지 않은 입력이나 진행 중 요청 때문에 이동할 수 없으면 링크가 이동하지 않는다', () => {
  renderStudio()
  openMore()
  model.mayLeave.mockReturnValueOnce(false)
  expect(fireEvent.click(screen.getByRole('menuitem', { name: '플롯' }))).toBe(false)
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


it('작가의 말 입력을 기존 편집 흐름에 연결하고 상속 회차에서는 읽기 전용이다', () => {
  const view=renderSettings()
  const note=screen.getByRole('textbox',{name:'작가의 말'})
  expect(note).toHaveProperty('maxLength',2000)
  fireEvent.change(note,{target:{value:'독자에게 보내는 후기'}})
  expect(model.edit).toHaveBeenCalledWith({authorNote:'독자에게 보내는 후기'})
  model.active={...originalActive,inherited:true}
  view.rerender(<WritingStudio id="work-id"/>)
  expect(screen.getByRole('textbox',{name:'작가의 말'})).toHaveProperty('readOnly',true)
})

const follows = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
const episodeRow = (number: number, title: string, patch: Partial<(typeof model.episodes)[number]> = {}) => ({ number, draft: { title }, inherited: false, publishedVersionId: null, publicationStatus: 'draft', versions: [], checkpoints: [], ...patch })

it('회차 목록은 채팅 대화 목록처럼 회차를 쌓고 누르면 그 회차로 이동한다', () => {
  const rows = [episodeRow(1, '첫 회차'), episodeRow(2, '둘째', { publishedVersionId: 'v9' })]
  model.episodes = rows
  renderStudio()
  const items = within(screen.getByRole('navigation', { name: '회차 목록' })).getAllByRole('button').filter(b => b.hasAttribute('aria-pressed'))
  expect(items.map(b => b.textContent)).toEqual(['1화 · 첫 회차비공개 초안', '2화 · 둘째발행본 있음 · 초안 별도'])
  expect(items.map(b => b.getAttribute('aria-pressed'))).toEqual(['true', 'false'])
  fireEvent.click(items[1])
  expect(model.select).toHaveBeenCalledExactlyOnceWith(rows[1])
})

it('회차 생성 폼 대신 목록 위의 새 회차 버튼 하나가 입력 없이 기본 제목으로 회차를 만든다', async () => {
  renderStudio()
  expect(screen.queryByLabelText('새 회차 제목')).toBeNull()
  expect(screen.queryByRole('button', { name: '회차 생성' })).toBeNull()
  const button = screen.getByRole('button', { name: '새 회차' })
  expect(follows(button, screen.getByRole('navigation', { name: '회차 목록' }))).toBe(true)
  // 글자 없는 아이콘 버튼(사각형 + 연필)이고 이름과 툴팁은 새 회차다.
  expect(button.textContent).toBe('')
  expect(button.getAttribute('title')).toBe('새 회차')
  expect(button.querySelector('svg')).not.toBeNull()
  await act(async () => { fireEvent.click(button) })
  // 서버가 빈 제목을 거부하므로 기본 제목을 넘기고 제목은 편집기 첫 줄에서 바꾼다.
  expect(model.create).toHaveBeenCalledExactlyOnceWith('새 회차')
})

it('처리 중에는 새 회차 버튼을 잠그고, 회차가 없어도 첫 회차를 만들 수 있게 목록 영역에 둔다', () => {
  model.busy = true
  const { rerender } = renderStudio()
  const locked = screen.getByRole('button', { name: '새 회차' })
  expect(locked).toHaveProperty('disabled', true)
  fireEvent.click(locked)
  expect(model.create).not.toHaveBeenCalled()
  model.busy = false
  model.active = null as never
  rerender(<WritingStudio id="work-id" />)
  expect(screen.getByRole('button', { name: '새 회차' })).toHaveProperty('disabled', false)
  expect(screen.getByText('회차가 없어요. 회차 목록의 새 회차 버튼으로 첫 회차를 만들어 이야기를 시작해 보세요.')).toBeTruthy()
  expect(screen.queryByRole('region', { name: '버전 그래프' })).toBeNull()
})

it('편집기 첫 줄은 placeholder 제목의 큰 입력이고 회차 제목 이름과 기존 편집 흐름을 유지한다', () => {
  renderStudio()
  const title = screen.getByRole('textbox', { name: '회차 제목' }) as HTMLInputElement
  expect(title.getAttribute('placeholder')).toBe('제목')
  expect(title.value).toBe('첫 회차')
  expect(follows(title, screen.getByLabelText('원고 본문'))).toBe(true)
  expect(screen.queryByText('회차 제목')).toBeNull()
  fireEvent.change(title, { target: { value: '새 제목' } })
  expect(model.edit).toHaveBeenCalledExactlyOnceWith({ title: '새 제목' })
})

it('원작 기준 회차는 제목과 본문이 읽기 전용이다', () => {
  model.active = { ...originalActive, inherited: true }
  renderStudio()
  expect(screen.getByRole('textbox', { name: '회차 제목' })).toHaveProperty('readOnly', true)
  // 편집기(contenteditable)의 읽기 전용: 편집 불가 + 보조기기에 읽기 전용으로 알린다.
  expect(screen.getByLabelText('원고 본문').getAttribute('contenteditable')).toBe('false')
  expect(screen.getByLabelText('원고 본문').getAttribute('aria-readonly')).toBe('true')
})

const graph = () => screen.getByRole('region', { name: '버전 그래프' })

it('선택 회차의 버전을 작업 초안 → 저장 버전 순서로 그리고 현재·저장 안 됨·발행본을 표시한다', () => {
  model.active = { ...originalActive, publishedVersionId: 'v1' }
  model.dirty = true
  renderStudio()
  const rows = within(graph()).getAllByRole('listitem')
  expect(rows.map(r => r.className)).toEqual(['graph-row draft head unsaved', 'graph-row version'])
  expect(rows[0].textContent).toContain('작업 초안')
  expect(rows[0].textContent).toContain('현재')
  expect(rows[0].textContent).toContain('저장 안 됨')
  expect(within(rows[0]).queryByRole('button')).toBeNull()
  expect(rows[1].textContent).toContain('버전 1 · 저장본')
  expect(rows[1].textContent).toContain('발행본')
  expect(within(graph()).getByRole('heading', { level: 2, name: '버전 그래프 · 1화' })).toBeTruthy()
})

it('저장하지 않은 변경이나 발행본이 없으면 해당 배지를 그리지 않는다', () => {
  renderStudio()
  expect(graph().textContent).not.toContain('저장 안 됨')
  expect(graph().textContent).not.toContain('발행본')
})

it('그래프의 저장 버전 노드를 누르면 기존 버전 시트가 열리고 그 버전이 선택돼 있다', () => {
  renderStudio()
  const node = within(graph()).getByRole('button', { name: /^버전 1 · 저장본/ })
  expect(node.getAttribute('aria-current')).toBeNull()
  fireEvent.click(node)
  expect(screen.getByRole('dialog', { name: '원고 저장본 · 공개' })).toBeTruthy()
  expect(screen.getByLabelText('검토할 저장 버전')).toHaveProperty('value', 'v1')
  expect(screen.getByRole('heading', { level: 3, name: '저장본' })).toBeTruthy()
  // 복원·공개는 시트의 기존 버튼을 그대로 쓰며 노드를 누르는 것만으로는 저장하지 않는다.
  expect(screen.getByRole('button', { name: '선택 버전을 새 버전으로 복원' })).toBeTruthy()
  expect(model.restore).not.toHaveBeenCalled()
  expect(model.publish).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '닫기' }))
  expect(within(graph()).getByRole('button', { name: /^버전 1 · 저장본/ }).getAttribute('aria-current')).toBe('true')
})

it('처리 중에는 그래프 노드를 잠그고 원작 기준 회차는 기준 노드만 현재 위치로 그린다', () => {
  model.busy = true
  const { rerender } = renderStudio()
  expect(within(graph()).getByRole('button', { name: /^버전 1 · 저장본/ })).toHaveProperty('disabled', true)
  model.busy = false
  model.active = { ...originalActive, versions: [], inherited: true }
  rerender(<WritingStudio id="work-id" />)
  const rows = within(graph()).getAllByRole('listitem')
  expect(rows.map(r => r.className)).toEqual(['graph-row base head'])
  expect(rows[0].textContent).toContain('원작 기준')
})

it('상단 바의 기본·고급 토글은 기본이 눌려 있고 고급에서만 준비 중 자리표시를 보인다', () => {
  renderStudio()
  const group = screen.getByRole('group', { name: '집필 모드' })
  expect(screen.getByRole('banner').contains(group)).toBe(true)
  const basic = within(group).getByRole('button', { name: '기본' })
  const advanced = within(group).getByRole('button', { name: '고급' })
  expect([basic, advanced].map(b => b.getAttribute('aria-pressed'))).toEqual(['true', 'false'])
  expect(screen.queryByRole('region', { name: '고급 도구' })).toBeNull()
  fireEvent.click(advanced)
  expect([basic, advanced].map(b => b.getAttribute('aria-pressed'))).toEqual(['false', 'true'])
  const placeholder = screen.getByRole('region', { name: '고급 도구' })
  expect(within(placeholder).getByText('고급 도구 준비 중')).toBeTruthy()
  expect(screen.getByLabelText('원고 본문')).toBeTruthy()
  // 제목과 본문 사이를 끊지 않고 본문 뒤 하단 바 위에 한 줄로 놓는다.
  expect(follows(screen.getByLabelText('원고 본문'), placeholder)).toBe(true)
  expect(follows(placeholder, footer())).toBe(true)
  fireEvent.click(basic)
  expect(screen.queryByRole('region', { name: '고급 도구' })).toBeNull()
})

it('상단 바는 컨트롤을 네 개만 보이고 저장 상태는 제목 옆 작은 글씨로 둔다', () => {
  renderStudio()
  const bar = screen.getByRole('banner')
  expect(within(bar).getByRole('link', { name: '내가 쓰는 소설' })).toBeTruthy()
  expect(within(bar).getByRole('heading', { level: 1, name: '집필실' })).toBeTruthy()
  expect(within(bar).getByRole('status').textContent).toBe('저장됨')
  const names = within(bar).getAllByRole('button').map(b => b.textContent || b.getAttribute('aria-label'))
  expect(names).toEqual(['기본', '고급', '버전 저장', '버전 · 공개', '더보기'])
  // 자주 안 쓰는 이동·이력은 메뉴가 열리기 전에는 상단에 없다
  for (const name of ['플롯', '다시 불러오기', '설정 버전 이력', '발행 이력']) {
    expect(within(bar).queryByRole('link', { name })).toBeNull()
    expect(within(bar).queryByRole('button', { name })).toBeNull()
  }
  fireEvent.click(within(bar).getByRole('button', { name: '버전 저장' }))
  expect(model.save).toHaveBeenCalledTimes(1)
  fireEvent.click(versionsButton())
  expect(screen.getByRole('dialog', { name: '원고 저장본 · 공개' })).toBeTruthy()
})

it('처리 중이거나 회차가 없으면 상단 바와 메뉴 항목을 기존 조건대로 잠근다', () => {
  model.busy = true
  const { rerender } = renderStudio()
  expect(screen.getByRole('button', { name: '버전 저장' })).toHaveProperty('disabled', true)
  expect(versionsButton()).toHaveProperty('disabled', true)
  openMore()
  expect(screen.getByRole('menuitem', { name: '다시 불러오기' })).toHaveProperty('disabled', true)
  expect(screen.getByRole('menuitem', { name: '설정 버전 이력' })).toHaveProperty('disabled', true)
  expect(screen.getByRole('menuitem', { name: '발행 이력' })).toHaveProperty('disabled', false)
  expect(screen.getByRole('menuitem', { name: '플롯' })).toBeTruthy()
  model.busy = false
  model.active = { ...originalActive, inherited: true }
  rerender(<WritingStudio id="work-id" />)
  expect(screen.getByRole('button', { name: '버전 저장' })).toHaveProperty('disabled', true)
  expect(versionsButton()).toHaveProperty('disabled', false)
  model.active = null as never
  rerender(<WritingStudio id="work-id" />)
  expect(versionsButton()).toHaveProperty('disabled', true)
})

it('더보기 메뉴는 플롯·다시 불러오기·설정 버전 이력·발행 이력·다크 모드를 모으고 Escape·바깥 클릭·항목 선택으로 닫는다', () => {
  vi.stubEnv('DEV', false)
  renderStudio()
  const more = screen.getByRole('button', { name: '더보기' })
  expect(more.getAttribute('aria-haspopup')).toBe('menu')
  expect(more.getAttribute('aria-expanded')).toBe('false')
  expect(screen.queryByRole('menu')).toBeNull()
  fireEvent.click(more)
  expect(more.getAttribute('aria-expanded')).toBe('true')
  const menu = screen.getByRole('menu', { name: '더보기' })
  expect(within(menu).getAllByRole('menuitem').map(i => i.textContent)).toEqual(['플롯', '다시 불러오기', '설정 버전 이력', '발행 이력', '다크 모드'])
  expect(within(menu).getByRole('menuitem', { name: '플롯' }).getAttribute('href')).toBe('/studio/work-id?view=narrative')
  // 열면 첫 항목으로 초점이 가고 방향키로 옮긴다. Escape로 닫으면 버튼으로 돌아온다.
  expect(document.activeElement).toBe(within(menu).getByRole('menuitem', { name: '플롯' }))
  fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' })
  expect(document.activeElement).toBe(within(menu).getByRole('menuitem', { name: '다시 불러오기' }))
  fireEvent.keyDown(document.activeElement!, { key: 'End' })
  expect(document.activeElement).toBe(within(menu).getByRole('menuitem', { name: '다크 모드' }))
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
  expect(screen.queryByRole('menu')).toBeNull()
  expect(document.activeElement).toBe(more)
  // 바깥을 누르면 닫힌다.
  fireEvent.click(more)
  fireEvent.pointerDown(document.body)
  expect(screen.queryByRole('menu')).toBeNull()
  // 항목을 고르면 그 동작을 하고 닫히며 초점이 버튼으로 돌아온다.
  fireEvent.click(more)
  fireEvent.click(screen.getByRole('menuitem', { name: '다시 불러오기' }))
  expect(model.reload).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('menu')).toBeNull()
  expect(document.activeElement).toBe(more)
})

it('더보기의 발행 이력은 단일 시트를 열고, 닫으면 초점이 더보기 버튼으로 돌아온다', () => {
  renderStudio()
  openMore()
  fireEvent.click(screen.getByRole('menuitem', { name: '발행 이력' }))
  expect(model.loadPublicationHistory).toHaveBeenCalledTimes(1)
  expect(screen.getAllByRole('dialog')).toHaveLength(1)
  expect(screen.getByRole('dialog', { name: '발행 이력' })).toBeTruthy()
  fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '더보기' }))
})

it('편집기에는 제목·본문과 한 줄 하단 바(글자 수·저장 안내·회차 설정)만 남기고 나머지는 보이지 않는다', () => {
  renderStudio()
  const editor = screen.getByRole('textbox', { name: '회차 제목' }).closest('.writing-editor') as HTMLElement
  for (const name of ['작가의 말']) expect(screen.queryByRole('textbox', { name })).toBeNull()
  for (const name of ['초안 삭제', '회차 삭제', '순서 변경 가능 범위 확인', '발행 이력', '회차 공개 중단', '내보내기']) expect(screen.queryByRole('button', { name })).toBeNull()
  for (const name of ['회차 관리', '위험 영역', '원고 내보내기', '회차 이미지']) expect(screen.queryByRole('region', { name })).toBeNull()
  expect(screen.queryByLabelText('본문 이미지 추가')).toBeNull()
  expect(within(editor).getAllByRole('button').map(b => b.getAttribute('aria-label') || b.textContent)).toEqual(['이미지 첨부', '회차 설정'])
  const foot = footer()
  expect(editor.contains(foot)).toBe(true)
  expect(foot.textContent).toContain('2 / 40,000자')
  expect(foot.textContent).toContain('입력을 멈추면 2초 후 초안만 저장해요. 버전 저장과 공개는 각각 선택하세요.')
  expect(follows(screen.getByLabelText('원고 본문'), foot)).toBe(true)
  expect(screen.getByRole('button', { name: '회차 설정' }).getAttribute('aria-haspopup')).toBe('dialog')
})

it('원작 기준 회차의 하단 바는 보존 안내를 보여 주고 처리 중에는 진행 중 요청 취소를 둔다', () => {
  model.active = { ...originalActive, inherited: true }
  model.busy = true
  renderStudio()
  expect(footer().textContent).toContain('원작 기준 버전을 보존한 원고예요.')
  expect(footer().textContent).not.toContain('2초 후 초안만 저장해요')
  fireEvent.click(within(footer()).getByRole('button', { name: '진행 중 요청 취소' }))
  expect(model.cancel).toHaveBeenCalledTimes(1)
  expect(within(footer()).getByRole('button', { name: '회차 설정' })).toHaveProperty('disabled', false)
  model.busy = false
  cleanup()
  renderStudio()
  expect(screen.queryByRole('button', { name: '진행 중 요청 취소' })).toBeNull()
})

it('회차 설정 시트는 의미별로 묶고 위험 영역을 맨 아래에 두며, 닫으면 회차 설정 버튼으로 초점이 돌아온다', () => {
  renderStudio()
  const opener = screen.getByRole('button', { name: '회차 설정' })
  opener.focus()
  fireEvent.click(opener)
  const dialog = screen.getByRole('dialog', { name: '회차 설정' })
  expect(within(dialog).getByRole('heading', { level: 2, name: '회차 설정 · 1화' })).toBeTruthy()
  // 작가의 말 → 이미지 → 원고 내보내기 → 회차 관리 → 위험 영역
  expect(within(dialog).getAllByRole('heading', { level: 3 }).map(h => h.textContent)).toEqual(['회차 이미지', '원고 내보내기', '회차 관리', '위험 영역'])
  expect(follows(within(dialog).getByRole('textbox', { name: '작가의 말' }), within(dialog).getByLabelText('본문 이미지 추가'))).toBe(true)
  expect(follows(within(dialog).getByLabelText('본문 이미지 추가'), manage())).toBe(true)
  expect(follows(manage(), danger())).toBe(true)
  expect(within(dialog).getByRole('region', { name: '회차 관리' }).querySelectorAll('.btn.danger')).toHaveLength(0)
  expect(within(dialog).getByText('현재 원고 이미지 미리보기')).toBeTruthy()
  // 안내문은 사실(PNG·JPEG, 10 MiB, 회차당 10개)을 지키며 한 줄로 줄였다.
  expect(within(dialog).getByText(/PNG·JPEG · 파일당 10 MiB 이하 · 회차당 업로드 최대 10개/)).toBeTruthy()
  fireEvent.click(within(dialog).getByRole('button', { name: '닫기' }))
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(document.activeElement).toBe(opener)
})

it('원작 기준 회차의 회차 설정 시트는 입력·이미지 추가·공개 조작을 읽기 전용으로 잠그고 삭제 버튼을 잠근다', () => {
  model.active = { ...originalActive, inherited: true, publishedVersionId: 'v1' }
  renderSettings()
  expect(screen.getByRole('textbox', { name: '작가의 말' })).toHaveProperty('readOnly', true)
  expect(screen.queryByLabelText('본문 이미지 추가')).toBeNull()
  expect(screen.queryByRole('region', { name: '회차 이미지' })).toBeNull()
  expect(screen.queryByRole('button', { name: '회차 공개 중단' })).toBeNull()
  expect(screen.getByRole('button', { name: '초안 삭제' })).toHaveProperty('disabled', true)
  expect(screen.getByRole('button', { name: '회차 삭제' })).toHaveProperty('disabled', true)
})

// 재공개는 이미 공개했던 발행본을 다시 켜는 동작이고 대상 버전을 서버가 발행 이력으로 정하므로(화면은 그 본문을 모른다) 5,000자 검사를 하지 않는다(UC-10).
it('회차 설정 시트의 공개 중단·재공개는 회차 관리 묶음에서 기존 조건대로 동작한다', async () => {
  model.active = { ...originalActive, publishedVersionId: 'v1' }
  const { rerender } = renderSettings()
  await act(async () => { fireEvent.click(within(manage()).getByRole('button', { name: '회차 공개 중단' })) })
  expect(model.changeVisibility).toHaveBeenCalledWith(false, false)
  model.active = { ...originalActive, publicationStatus: 'suspended' } as never
  rerender(<WritingStudio id="work-id" />)
  const resume = within(manage()).getByRole('button', { name: '회차 재공개' })
  expect(resume).toHaveProperty('disabled', true)
  fireEvent.click(within(manage()).getByRole('checkbox'))
  expect(resume).toHaveProperty('disabled', false)
  await act(async () => { fireEvent.click(resume) })
  expect(model.changeVisibility).toHaveBeenLastCalledWith(true, true)
})

it('회차 설정 시트의 발행 이력은 시트를 바꿔 열고, 닫으면 회차 설정 버튼으로 초점이 돌아온다', () => {
  renderStudio()
  const opener = screen.getByRole('button', { name: '회차 설정' })
  fireEvent.click(opener)
  fireEvent.click(within(manage()).getByRole('button', { name: '발행 이력' }))
  expect(model.loadPublicationHistory).toHaveBeenCalledTimes(1)
  expect(screen.getAllByRole('dialog')).toHaveLength(1)
  expect(screen.getByRole('dialog', { name: '발행 이력' })).toBeTruthy()
  fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(document.activeElement).toBe(opener)
})


// ── 공개 분량 규칙(UC-10 U13): 공개할 때만 본문 5,000자 이상, 상한 40,000자 ──
const text = (n: number) => '가'.repeat(n)

it('편집기 하단은 N / 40,000자와 함께 공개까지 남은 분량을 알려 주고 5,000자부터 공개 가능 분량이라고 한다', () => {
  model.draft = { ...originalDraft, body: text(2) }
  const view = renderStudio()
  expect(footer().textContent).toContain('2 / 40,000자 · 공개까지 5,000자 중 4,998자 남음')
  for (const [n, expected] of [[4999, '4,999 / 40,000자 · 공개까지 5,000자 중 1자 남음'], [5000, '5,000 / 40,000자 · 공개 가능 분량'], [40000, '40,000 / 40,000자 · 공개 가능 분량']] as const) {
    model.draft = { ...originalDraft, body: text(n) }
    view.rerender(<WritingStudio id="work-id" />)
    expect(footer().textContent).toContain(expected)
  }
  // 자동 저장·버전 저장은 분량과 무관하다: 짧아도 막지 않는다.
  model.draft = { ...originalDraft, body: text(2) }
  view.rerender(<WritingStudio id="work-id" />)
  expect(screen.getByRole('button', { name: '버전 저장' })).toHaveProperty('disabled', false)
})

it('원작 기준(읽기 전용) 회차는 공개할 수 없으므로 하단에 공개 분량 안내를 보이지 않는다', () => {
  model.active = { ...originalActive, inherited: true }
  renderStudio()
  expect(footer().textContent).toContain('2 / 40,000자')
  expect(footer().textContent).not.toContain('공개까지')
  expect(footer().textContent).not.toContain('공개 가능 분량')
})

it('저장 버전 본문이 5,000자 미만이면 권리를 확인해도 선택한 버전 공개를 잠그고 사유를 연결하며, 복원은 그대로 쓸 수 있다', async () => {
  model.active = { ...originalActive, versions: [savedVersion('short', text(4999)), savedVersion('exact', text(5000))] }
  renderStudio()
  openVersions()
  const pick = screen.getByLabelText('검토할 저장 버전')
  fireEvent.change(pick, { target: { value: 'short' } })
  fireEvent.click(screen.getByRole('checkbox'))
  const publish = screen.getByRole('button', { name: '선택한 저장 버전 공개' })
  expect(publish).toHaveProperty('disabled', true)
  expect(document.getElementById(publish.getAttribute('aria-describedby') ?? '')?.textContent).toBe('공개하려면 본문이 5,000자 이상이어야 해요. 지금은 4,999자예요.')
  fireEvent.click(publish)
  expect(model.publish).not.toHaveBeenCalled()
  // 분량은 공개에만 필요하다: 새 버전으로 복원은 그대로 가능하다.
  expect(screen.getByRole('button', { name: '선택 버전을 새 버전으로 복원' })).toHaveProperty('disabled', false)
  fireEvent.change(pick, { target: { value: 'exact' } })
  fireEvent.click(screen.getByRole('checkbox'))
  expect(publish).toHaveProperty('disabled', false)
  expect(publish.hasAttribute('aria-describedby')).toBe(false)
  await act(async () => { fireEvent.click(publish) })
  expect(model.publish).toHaveBeenCalledExactlyOnceWith('exact', true)
})

it('체크포인트의 저장 버전이 5,000자 미만이면 되돌리기를 잠그고 사유를 항목에 연결한다', () => {
  model.active = { ...originalActive, versions: [savedVersion('v1', text(1234)), savedVersion('v2')], checkpoints: checkpointRows }
  renderStudio()
  openVersions()
  fireEvent.click(screen.getByLabelText(revertRights))
  const revert = screen.getByRole('button', { name: '이 체크포인트로 되돌리기' })
  expect(revert).toHaveProperty('disabled', true)
  expect(document.getElementById(revert.getAttribute('aria-describedby') ?? '')?.textContent).toBe('공개하려면 본문이 5,000자 이상이어야 해요. 지금은 1,234자예요.')
  fireEvent.click(revert)
  expect(model.revertCheckpoint).not.toHaveBeenCalled()
})

// ── 편집기(Tiptap) 연결 ──
type Dom = HTMLElement & { editor: Editor }
const editorOf = () => (screen.getByLabelText('원고 본문') as Dom).editor

it('본문 입력은 기존 vm.edit({ body }) 자동 저장 흐름으로 이어지고 저장 중에는 편집할 수 없다', () => {
  const view = renderStudio()
  expect(screen.getByLabelText('원고 본문').getAttribute('contenteditable')).toBe('true')
  act(() => { editorOf().chain().focus('end').insertContent('!').run() })
  expect(model.edit).toHaveBeenCalledExactlyOnceWith({ body: '원고!' })
  model.editingLocked = true
  view.rerender(<WritingStudio id="work-id" />)
  expect(screen.getByLabelText('원고 본문').getAttribute('contenteditable')).toBe('false')
})

it('하단 이미지 첨부 버튼과 회차 설정의 본문 이미지 추가는 같은 업로드 경로(vm.addImage)에 커서 위치를 넘긴다', async () => {
  renderStudio()
  const file = new File(['png'], '본문.png', { type: 'image/png' })
  const attach = screen.getByRole('button', { name: '이미지 첨부' })
  expect(attach.getAttribute('title')).toBe('이미지 첨부')
  expect(follows(screen.getByLabelText('원고 본문'), attach)).toBe(true)
  const input = footer().querySelector<HTMLInputElement>('input[type="file"]')!
  expect(input.accept).toBe('.png,.jpg,.jpeg')
  const click = vi.spyOn(input, 'click')
  fireEvent.click(attach)
  expect(click).toHaveBeenCalledOnce()
  await act(async () => { fireEvent.change(input, { target: { files: [file] } }) })
  expect(model.addImage).toHaveBeenCalledExactlyOnceWith(file, 0, 0)
  model.addImage.mockClear()
  openSettings()
  await act(async () => { fireEvent.change(screen.getByLabelText('본문 이미지 추가'), { target: { files: [file] } }) })
  expect(model.addImage).toHaveBeenCalledExactlyOnceWith(file, 0, 0)
})

it('이미지 첨부 버튼은 처리 중에는 잠그고 원작 기준 회차에는 두지 않는다', () => {
  model.busy = true
  const view = renderStudio()
  expect(screen.getByRole('button', { name: '이미지 첨부' })).toHaveProperty('disabled', true)
  model.busy = false
  model.active = { ...originalActive, inherited: true }
  view.rerender(<WritingStudio id="work-id" />)
  expect(screen.queryByRole('button', { name: '이미지 첨부' })).toBeNull()
})

// ── 회차 항목의 세로 ⋮ 메뉴 ──
const rowMenu = (n: number) => screen.getByRole('button', { name: `${n}화 더보기` })
const openRowMenu = (n: number) => { fireEvent.click(rowMenu(n)); return screen.getByRole('menu', { name: `${n}화 더보기` }) }
const twoEpisodes = () => { const rows = [episodeRow(1, '첫 회차'), episodeRow(2, '둘째')]; model.episodes = rows; return rows }

it('회차 항목마다 세로 점 세 개 더보기 버튼이 있고 키보드로 늘 닿으며 메뉴를 연다', () => {
  twoEpisodes()
  renderStudio()
  const nav = screen.getByRole('navigation', { name: '회차 목록' })
  expect(within(nav).getAllByRole('button', { name: /화 더보기$/ }).map(b => b.getAttribute('aria-label'))).toEqual(['1화 더보기', '2화 더보기'])
  expect(rowMenu(1).getAttribute('aria-haspopup')).toBe('menu')
  expect(rowMenu(1).getAttribute('aria-expanded')).toBe('false')
  expect(rowMenu(1).tabIndex).toBe(0)
  const dots = [...rowMenu(1).querySelectorAll('svg circle')]
  expect(dots).toHaveLength(3)
  // 세 점은 세로로 쌓인다(같은 x, 다른 y).
  expect(new Set(dots.map(c => c.getAttribute('cx'))).size).toBe(1)
  expect(new Set(dots.map(c => c.getAttribute('cy'))).size).toBe(3)
  const menu = openRowMenu(2)
  expect(rowMenu(2).getAttribute('aria-expanded')).toBe('true')
  const items = within(menu).getAllByRole('menuitem')
  expect(items.map(i => i.textContent)).toEqual(['회차 설정', '체크포인트', '설정 수집 준비 중', '발행 이력', '회차 삭제'])
  // 구분선은 발행 이력과 회차 삭제 사이에만 있다.
  const separator = within(menu).getByRole('separator')
  expect(follows(items[3], separator) && follows(separator, items[4])).toBe(true)
})

it('목록을 스크롤하면 버튼에 묶이지 않은(fixed) 회차 메뉴를 닫아 다른 회차 옆에 남지 않게 하고, 버튼과 함께 움직이는 메뉴는 그대로 둔다', () => {
  twoEpisodes()
  renderStudio()
  const nav = screen.getByRole('navigation', { name: '회차 목록' })
  // 데스크톱 CSS는 메뉴를 fixed로 띄운다(jsdom은 CSS를 적용하지 않으므로 같은 상태를 만든다).
  openRowMenu(2).style.position = 'fixed'
  fireEvent.scroll(nav)
  expect(screen.queryByRole('menu')).toBeNull()
  expect(rowMenu(2).getAttribute('aria-expanded')).toBe('false')
  // 스크롤 중에도 동작은 시작하지 않는다.
  expect(model.select).not.toHaveBeenCalled()
  expect(model.deleteEpisode).not.toHaveBeenCalled()
  const moving = openRowMenu(2)
  fireEvent.scroll(nav)
  expect(screen.getByRole('menu', { name: '2화 더보기' })).toBe(moving)
})

it('활성 회차의 더보기 → 회차 설정은 회차를 다시 고르지 않고 기존 설정 시트를 열며, 닫으면 초점이 그 더보기 버튼으로 돌아온다', () => {
  twoEpisodes()
  renderStudio()
  fireEvent.click(within(openRowMenu(1)).getByRole('menuitem', { name: '회차 설정' }))
  expect(model.select).not.toHaveBeenCalled()
  const dialog = screen.getByRole('dialog', { name: '회차 설정' })
  expect(within(dialog).getByRole('heading', { level: 2, name: '회차 설정 · 1화' })).toBeTruthy()
  fireEvent.click(within(dialog).getByRole('button', { name: '닫기' }))
  expect(document.activeElement).toBe(rowMenu(1))
})

it('다른 회차의 더보기 → 회차 설정은 그 회차를 먼저 고른 뒤 시트를 열고, 고르지 못하면(입력을 버리지 않음) 열지 않는다', () => {
  const rows = twoEpisodes()
  renderStudio()
  model.select.mockReturnValueOnce(false)
  fireEvent.click(within(openRowMenu(2)).getByRole('menuitem', { name: '회차 설정' }))
  expect(model.select).toHaveBeenCalledExactlyOnceWith(rows[1])
  expect(screen.queryByRole('dialog')).toBeNull()
  fireEvent.click(within(openRowMenu(2)).getByRole('menuitem', { name: '회차 설정' }))
  expect(model.select).toHaveBeenCalledTimes(2)
  expect(screen.getByRole('dialog', { name: '회차 설정' })).toBeTruthy()
})

it('더보기 → 체크포인트는 버전 시트의 발행 체크포인트 영역을 열고, 체크포인트가 없는 회차는 잠근다', () => {
  model.active = { ...originalActive, versions: [savedVersion('v1'), savedVersion('v2')], checkpoints: checkpointRows }
  model.episodes = [episodeRow(1, '첫 회차', { checkpoints: checkpointRows }), episodeRow(2, '둘째')]
  renderStudio()
  expect(within(openRowMenu(2)).getByRole('menuitem', { name: '체크포인트' })).toHaveProperty('disabled', true)
  fireEvent.pointerDown(document.body)
  fireEvent.click(within(openRowMenu(1)).getByRole('menuitem', { name: '체크포인트' }))
  expect(screen.getByRole('dialog', { name: '원고 저장본 · 공개' })).toBeTruthy()
  expect(screen.getByRole('region', { name: '발행 체크포인트' })).toBeTruthy()
})

it('설정 수집은 아직 기능이 없어 준비 중으로 잠그고 눌러도 아무 일도 하지 않는다', () => {
  twoEpisodes()
  renderStudio()
  const item = within(openRowMenu(1)).getByRole('menuitem', { name: '설정 수집 준비 중' })
  expect(item).toHaveProperty('disabled', true)
  fireEvent.click(item)
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(model.select).not.toHaveBeenCalled()
})

it('더보기 → 발행 이력은 그 회차의 이력만 시트에 보여 주고, 이력이 없으면 안내한다(상단 더보기는 전체)', () => {
  twoEpisodes()
  const event = (episode: number, versionId: string) => ({ episode, versionId, action: 'publish', publishedAt: '2026-11-0' + episode + 'T00:00:00Z' })
  model.publicationHistory = [event(1, 'v1'), event(2, 'v9')]
  const view = renderStudio()
  fireEvent.click(within(openRowMenu(2)).getByRole('menuitem', { name: '발행 이력' }))
  expect(model.loadPublicationHistory).toHaveBeenCalledTimes(1)
  const dialog = screen.getByRole('dialog', { name: '2화 발행 이력' })
  expect(within(dialog).getAllByRole('listitem').map(li => li.textContent)).toEqual([expect.stringMatching(/^2화 · 발행 · /)])
  fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
  model.publicationHistory = [event(1, 'v1')]
  view.rerender(<WritingStudio id="work-id" />)
  fireEvent.click(within(openRowMenu(2)).getByRole('menuitem', { name: '발행 이력' }))
  expect(within(screen.getByRole('dialog', { name: '2화 발행 이력' })).getByText('이 회차의 발행 이력이 아직 없어요.')).toBeTruthy()
  fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
  openMore()
  fireEvent.click(screen.getByRole('menuitem', { name: '발행 이력' }))
  expect(within(screen.getByRole('dialog', { name: '발행 이력' })).getAllByRole('listitem')).toHaveLength(1)
})

it('더보기 → 회차 삭제는 활성 회차에서 기존 삭제 흐름(vm.deleteEpisode)을 그대로 쓰고 확정되면 초점을 본문으로 옮긴다', async () => {
  twoEpisodes()
  renderStudio()
  model.deleteEpisode.mockResolvedValueOnce(true)
  const item = within(openRowMenu(1)).getByRole('menuitem', { name: '회차 삭제' })
  await act(async () => { fireEvent.click(item) })
  expect(model.deleteEpisode).toHaveBeenCalledTimes(1)
  expect(model.select).not.toHaveBeenCalled()
  expect(document.activeElement).toBe(screen.getByRole('main'))
})

it('다른 회차의 회차 삭제는 그 회차를 먼저 고른 다음에야 삭제를 시작해 활성 회차를 잘못 지우지 않는다', async () => {
  const rows = twoEpisodes()
  renderStudio()
  model.select.mockImplementationOnce((e: { number: number }) => { model.active = { ...originalActive, number: e.number }; return true })
  let activeWhenDeleting = 0
  model.deleteEpisode.mockImplementationOnce(async (active: { number: number }) => { activeWhenDeleting = active.number; return false })
  const item = within(openRowMenu(2)).getByRole('menuitem', { name: '회차 삭제' })
  await act(async () => { fireEvent.click(item) })
  expect(model.select).toHaveBeenCalledExactlyOnceWith(rows[1])
  expect(model.deleteEpisode).toHaveBeenCalledTimes(1)
  expect(activeWhenDeleting).toBe(2)
  // 한 번 요청한 삭제는 다시 실행되지 않는다.
  await act(async () => {})
  expect(model.deleteEpisode).toHaveBeenCalledTimes(1)
})

it('고르지 못하면(입력을 버리지 않음) 다른 회차의 삭제를 시작하지 않는다', async () => {
  twoEpisodes()
  renderStudio()
  model.select.mockReturnValueOnce(false)
  const item = within(openRowMenu(2)).getByRole('menuitem', { name: '회차 삭제' })
  await act(async () => { fireEvent.click(item) })
  expect(model.deleteEpisode).not.toHaveBeenCalled()
})

it('삭제할 수 없는 회차(발행본·원작 기준)의 삭제 항목은 잠그고 사유를 그 항목에 연결한다', () => {
  model.episodes = [episodeRow(1, '첫'), episodeRow(2, '둘째', { publishedVersionId: 'v9' }), episodeRow(3, '셋째', { inherited: true })]
  renderStudio()
  const open = openRowMenu(2)
  const published = within(open).getByRole('menuitem', { name: '회차 삭제' })
  expect(published).toHaveProperty('disabled', true)
  expect(document.getElementById(published.getAttribute('aria-describedby') ?? '')?.textContent).toBe('발행본이 있는 회차는 삭제할 수 없어요.')
  fireEvent.click(published)
  expect(model.deleteEpisode).not.toHaveBeenCalled()
  expect(model.select).not.toHaveBeenCalled()
  fireEvent.pointerDown(document.body)
  const inherited = within(openRowMenu(3)).getByRole('menuitem', { name: '회차 삭제' })
  expect(inherited).toHaveProperty('disabled', true)
  expect(document.getElementById(inherited.getAttribute('aria-describedby') ?? '')?.textContent).toBe('원작 기준 회차는 삭제할 수 없어요.')
  fireEvent.pointerDown(document.body)
  const free = within(openRowMenu(1)).getByRole('menuitem', { name: '회차 삭제' })
  expect(free).toHaveProperty('disabled', false)
  expect(free.hasAttribute('aria-describedby')).toBe(false)
})

it('처리 중에는 더보기 항목 중 회차를 바꾸거나 지우는 항목을 잠근다', () => {
  twoEpisodes()
  model.busy = true
  renderStudio()
  const menu = openRowMenu(1)
  for (const name of ['회차 설정', '회차 삭제']) expect(within(menu).getByRole('menuitem', { name })).toHaveProperty('disabled', true)
})

// ── 왼쪽 레일의 회차 목록·버전 그래프 분할선 ──
const splitter = () => screen.getByRole('separator', { name: '회차 목록과 버전 그래프 크기 조절' })

it('회차 목록과 버전 그래프 사이에 키보드로 조절하는 가로 분할선을 두고 최소·최대 비율로 제한한다', () => {
  renderStudio()
  const bar = splitter()
  const list = screen.getByRole('navigation', { name: '회차 목록' })
  expect(follows(list, bar) && follows(bar, graph())).toBe(true)
  expect(bar.getAttribute('aria-orientation')).toBe('horizontal')
  expect(bar.tabIndex).toBe(0)
  expect(bar.getAttribute('aria-controls')).toBe(list.id)
  expect([bar.getAttribute('aria-valuemin'), bar.getAttribute('aria-valuenow'), bar.getAttribute('aria-valuemax')]).toEqual(['20', '50', '80'])
  fireEvent.keyDown(bar, { key: 'ArrowDown' })
  expect(bar.getAttribute('aria-valuenow')).toBe('55')
  fireEvent.keyDown(bar, { key: 'ArrowUp' })
  fireEvent.keyDown(bar, { key: 'ArrowUp' })
  expect(bar.getAttribute('aria-valuenow')).toBe('45')
  expect(list.style.flexBasis).toBe('45%')
  fireEvent.keyDown(bar, { key: 'Home' })
  expect(bar.getAttribute('aria-valuenow')).toBe('20')
  fireEvent.keyDown(bar, { key: 'ArrowUp' })
  expect(bar.getAttribute('aria-valuenow')).toBe('20')
  fireEvent.keyDown(bar, { key: 'End' })
  expect(bar.getAttribute('aria-valuenow')).toBe('80')
  fireEvent.keyDown(bar, { key: 'ArrowDown' })
  expect(bar.getAttribute('aria-valuenow')).toBe('80')
  // 다른 키는 값을 바꾸지 않고 막지도 않는다.
  expect(fireEvent.keyDown(bar, { key: 'a' })).toBe(true)
  expect(bar.getAttribute('aria-valuenow')).toBe('80')
})

it('분할선은 포인터로 끌어 조절하고, 놓은 뒤에는 따라가지 않으며, 회차가 없으면 없다', () => {
  const view = renderStudio()
  const bar = splitter()
  vi.spyOn(bar.parentElement!, 'getBoundingClientRect').mockReturnValue({ top: 100, height: 400, bottom: 500, left: 0, right: 0, width: 0, x: 0, y: 100, toJSON: () => ({}) })
  fireEvent.pointerMove(bar, { clientY: 180, pointerId: 1 })
  expect(bar.getAttribute('aria-valuenow')).toBe('50') // 누르기 전에는 움직이지 않는다
  fireEvent.pointerDown(bar, { clientY: 300, pointerId: 1 })
  fireEvent.pointerMove(bar, { clientY: 260, pointerId: 1 })
  expect(bar.getAttribute('aria-valuenow')).toBe('40')
  fireEvent.pointerMove(bar, { clientY: 110, pointerId: 1 })
  expect(bar.getAttribute('aria-valuenow')).toBe('20')
  fireEvent.pointerMove(bar, { clientY: 495, pointerId: 1 })
  expect(bar.getAttribute('aria-valuenow')).toBe('80')
  fireEvent.pointerUp(bar, { pointerId: 1 })
  fireEvent.pointerMove(bar, { clientY: 200, pointerId: 1 })
  expect(bar.getAttribute('aria-valuenow')).toBe('80')
  model.active = null as never
  view.rerender(<WritingStudio id="work-id" />)
  expect(screen.queryByRole('separator', { name: '회차 목록과 버전 그래프 크기 조절' })).toBeNull()
})

// ── 상단 더보기: 테마·화면 ID ──
it('더보기의 다크 모드 항목은 현재 상태에 맞는 문구로 기존 테마 전환을 쓰고 운영 화면에는 화면 ID 항목이 없다', () => {
  vi.stubEnv('DEV', false)
  const { store } = renderStudio({ theme: 'light' })
  openMore()
  fireEvent.click(screen.getByRole('menuitem', { name: '다크 모드' }))
  expect(store.getState().ui.theme).toBe('dark')
  openMore()
  expect(screen.queryByRole('menuitem', { name: '다크 모드' })).toBeNull()
  expect(screen.queryByRole('menuitem', { name: /화면 ID/ })).toBeNull()
  fireEvent.click(screen.getByRole('menuitem', { name: '라이트 모드' }))
  expect(store.getState().ui.theme).toBe('light')
})

it('화면 ID 토글은 개발 화면에서만 더보기 메뉴의 마지막 항목이 되고 현재 상태에 맞는 문구를 쓴다', () => {
  vi.stubEnv('DEV', true)
  const { store } = renderStudio()
  openMore()
  const items = screen.getAllByRole('menuitem')
  expect(items.map(i => i.textContent).slice(-2)).toEqual(['다크 모드', '화면 ID 끄기'])
  fireEvent.click(screen.getByRole('menuitem', { name: '화면 ID 끄기' }))
  expect(store.getState().ui.showSid).toBe(false)
  openMore()
  expect(screen.getByRole('menuitem', { name: '화면 ID 켜기' })).toBeTruthy()
})

// ── 알림: 늘 있는 자리에, 동작한 자리에서 ──
it('완료 안내는 늘 있는 상단 저장 상태 줄에 이어 적고 본문 위에 문단을 끼워 넣지 않는다', () => {
  model.notice = '새 원고 버전을 저장했어요. 발행본은 그대로예요.'
  renderStudio()
  const bar = screen.getByRole('banner')
  expect(within(bar).getByRole('status').textContent).toBe('저장됨 · 새 원고 버전을 저장했어요. 발행본은 그대로예요.')
  // 알림이 생기고 사라져도 아래 3단이 밀리지 않게, 상단 바와 본문 사이에는 아무것도 끼우지 않는다.
  expect(bar.nextElementSibling).toBe(screen.getByRole('main'))
})

it('오류는 상단 바 바로 아래의 오류 상자로 알리고 원고를 보관하라는 안내를 붙인다', () => {
  model.error = '동시 수정 충돌'
  renderStudio()
  const alert = screen.getByRole('alert')
  expect(alert.textContent).toBe('동시 수정 충돌 저장되지 않은 원고는 복사해 보관한 뒤 다시 불러올 수 있어요.')
  expect(alert.className).toContain('ep-alert')
  expect(screen.getByRole('banner').nextElementSibling).toBe(alert)
})

it('회차 설정 시트에서 보낸 요청의 실패와 완료는 시트 안에서도 알린다', () => {
  model.error = '이미지를 올리지 못했어요.'
  const view = renderSettings()
  const dialog = screen.getByRole('dialog', { name: '회차 설정' })
  expect(within(dialog).getByRole('alert').textContent).toBe('이미지를 올리지 못했어요.')
  model.error = ''
  model.notice = '회차 공개를 중단했어요.'
  view.rerender(<WritingStudio id="work-id" />)
  expect(within(dialog).queryByRole('alert')).toBeNull()
  expect(within(dialog).getByText('회차 공개를 중단했어요.').getAttribute('role')).toBe('status')
})

it('저장 버전 미리보기는 키보드로 내려 읽을 수 있는 이름 있는 영역이다', () => {
  renderStudio()
  fireEvent.click(within(graph()).getByRole('button', { name: /^버전 1 · 저장본/ }))
  const preview = screen.getByRole('region', { name: '선택한 저장 버전 원고' })
  expect(preview.tabIndex).toBe(0)
  expect(preview.className).toContain('writing-preview')
  expect(preview.textContent).toContain('저장 원고')
})

it('발행 체크포인트의 원고 미리보기도 키보드로 내려 읽을 수 있는 이름 있는 영역이다', () => {
  model.active = { ...originalActive, versions: [savedVersion('v1'), savedVersion('v2')], checkpoints: checkpointRows }
  renderStudio()
  openVersions()
  fireEvent.click(screen.getByRole('button', { name: /^체크포인트 1/ }))
  const preview = screen.getByRole('region', { name: '체크포인트 1 원고' })
  expect(preview.tabIndex).toBe(0)
  expect(within(preview).getByRole('heading', { name: '저장본' })).toBeTruthy()
})

// ── 목록에서 활성 회차 찾기: 주소의 ?ep=n, 좁은 화면의 가로 띠 ──
const box = (left: number, right: number, top: number, bottom: number) => ({ left, right, top, bottom, width: right - left, height: bottom - top, x: left, y: top, toJSON: () => ({}) })

it.each([
  ['가로 띠의 오른쪽 밖', box(640, 780, 0, 60), 628, 0],
  ['세로 목록의 아래쪽 밖', box(0, 240, 900, 960), 0, 888],
  ['이미 보이는 자리', box(40, 180, 10, 70), 0, 0],
])('활성 회차가 %s에 있으면 목록 상자 안에서만 옮겨 그 항목을 보이게 한다', (_where, at, left, top) => {
  model.episodes = [episodeRow(1, '첫 회차'), episodeRow(2, '둘째'), episodeRow(3, '셋째')]
  model.active = { ...originalActive, number: 3 }
  // jsdom은 배치를 계산하지 않으므로 목록 상자(가로 0~300, 세로 0~400)와 활성 항목의 자리를 정해 준다.
  const layout = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return this.matches('.writing-episodes') ? box(0, 300, 0, 400) : this.matches('.writing-episode.on') ? at : box(0, 0, 0, 0)
  })
  const page = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  try {
    renderStudio()
    const list = screen.getByRole('navigation', { name: '회차 목록' })
    expect([list.scrollLeft, list.scrollTop]).toEqual([left, top])
    // 문서 스크롤은 건드리지 않는다(좁은 화면에서 원고를 읽던 자리가 튀지 않게).
    expect(page).not.toHaveBeenCalled()
  } finally { layout.mockRestore(); page.mockRestore() }
})
