// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'

import { createAppStore } from '../../../../app/store'
import { WritingStudio } from './WritingStudio'

const model = vi.hoisted(() => ({
  active: { number: 3, draft: { title: '셋째', body: '원고', revision: 1 }, versions: [], inherited: false, hasDraft: true },
  episodes: [], draft: { title: '셋째', body: '원고', revision: 1 },
  busy: false, error: '', notice: '', ready: true, dirty: false, editingLocked: false,
  save: vi.fn(), reload: vi.fn(), mayLeave: vi.fn(() => true),
}))
vi.mock('../viewmodel/useWritingViewModel', () => ({ useWritingViewModel: () => model }))
vi.mock('../../../shared/screenIds', () => ({ useScreenId: () => {} }))
vi.mock('../../../shared/media/MediaPanel', () => ({ ManuscriptBody: ({ body }: { body: string }) => <p>{body}</p> }))
vi.mock('./ManuscriptExportPanel', () => ({
  ManuscriptExportPanel: (props: { workId: string; episode: number; inherited: boolean; disabled?: boolean }) => <p data-testid="export-panel">{JSON.stringify(props)}</p>,
}))
vi.mock('./EpisodeImagePanel', () => ({
  EpisodeImagePanel: (props: { workId: string; episode: number; draft: unknown; unsaved: boolean; onDraftSaved: () => void }) => (
    <div data-testid="image-panel" data-props={JSON.stringify({ workId: props.workId, episode: props.episode, draft: props.draft, unsaved: props.unsaved })}>
      <button type="button" onClick={props.onDraftSaved}>저장됨 알림</button>
    </div>
  ),
}))

const original = { ...model, active: model.active }
afterEach(() => { cleanup(); vi.clearAllMocks(); Object.assign(model, original) })
const exportProps = () => JSON.parse(screen.getByTestId('export-panel').textContent!)
const imageProps = () => JSON.parse(screen.getByTestId('image-panel').dataset.props!)
const renderStudio = () => render(<Provider store={createAppStore()}><MemoryRouter><WritingStudio id="work-id" /></MemoryRouter></Provider>)

it('서버 내보내기 패널이 브라우저 TXT 내보내기 버튼을 대신하고 현재 회차를 넘긴다', () => {
  renderStudio()
  expect(exportProps()).toEqual({ workId: 'work-id', episode: 3, inherited: false, disabled: false })
  expect(screen.queryByRole('button', { name: /TXT 내보내기/ })).toBeNull()
})

it('저장 중이거나 저장하지 않은 입력이 있으면 내보내기 패널을 잠가 오래된 서버 원고를 내보내지 않는다', () => {
  for (const patch of [{ busy: true }, { dirty: true }]) {
    Object.assign(model, original, patch)
    renderStudio()
    expect(exportProps().disabled).toBe(true)
    cleanup()
  }
})

it('원작 기준 회차 여부를 내보내기 패널에 알린다', () => {
  model.active = { ...model.active, inherited: true }
  renderStudio()
  expect(exportProps().inherited).toBe(true)
})

it('회차 이미지 패널이 현재 회차와 편집 중인 초안을 받고, 초안 저장 알림은 집필실 다시 불러오기로 이어진다', () => {
  renderStudio()
  expect(imageProps()).toEqual({ workId: 'work-id', episode: 3, draft: model.draft, unsaved: false })
  expect(model.reload).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '저장됨 알림' }))
  expect(model.reload).toHaveBeenCalledTimes(1)
})

it('저장 중이거나 저장하지 않은 입력이 있으면 회차 이미지 패널에 unsaved로 알린다', () => {
  for (const patch of [{ busy: true }, { dirty: true }]) {
    Object.assign(model, original, patch)
    renderStudio()
    expect(imageProps().unsaved).toBe(true)
    cleanup()
  }
})

it('원작 기준 회차에는 회차 이미지 패널을 열지 않는다', () => {
  model.active = { ...model.active, inherited: true }
  renderStudio()
  expect(screen.queryByTestId('image-panel')).toBeNull()
})
