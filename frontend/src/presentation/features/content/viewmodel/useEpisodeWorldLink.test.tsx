// @vitest-environment jsdom
// React Hook 조립 회귀: CI 통합 계층에서만 실행한다.
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useEpisodeViewModel } from './useEpisodeViewModel'
import type { Work } from '../../../../domain/entities/content'
import type { EpisodeUseCase } from '../../../../domain/usecases/EpisodeUseCase'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

const work: Work = {
  id: 'w1', title: '작품', summary: '', visibility: 'private', allowFork: false, allowForkPublication: false, source: null,
  episodes: [], draft: { title: '새 회차', body: '', revision: 4 }, revision: 4,
}
const WORLD = '0b0f6f0e-3a51-4d6b-9a39-1f4f2b6d0a01'

/** api 대역은 렌더 밖에서 한 번만 만든다(훅이 api가 바뀌면 다시 조회한다). */
async function open(api: object) {
  const hook = renderHook(() => useEpisodeViewModel('w1', api as unknown as EpisodeUseCase, { upload: vi.fn() }))
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
