// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createAppStore } from '../../../../app/store'
import { createFixtureDb } from '../../../../data/mock/fixtureDb'
import { InMemoryWorkRepository } from '../../../../data/mock/InMemoryRepositories'
import { InMemoryStoryPlanRepository } from '../../../../data/plans/InMemoryStoryPlanRepository'
import { StoryPlanUseCase } from '../../../../domain/usecases/StoryPlanUseCase'
import { StoryPlanWorkspace } from './StoryPlanWorkspace'

afterEach(() => { cleanup(); vi.restoreAllMocks() })
function setup() {
  const db = createFixtureDb()
  const work = db.works.find(w => w.id === 'starlight')!
  work.owner = 'me'
  const api = new StoryPlanUseCase(new InMemoryStoryPlanRepository(new InMemoryWorkRepository(db)))
  render(<Provider store={createAppStore({ role: 'user' })}><MemoryRouter><StoryPlanWorkspace workId={work.id} demo api={api} /></MemoryRouter></Provider>)
  return { api, work }
}

async function setupDeletion(sceneCount = 1, demo = true) {
  const db = createFixtureDb()
  const work = db.works.find(w => w.id === 'starlight')!
  work.owner = 'me'
  const api = new StoryPlanUseCase(new InMemoryStoryPlanRepository(new InMemoryWorkRepository(db)))
  const input = { kind: 'plot' as const, parentId: null, title: '삭제 검증 플롯', content: '', episodeNumber: null, characterIds: [], placeIds: [] }
  const plot = await api.save(work.id, input)
  const scenes = []
  for (let i = 0; i < sceneCount; i++) scenes.push(await api.save(work.id, { ...input, kind: 'scene', parentId: plot.id, title: `장면 ${i + 1}` }))
  render(<Provider store={createAppStore({ role: 'user' })}><MemoryRouter><StoryPlanWorkspace workId={work.id} demo={demo} api={api} /></MemoryRouter></Provider>)
  await waitFor(() => expect(screen.getByRole('button', { name: '플롯 삭제' })).toHaveProperty('disabled', false))
  return { api, work, plot, scenes }
}

function askSceneDelete(index = 0) {
  const opener = screen.getAllByRole('button', { name: '장면 계획 삭제' })[index]
  opener.focus()
  fireEvent.click(opener)
  return { opener, dialog: within(screen.getByRole('dialog', { name: '계획 삭제 확인' })) }
}

describe('계획 화면 · CI 통합', () => {
  it.each([true, false])('demo=%s에서 삭제 충돌 후 최신 내용을 재확인하고 명시적으로 다시 삭제한다', async demo => {
    const { api, work, scenes } = await setupDeletion(1, demo)
    const fresh = await api.save(work.id, { ...scenes[0], title: '다른 탭의 제목', content: '삭제 전 확인할 최신 내용' }, scenes[0])
    const remove = vi.spyOn(api, 'remove')
    const { opener, dialog } = askSceneDelete()
    fireEvent.click(dialog.getByRole('button', { name: '삭제' }))
    await waitFor(() => expect(dialog.getByRole('button', { name: '삭제' })).toHaveProperty('disabled', true))
    expect(await dialog.findByRole('alert')).toBeTruthy()
    fireEvent.click(dialog.getByRole('button', { name: '취소' }))
    await waitFor(() => expect(document.activeElement).toBe(opener))
    const reopened = askSceneDelete().dialog
    expect(reopened.getByRole('button', { name: '삭제' })).toHaveProperty('disabled', true)
    fireEvent.click(reopened.getByRole('button', { name: '최신 목록 확인' }))
    await reopened.findByText('다른 탭의 제목')
    expect(reopened.getByText('삭제 전 확인할 최신 내용')).toBeTruthy()
    expect(remove).toHaveBeenCalledTimes(1)
    expect(await api.read(work.id, fresh.id)).toEqual(fresh)
    await waitFor(() => expect(reopened.getByRole('button', { name: '삭제' })).toHaveProperty('disabled', false))
    fireEvent.click(reopened.getByRole('button', { name: '삭제' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(remove).toHaveBeenLastCalledWith(work.id, fresh, expect.any(AbortSignal))
    expect(await api.list(work.id)).toHaveLength(1)
  })

  it('다른 탭에서 이미 삭제된 대상은 재조회 후 닫고 추가 버튼으로 포커스를 복구한다', async () => {
    const { api, work, scenes } = await setupDeletion()
    await api.remove(work.id, scenes[0])
    const remove = vi.spyOn(api, 'remove')
    const { dialog } = askSceneDelete()
    fireEvent.click(dialog.getByRole('button', { name: '삭제' }))
    await dialog.findByRole('alert')
    fireEvent.click(dialog.getByRole('button', { name: '최신 목록 확인' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(await screen.findByText('최신 목록에서 해당 계획을 찾을 수 없어요.')).toBeTruthy()
    expect(remove).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: '장면 계획 추가' })))
  })

  it('최신 목록 조회 실패를 삭제로 처리하지 않고 재시도와 중복 요청 차단을 유지한다', async () => {
    const { api, work, scenes } = await setupDeletion()
    await api.save(work.id, { ...scenes[0], title: '최신 장면' }, scenes[0])
    const remove = vi.spyOn(api, 'remove')
    const { dialog } = askSceneDelete()
    fireEvent.click(dialog.getByRole('button', { name: '삭제' }))
    await dialog.findByRole('alert')
    const failedReview = vi.spyOn(api, 'reviewDeletion').mockRejectedValueOnce(new Error('최신 목록 조회 실패'))
    fireEvent.click(dialog.getByRole('button', { name: '최신 목록 확인' }))
    expect(await dialog.findByText('최신 목록 조회 실패')).toBeTruthy()
    expect(dialog.getByRole('button', { name: '삭제' })).toHaveProperty('disabled', true)
    expect(failedReview).toHaveBeenCalledTimes(1)
    failedReview.mockRestore()
    const reviewed = await api.reviewDeletion(work.id, scenes[0].id)
    let finish!: (value: typeof reviewed) => void
    const review = vi.spyOn(api, 'reviewDeletion').mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    fireEvent.click(dialog.getByRole('button', { name: '최신 목록 확인' }))
    fireEvent.click(dialog.getByRole('button', { name: '최신 목록 확인' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(review).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(remove).toHaveBeenCalledTimes(1)
    await act(async () => finish(reviewed))
    expect(dialog.getByText('최신 장면')).toBeTruthy()
    expect(dialog.getByRole('button', { name: '삭제' })).toHaveProperty('disabled', false)
    expect(remove).toHaveBeenCalledTimes(1)
  })

  it.each([
    { count: 3, index: 1, next: '장면 3' },
    { count: 3, index: 2, next: '장면 2' },
    { count: 1, index: 0, next: '장면 계획 추가' },
  ])('장면 $index 삭제 후 $next에 키보드 포커스를 둔다', async ({ count, index, next }) => {
    await setupDeletion(count)
    fireEvent.click(askSceneDelete(index).dialog.getByRole('button', { name: '삭제' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: new RegExp(next) })))
  })

  it('마지막 플롯 삭제 후 플롯 추가로 복귀하고 취소 시에는 원래 버튼으로 복귀한다', async () => {
    await setupDeletion(0)
    const opener = screen.getByRole('button', { name: '플롯 삭제' })
    opener.focus()
    fireEvent.click(opener)
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '취소' }))
    await waitFor(() => expect(document.activeElement).toBe(opener))
    fireEvent.click(opener)
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '삭제' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: '플롯 추가' })))
  })

  it('삭제 응답을 기다리는 동안 사용자가 옮긴 유효한 포커스를 빼앗지 않는다', async () => {
    const { api } = await setupDeletion()
    let finish!: () => void
    vi.spyOn(api, 'remove').mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    fireEvent.click(askSceneDelete().dialog.getByRole('button', { name: '삭제' }))
    const outside = document.createElement('button')
    document.body.append(outside)
    try {
      outside.focus()
      await act(async () => finish())
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(document.activeElement).toBe(outside)
    } finally { outside.remove() }
  })

  it('장면마다 있는 삭제 버튼은 이름은 같게 두고 어느 장면인지 설명으로 이어 구분한다', async () => {
    await setupDeletion(2)
    const buttons = screen.getAllByRole('button', { name: '장면 계획 삭제' })
    expect(buttons.map(button => document.getElementById(button.getAttribute('aria-describedby') ?? '')?.textContent)).toEqual(['장면 1', '장면 2'])
  })

  it('오류는 작품 관리 화면과 같은 공용 오류 상자로 알린다', async () => {
    const { api } = await setupDeletion()
    vi.spyOn(api, 'remove').mockRejectedValueOnce(new Error('삭제 충돌'))
    const { dialog } = askSceneDelete()
    fireEvent.click(dialog.getByRole('button', { name: '삭제' }))
    expect((await dialog.findByRole('alert')).className).toContain('ep-alert')
  })

  it('본문 입력 이름과 글자 수 안내를 분리한다', async () => {
    setup()
    await waitFor(() => expect(screen.getByRole('button', { name: '플롯 추가' })).toHaveProperty('disabled', false))
    fireEvent.click(screen.getByRole('button', { name: '플롯 추가' }))
    expect(screen.getByRole('textbox', { name: '계획 내용' })).toBeTruthy()
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
