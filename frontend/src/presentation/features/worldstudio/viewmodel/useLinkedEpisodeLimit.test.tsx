// @vitest-environment jsdom
// React Hook 조립 회귀: CI 통합 계층에서만 실행한다.
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { appContainer } from '../../../../app/appContainer'
import type { WritingEpisode } from '../../../../domain/entities/content'
import { useLinkedEpisodeLimit } from './useLinkedEpisodeLimit'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

const episodeRow = (number: number): WritingEpisode => ({ number, draft: { title: '', body: '', revision: 0 }, versions: [], publishedVersionId: null, inherited: false, updatedAt: null, checkpointStatus: 'none', checkpoints: [] })
const episodes = (...numbers: number[]) => numbers.map(episodeRow)
const spy = () => vi.spyOn(appContainer.resolve('episodeUseCase'), 'writingList')
type Props = { id: string | null; reload?: number }
const limitOf = (initial: string | null) => renderHook(({ id, reload }: Props) => useLinkedEpisodeLimit(id, reload), { initialProps: { id: initial } as Props })

it('연결된 소설의 마지막 회차 번호(목록에서 가장 큰 번호, 회차가 없으면 0)를 읽고, 연결이 없거나 읽는 중이면 undefined다', async () => {
  const list = spy().mockResolvedValueOnce(episodes(2, 5, 1)).mockResolvedValueOnce([])
  const hook = limitOf(null)
  expect(hook.result.current).toBeUndefined() // 연결이 없으면 읽지도 않는다
  expect(list).not.toHaveBeenCalled()
  hook.rerender({ id: 'w1' })
  expect(hook.result.current).toBeUndefined() // 읽는 중
  await waitFor(() => expect(hook.result.current).toBe(5))
  hook.rerender({ id: 'w2' })
  await waitFor(() => expect(hook.result.current).toBe(0)) // 회차가 없는 소설
})

it('읽지 못하면 undefined로 둔다(상한 검사도 표시 문구도 만들지 않는다)', async () => {
  const list = spy().mockRejectedValue(new Error('offline'))
  const hook = limitOf('w1')
  await waitFor(() => expect(list).toHaveBeenCalled())
  await act(async () => {})
  expect(hook.result.current).toBeUndefined()
})

it('연결을 풀었다 같은 소설을 다시 연결하면 옛 상한을 돌려주지 않고 이번 조회가 성공한 값만 쓴다', async () => {
  const list = spy().mockResolvedValueOnce(episodes(1, 2, 3))
  const hook = limitOf('w1')
  await waitFor(() => expect(hook.result.current).toBe(3))
  hook.rerender({ id: null })
  expect(hook.result.current).toBeUndefined() // 연결이 풀리면 값이 없다
  let finish!: (rows: WritingEpisode[]) => void
  list.mockImplementationOnce(() => new Promise<WritingEpisode[]>((resolve) => { finish = resolve }))
  hook.rerender({ id: 'w1' })
  expect(hook.result.current).toBeUndefined() // 다시 읽는 동안 옛 3을 돌려주지 않는다
  await waitFor(() => expect(list).toHaveBeenCalledTimes(2))
  await act(async () => { finish(episodes(1, 2, 3, 4, 5)) })
  await waitFor(() => expect(hook.result.current).toBe(5))
})

it('호출자가 세계관을 다시 읽어 알리면(reload가 오르면) 같은 소설이어도 회차 수를 다시 읽어 바뀐 마지막 회차를 쓰고, 같은 신호로는 다시 읽지 않는다', async () => {
  const list = spy().mockResolvedValueOnce(episodes(1, 2, 3))
  const hook = limitOf('w1')
  await waitFor(() => expect(hook.result.current).toBe(3))
  let finish!: (rows: WritingEpisode[]) => void
  list.mockImplementationOnce(() => new Promise<WritingEpisode[]>((resolve) => { finish = resolve }))
  hook.rerender({ id: 'w1', reload: 1 })
  await waitFor(() => expect(list).toHaveBeenCalledTimes(2)) // 그 사이 소설에 회차가 늘었을 수 있다
  expect(hook.result.current).toBeUndefined() // 다시 읽는 동안 옛 3을 돌려주지 않는다
  await act(async () => { finish(episodes(1, 2, 3, 4)) })
  await waitFor(() => expect(hook.result.current).toBe(4))
  hook.rerender({ id: 'w1', reload: 1 })
  await act(async () => {})
  expect(list).toHaveBeenCalledTimes(2)
})
