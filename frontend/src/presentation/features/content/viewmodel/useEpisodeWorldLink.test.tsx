// @vitest-environment jsdom
// React Hook 조립 회귀: CI 통합 계층에서만 실행한다.
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useEpisodeViewModel } from './useEpisodeViewModel'
import type { Work } from '../../../../domain/entities/content'
import type { EpisodeUseCase } from '../../../../domain/usecases/EpisodeUseCase'
import type { WorldStudioUseCase } from '../../../../domain/usecases/WorldStudioUseCase'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

const work: Work = {
  id: 'w1', title: '작품', summary: '', visibility: 'private', allowFork: false, allowForkPublication: false, source: null,
  episodes: [], draft: { title: '새 회차', body: '', revision: 4 }, revision: 4,
}
const WORLD = '0b0f6f0e-3a51-4d6b-9a39-1f4f2b6d0a01'

/** api 대역은 렌더 밖에서 한 번만 만든다(훅이 api가 바뀌면 다시 조회한다). 초안 목록 조회는 이 테스트의 관심사가 아니라 빈 목록을 기본으로 둔다. */
async function open(api: object, worlds: object = { setPublication: vi.fn() }) {
  const useCase = { writingList: vi.fn().mockResolvedValue([]), ...api }
  const hook = renderHook(() => useEpisodeViewModel('w1', useCase as unknown as EpisodeUseCase, { upload: vi.fn() }, worlds as Pick<WorldStudioUseCase, 'setPublication'>))
  await act(async () => {})
  return hook.result
}

it('세계관을 연결하면 서버가 돌려준 연결로 열린 작품을 바꾸고 작품 revision은 그대로 둔다', async () => {
  const api = { list: vi.fn().mockResolvedValue([work]), linkWorldStudio: vi.fn().mockResolvedValue({ workId: 'w1', worldId: WORLD }) }
  const result = await open(api)
  let ok = false
  await act(async () => { ok = await result.current.linkWorld(WORLD) })
  expect(ok).toBe(true)
  expect(api.linkWorldStudio).toHaveBeenCalledWith('w1', WORLD)
  expect(result.current.active).toEqual({ ...work, worldStudioId: WORLD })
  expect(result.current.notice).toBe('세계관을 연결했어요.')
})

it('연결 해제는 확인을 받은 뒤에만 보내고 끝나면 미연결로 바꾼다', async () => {
  const api = { list: vi.fn().mockResolvedValue([{ ...work, worldStudioId: WORLD }]), linkWorldStudio: vi.fn().mockResolvedValue({ workId: 'w1', worldId: null }) }
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  const result = await open(api)
  let ok = true
  await act(async () => { ok = await result.current.linkWorld(null) })
  expect(ok).toBe(false)
  expect(confirm.mock.calls[0][0]).toContain('독자 설정 위키')
  expect(api.linkWorldStudio).not.toHaveBeenCalled()
  expect(result.current.active?.worldStudioId).toBe(WORLD)
  confirm.mockReturnValue(true)
  await act(async () => { ok = await result.current.linkWorld(null) })
  expect(ok).toBe(true)
  expect(api.linkWorldStudio).toHaveBeenCalledWith('w1', null)
  expect(result.current.active?.worldStudioId).toBeNull()
  expect(result.current.notice).toBe('세계관 연결을 해제했어요.')
})

/** 공개 세계관의 해제(결정 4): 경고 대화 상자가 확인을 받아 release를 넘긴다. */
const published = () => ({ list: vi.fn().mockResolvedValue([{ ...work, worldStudioId: WORLD }]), linkWorldStudio: vi.fn().mockResolvedValue({ workId: 'w1', worldId: null }) })

it('비공개 전환이 실패하면 작품을 삭제하지 않고 서버 사유를 알린다', async () => {
  const api = { ...published(), deleteWork: vi.fn() }
  const worlds = { setPublication: vi.fn().mockRejectedValue(new Error('세계관 공개 설정을 저장하지 못했어요.')) }
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
  const result = await open(api, worlds)
  await act(async () => {
    expect(await result.current.deleteWork({ makePrivate: { genre: 'fantasy' } })).toBe(false)
  })
  expect(confirm).not.toHaveBeenCalled()
  expect(worlds.setPublication).toHaveBeenCalledWith(WORLD, { visibility: 'private', genre: 'fantasy' }, expect.any(AbortSignal))
  expect(api.deleteWork).not.toHaveBeenCalled()
  expect(api.linkWorldStudio).not.toHaveBeenCalled()
  expect(result.current.error).toBe('세계관 공개 설정을 저장하지 못했어요.')
})

it('비공개 전환이 끝난 뒤 삭제하고, 삭제 실패 시 비공개 전환 결과와 삭제 오류를 함께 알린다', async () => {
  const api = { ...published(), deleteWork: vi.fn().mockRejectedValue(new Error('작품 삭제 요청이 실패했어요.')) }
  const worlds = { setPublication: vi.fn().mockResolvedValue({}) }
  const result = await open(api, worlds)
  await act(async () => {
    expect(await result.current.deleteWork({ makePrivate: { genre: null } })).toBe(false)
  })
  expect(worlds.setPublication).toHaveBeenCalledWith(WORLD, { visibility: 'private', genre: null }, expect.any(AbortSignal))
  expect(worlds.setPublication.mock.invocationCallOrder[0]).toBeLessThan(api.deleteWork.mock.invocationCallOrder[0])
  expect(api.linkWorldStudio).not.toHaveBeenCalled()
  expect(result.current.error).toBe('세계관은 비공개로 바뀌었지만 작품을 삭제하지 못했어요. 작품 삭제 요청이 실패했어요.')
})

it('비공개 전환이 성공하면 이어서 작품을 삭제하고 true를 돌려주며, 확인을 다시 묻지 않는다', async () => {
  const api = { ...published(), deleteWork: vi.fn().mockResolvedValue(undefined) }
  const worlds = { setPublication: vi.fn().mockResolvedValue({}) }
  const confirm = vi.spyOn(window, 'confirm')
  const result = await open(api, worlds)
  let ok = false
  await act(async () => { ok = await result.current.deleteWork({ makePrivate: { genre: 'fantasy' } }) })
  expect(ok).toBe(true)
  expect(confirm).not.toHaveBeenCalled()
  expect(api.deleteWork).toHaveBeenCalledWith('w1', expect.any(AbortSignal))
  expect(worlds.setPublication.mock.invocationCallOrder[0]).toBeLessThan(api.deleteWork.mock.invocationCallOrder[0])
})

it('공개 세계관을 비공개로 바꾸고 해제하면 공개 설정(장르는 현재 값 그대로)을 먼저 보내고 성공한 뒤에 해제하며, 확인을 다시 묻지 않는다', async () => {
  const api = published()
  const worlds = { setPublication: vi.fn().mockResolvedValue({}) }
  const confirm = vi.spyOn(window, 'confirm')
  const result = await open(api, worlds)
  let ok = false
  await act(async () => { ok = await result.current.linkWorld(null, { makePrivate: { genre: 'fantasy' } }) })
  expect(ok).toBe(true)
  expect(confirm).not.toHaveBeenCalled()
  expect(worlds.setPublication).toHaveBeenCalledWith(WORLD, { visibility: 'private', genre: 'fantasy' }, expect.any(AbortSignal)) // 두 요청 모두 화면을 떠나면 취소되도록 취소 신호를 받는다
  expect(api.linkWorldStudio).toHaveBeenCalledWith('w1', null, expect.any(AbortSignal))
  expect(worlds.setPublication.mock.invocationCallOrder[0]).toBeLessThan(api.linkWorldStudio.mock.invocationCallOrder[0])
  expect(result.current.active?.worldStudioId).toBeNull()
  expect(result.current.notice).toBe('세계관을 비공개로 바꾸고 연결을 해제했어요.')
})

it('비공개로 바꾸는 사이 화면을 떠나면(언마운트) 그 요청을 취소하고, 비공개 응답이 와도 해제를 보내지 않는다', async () => {
  const api = published()
  let respond!: (value: object) => void
  const worlds = { setPublication: vi.fn((..._args: unknown[]) => new Promise<object>((resolve) => { respond = resolve })) }
  const useCase = { writingList: vi.fn().mockResolvedValue([]), ...api }
  const hook = renderHook(() => useEpisodeViewModel('w1', useCase as unknown as EpisodeUseCase, { upload: vi.fn() }, worlds as unknown as Pick<WorldStudioUseCase, 'setPublication'>))
  await act(async () => {})
  let request!: Promise<boolean>
  act(() => { request = hook.result.current.linkWorld(null, { makePrivate: { genre: null } }) })
  await waitFor(() => expect(worlds.setPublication).toHaveBeenCalled())
  const signal = worlds.setPublication.mock.calls[0][2] as AbortSignal
  expect(signal.aborted).toBe(false)
  hook.unmount()
  expect(signal.aborted).toBe(true) // 화면을 떠나면 비공개 요청도 취소된다
  await act(async () => { respond({}); await request })
  expect(api.linkWorldStudio).not.toHaveBeenCalled() // 저장소가 취소를 몰라 응답을 줘도 해제는 보내지 않는다
})

it('비공개로 바꾸지 못하면 해제하지 않고 서버 사유를 연결 카드에 알린다', async () => {
  const api = published()
  const worlds = { setPublication: vi.fn().mockRejectedValue(new Error('세계관 공개 설정을 저장하지 못했어요.')) }
  const result = await open(api, worlds)
  let ok = true
  await act(async () => { ok = await result.current.linkWorld(null, { makePrivate: { genre: null } }) })
  expect(ok).toBe(false)
  expect(api.linkWorldStudio).not.toHaveBeenCalled()
  expect(result.current.error).toBe('세계관 공개 설정을 저장하지 못했어요.')
  expect(result.current.origin).toBe('link')
  expect(result.current.active?.worldStudioId).toBe(WORLD)
  expect(result.current.notice).toBe('')
})

it('공개 그대로 해제는 확인을 다시 묻지 않고 공개 설정은 건드리지 않은 채 해제만 보낸다', async () => {
  const api = published()
  const worlds = { setPublication: vi.fn() }
  const confirm = vi.spyOn(window, 'confirm')
  const result = await open(api, worlds)
  let ok = false
  await act(async () => { ok = await result.current.linkWorld(null, {}) })
  expect(ok).toBe(true)
  expect(confirm).not.toHaveBeenCalled()
  expect(worlds.setPublication).not.toHaveBeenCalled()
  expect(api.linkWorldStudio).toHaveBeenCalledWith('w1', null)
  expect(result.current.notice).toBe('세계관 연결을 해제했어요.')
})

it('연결에 실패하면 서버 사유를 오류로 알리고 연결을 바꾸지 않는다 (성공 안내를 남기지 않는다)', async () => {
  const api = { list: vi.fn().mockResolvedValue([work]), linkWorldStudio: vi.fn().mockRejectedValue(new Error('이미 다른 소설에 연결된 세계관이에요.')) }
  const result = await open(api)
  let ok = true
  await act(async () => { ok = await result.current.linkWorld(WORLD) })
  expect(ok).toBe(false)
  expect(result.current.error).toBe('이미 다른 소설에 연결된 세계관이에요.')
  expect(result.current.active?.worldStudioId).toBeUndefined()
  expect(result.current.notice).toBe('')
})

it('세계관 연결의 결과는 그 카드에서 보이도록 요청한 자리를 link로 알리고, 다른 요청이 시작되면 비운다', async () => {
  const api = { list: vi.fn().mockResolvedValue([work]), linkWorldStudio: vi.fn().mockRejectedValue(new Error('이미 다른 소설에 연결된 세계관이에요.')) }
  const result = await open(api)
  expect(result.current.origin).toBe('')
  await act(async () => { await result.current.linkWorld(WORLD) })
  expect(result.current.error).toBe('이미 다른 소설에 연결된 세계관이에요.')
  expect(result.current.origin).toBe('link')
  await act(async () => { await result.current.reload() })
  expect(result.current.origin).toBe('')
})

// ── Fork 세계관 독립(#583): 이어받는 원작 세계관을 내 세계관으로 독립시킨다 ──

const fork: Work = { ...work, source: { workId: 'o', title: '원작', episode: 2, version: 1, direction: '' } }

it('독립은 확인을 받은 뒤에만 보내고, 서버가 만든 세계관으로 연결을 바꾸며 그 id를 돌려준다(이동하므로 성공 안내는 두지 않는다)', async () => {
  const api = { list: vi.fn().mockResolvedValue([fork]), detachInheritedWorld: vi.fn().mockResolvedValue({ workId: 'w1', worldId: WORLD }) }
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  const result = await open(api)
  let id: string | null = 'x'
  await act(async () => { id = await result.current.detachWorld() })
  expect(id).toBeNull()
  expect(confirm.mock.calls[0][0]).toContain('독립하면 원작 세계관의 이후 변경은 따라오지 않아요')
  expect(api.detachInheritedWorld).not.toHaveBeenCalled()
  confirm.mockReturnValue(true)
  await act(async () => { id = await result.current.detachWorld() })
  expect(id).toBe(WORLD)
  expect(api.detachInheritedWorld).toHaveBeenCalledWith('w1')
  expect(result.current.active).toEqual({ ...fork, worldStudioId: WORLD })
  expect(result.current.origin).toBe('detach')
  expect(result.current.notice).toBe('')
})

it('독립에 실패하면 서버 사유를 그 카드에서 보이도록 오류로 알리고 연결을 바꾸지 않는다', async () => {
  const api = { list: vi.fn().mockResolvedValue([fork]), detachInheritedWorld: vi.fn().mockRejectedValue(new Error('이어받는 원작 세계관이 없어요.')) }
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  const result = await open(api)
  let id: string | null = 'x'
  await act(async () => { id = await result.current.detachWorld() })
  expect(id).toBeNull()
  expect(result.current.error).toBe('이어받는 원작 세계관이 없어요.')
  expect(result.current.origin).toBe('detach')
  expect(result.current.active?.worldStudioId).toBeUndefined()
})

it('독립 요청 중에 다시 누르면 확인도 다시 묻지 않고 요청도 한 번만 보낸다', async () => {
  let finish!: (value: { workId: string; worldId: string }) => void
  const api = { list: vi.fn().mockResolvedValue([fork]), detachInheritedWorld: vi.fn(() => new Promise<{ workId: string; worldId: string }>((resolve) => { finish = resolve })) }
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
  const result = await open(api)
  let first!: Promise<string | null>
  let second: string | null = 'x'
  await act(async () => { first = result.current.detachWorld() })
  await act(async () => { second = await result.current.detachWorld() })
  expect(second).toBeNull()
  expect(confirm).toHaveBeenCalledTimes(1)
  expect(api.detachInheritedWorld).toHaveBeenCalledTimes(1)
  expect(result.current.busy).toBe(true)
  await act(async () => { finish({ workId: 'w1', worldId: WORLD }); await first })
  expect(result.current.busy).toBe(false)
})
