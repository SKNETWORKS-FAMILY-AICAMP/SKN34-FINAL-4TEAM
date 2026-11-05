// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAppStore } from '../../../../app/store'
import { createMockDb, InMemoryWorkRepository } from '../../../../data/mock/InMemoryRepositories'
import { InMemoryStoryPlanRepository } from '../../../../data/plans/InMemoryStoryPlanRepository'
import { StoryPlanUseCase } from '../../../../domain/usecases/StoryPlanUseCase'
import { StoryPlanWorkspace } from './StoryPlanWorkspace'

afterEach(() => { cleanup(); vi.restoreAllMocks() })
function setup() {
  const db = createMockDb()
  const work = db.works.find(w => w.id === 'starlight')!
  work.owner = 'me'
  const api = new StoryPlanUseCase(new InMemoryStoryPlanRepository(new InMemoryWorkRepository(db)))
  render(<Provider store={createAppStore({ role: 'user' })}><MemoryRouter><StoryPlanWorkspace workId={work.id} demo api={api} /></MemoryRouter></Provider>)
  return { api, work }
}
describe('계획 화면 · CI 통합', () => {
  it('본문 입력 이름과 글자 수 안내를 분리한다', async () => {
    setup()
    await waitFor(() => expect(screen.getByRole('button', { name: '플롯 추가' })).toHaveProperty('disabled', false))
    fireEvent.click(screen.getByRole('button', { name: '플롯 추가' }))
    expect(screen.getByRole('textbox', { name: '계획 내용', exact: true })).toBeTruthy()
  })
  it('플롯과 구조화된 장면을 저장하고 상세 조회·수정·삭제한다', async () => {
    const { api, work } = setup()
    await waitFor(() => expect(screen.getByRole('button', { name: '플롯 추가' })).toHaveProperty('disabled', false))
    fireEvent.click(screen.getByRole('button', { name: '플롯 추가' }))
    fireEvent.change(screen.getByLabelText('플롯 제목'), { target: { value: '귀환 계획' } })
    fireEvent.click(screen.getByRole('button', { name: '저장' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByRole('heading', { name: '귀환 계획' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '장면 계획 추가' }))
    fireEvent.change(screen.getByLabelText('장면 제목'), { target: { value: '탑에 도착하다' } })
    fireEvent.click(screen.getByLabelText('리안'))
    fireEvent.click(screen.getByLabelText('별빛 탑'))
    fireEvent.click(screen.getByRole('button', { name: '저장' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: /탑에 도착하다/ }))
    const dialog = await screen.findByRole('dialog', { name: '장면 계획 수정' })
    expect(within(dialog).getByLabelText('리안')).toHaveProperty('checked', true)
    fireEvent.change(within(dialog).getByLabelText('장면 제목'), { target: { value: '다시 도착하다' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '저장' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: '장면 계획 삭제' }))
    fireEvent.click(within(await screen.findByRole('dialog', { name: '계획 삭제 확인' })).getByRole('button', { name: '삭제' }))
    await waitFor(async () => expect((await api.list(work.id)).filter(p => p.kind === 'scene')).toHaveLength(0))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: '플롯 삭제' }))
    fireEvent.click(within(await screen.findByRole('dialog', { name: '계획 삭제 확인' })).getByRole('button', { name: '삭제' }))
    await waitFor(async () => expect(await api.list(work.id)).toEqual([]))
  })
  it('미저장 닫기 거부와 저장 실패 시 입력을 보존한다', async () => {
    const { api } = setup()
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    vi.spyOn(api, 'save').mockRejectedValue(new Error('저장 충돌'))
    await waitFor(() => expect(screen.getByRole('button', { name: '플롯 추가' })).toHaveProperty('disabled', false))
    fireEvent.click(screen.getByRole('button', { name: '플롯 추가' }))
    fireEvent.change(screen.getByLabelText('플롯 제목'), { target: { value: '보존할 입력' } })
    fireEvent.click(screen.getByRole('button', { name: '취소' }))
    expect(screen.getByLabelText('플롯 제목')).toHaveProperty('value', '보존할 입력')
    fireEvent.click(screen.getByRole('button', { name: '저장' }))
    expect(await screen.findByText('저장 충돌')).toBeTruthy()
    expect(screen.getByLabelText('플롯 제목')).toHaveProperty('value', '보존할 입력')
  })

  it('미저장 상태에서 거절한 뒤로가기를 복구한다', async () => {
    const previous = window.history.state
    window.history.replaceState({ idx: 4 }, '')
    try {
      setup()
      const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
      const go = vi.spyOn(window.history, 'go').mockImplementation(() => {})
      await waitFor(() => expect(screen.getByRole('button', { name: '플롯 추가' })).toHaveProperty('disabled', false))
      fireEvent.click(screen.getByRole('button', { name: '플롯 추가' }))
      fireEvent.change(screen.getByLabelText('플롯 제목'), { target: { value: '미저장 계획' } })
      fireEvent.popState(window, { state: { idx: 3 } })
      expect(confirm).toHaveBeenCalled()
      expect(go).toHaveBeenCalledWith(1)
      expect(screen.getByLabelText('플롯 제목')).toHaveProperty('value', '미저장 계획')
    } finally { window.history.replaceState(previous, '') }
  })
})
