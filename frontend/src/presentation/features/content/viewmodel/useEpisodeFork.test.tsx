// @vitest-environment jsdom
// React Hook 조립 회귀: CI 통합 계층에서만 실행한다.
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useEpisodeViewModel } from './useEpisodeViewModel'
import type { Work } from '../../../../domain/entities/content'
import type { EpisodeUseCase } from '../../../../domain/usecases/EpisodeUseCase'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

const STOP_CONFIRM = '포크 작품의 공개를 중단할까요? 발행된 회차와 원고는 보존돼요. 대기 중인 예약 발행은 취소되고, 원작이 공개를 허용하지 않으면 다시 공개할 수 없어요.'
const DELETE_CONFIRM = '「내 포크」 포크를 삭제할까요? 서재와 공개 화면에서 숨겨지고 되돌릴 수 없어요. 같은 원작에서 포크를 다시 만들 수 없어요.'
const fork: Work = {
  id: 'f1', title: '내 포크', summary: '소개', visibility: 'public', allowFork: false, allowForkPublication: false, revision: 4,
  source: { workId: 'o1', title: '원작', episode: 2, version: 7, direction: '다른 결말' }, episodes: [], draft: { title: '새 회차', body: '', revision: 4 },
}
const original: Work = { ...fork, id: 'o1', title: '원작', source: null }

/** api 대역은 렌더 밖에서 한 번만 만든다(훅이 api가 바뀌면 다시 조회한다). 열린 작품은 주소의 ?work= 값(workId)으로 정해진다. */
async function openFork(api: object, work: Work = fork) {
  const hook = renderHook(() => useEpisodeViewModel(work.id, api as unknown as EpisodeUseCase, { upload: vi.fn() }))
  await act(async () => {})
  return hook
}

it('포크 공개 중단은 확인을 거치고, 끝나면 서버의 새 작품(공개 상태·revision)으로 바꾼다', async () => {
  const stopped: Work = { ...fork, visibility: 'private', revision: 5, draft: { ...fork.draft, revision: 5 } }
  const api = { list: vi.fn().mockResolvedValueOnce([original, fork]).mockResolvedValueOnce([original, stopped]), stopForkPublication: vi.fn().mockResolvedValue(undefined) }
  const { result } = await openFork(api)
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  let ok = true
  await act(async () => { ok = await result.current.stopFork() })
  expect(confirm).toHaveBeenCalledWith(STOP_CONFIRM)
  expect(ok).toBe(false)
  expect(api.stopForkPublication).not.toHaveBeenCalled()
  confirm.mockReturnValue(true)
  await act(async () => { ok = await result.current.stopFork() })
  expect(ok).toBe(true)
  expect(api.stopForkPublication).toHaveBeenCalledWith('f1')
  expect(api.list).toHaveBeenCalledTimes(2)
  expect(result.current.active?.visibility).toBe('private')
  expect(result.current.notice).toBe('포크 공개를 중단했어요.')
  expect(result.current.works.map((w) => w.id).sort()).toEqual(['f1', 'o1'])
})

it('공개 중단 뒤 다음 저장은 서버가 올린 revision을 보낸다 (공개 중단이 revision을 올리므로 다시 읽어야 충돌하지 않는다)', async () => {
  const stopped: Work = { ...fork, visibility: 'private', revision: 5, draft: { ...fork.draft, revision: 5 } }
  const api = {
    list: vi.fn().mockResolvedValueOnce([fork]).mockResolvedValueOnce([stopped]),
    stopForkPublication: vi.fn().mockResolvedValue(undefined),
    updateWork: vi.fn().mockResolvedValue({ ...stopped, title: '새 제목', revision: 6 }),
  }
  const { result } = await openFork(api)
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  await act(async () => { await result.current.stopFork() })
  await act(async () => { await result.current.updateWork('새 제목', '소개') })
  expect(api.updateWork).toHaveBeenCalledWith('f1', '새 제목', '소개', 5, undefined, undefined)
})

it('공개 중단에 실패하면 서버 사유를 알리고 작품을 다시 읽거나 바꾸지 않는다', async () => {
  const api = { list: vi.fn().mockResolvedValue([fork]), stopForkPublication: vi.fn().mockRejectedValue(new Error('포크 작품을 찾을 수 없어요.')) }
  const { result } = await openFork(api)
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  let ok = true
  await act(async () => { ok = await result.current.stopFork() })
  expect(ok).toBe(false)
  expect(result.current.error).toBe('포크 작품을 찾을 수 없어요.')
  expect(result.current.notice).toBe('')
  expect(api.list).toHaveBeenCalledTimes(1)
  expect(result.current.active?.visibility).toBe('public')
})

it('포크 삭제는 되돌릴 수 없다는 확인을 거치고, 실패하면 성공 안내 없이 서버 사유를 알린다', async () => {
  const api = { list: vi.fn().mockResolvedValue([fork]), deleteWork: vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('작품을 찾을 수 없어요.')) }
  const { result } = await openFork(api)
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  let ok = true
  await act(async () => { ok = await result.current.deleteFork() })
  expect(confirm).toHaveBeenCalledWith(DELETE_CONFIRM)
  expect(ok).toBe(false)
  expect(api.deleteWork).not.toHaveBeenCalled()
  confirm.mockReturnValue(true)
  await act(async () => { ok = await result.current.deleteFork() })
  expect(ok).toBe(true)
  expect(api.deleteWork).toHaveBeenCalledWith('f1')
  expect(result.current.notice).toBe('포크를 삭제했어요.')
  await act(async () => { ok = await result.current.deleteFork() })
  expect(ok).toBe(false)
  expect(result.current.error).toBe('작품을 찾을 수 없어요.')
  expect(result.current.notice).toBe('')
})

it('포크가 아닌 작품에서는 확인도 요청도 하지 않는다', async () => {
  const api = { list: vi.fn().mockResolvedValue([original]), stopForkPublication: vi.fn(), deleteWork: vi.fn() }
  const { result } = await openFork(api, original)
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
  await act(async () => { await result.current.stopFork() })
  await act(async () => { await result.current.deleteFork() })
  expect(confirm).not.toHaveBeenCalled()
  expect(api.stopForkPublication).not.toHaveBeenCalled()
  expect(api.deleteWork).not.toHaveBeenCalled()
})
