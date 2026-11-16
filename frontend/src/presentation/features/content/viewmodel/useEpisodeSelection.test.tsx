// @vitest-environment jsdom
// React Hook 조립 회귀: CI 통합 계층에서만 실행한다.
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useEpisodeViewModel } from './useEpisodeViewModel'
import type { History, Work } from '../../../../domain/entities/content'
import type { EpisodeUseCase } from '../../../../domain/usecases/EpisodeUseCase'

afterEach(cleanup)

const work = (id: string, title: string): Work => ({
  id, title, summary: '', visibility: 'private', allowFork: false, allowForkPublication: false, source: null, episodes: [],
  draft: { title: '새 회차', body: '', revision: 0 }, revision: 0,
})
const first = work('w1', '첫 작품')
const second = work('w2', '둘째 작품')
const history: History = { versions: [], proposals: [], publicationHistory: [] }

/** api 대역은 렌더 밖에서 한 번만 만든다. 열린 작품은 주소의 ?work= 값(workId)이고 바뀌면 rerender로 흉내 낸다. */
const open = (api: object, id: string | null) =>
  renderHook(({ workId }: { workId: string | null }) => useEpisodeViewModel(workId, api as unknown as EpisodeUseCase, { upload: vi.fn() }), { initialProps: { workId: id } })

it('열린 작품은 주소의 workId로 정해지고 내 작품 목록에 없으면 비어 있다', async () => {
  const api = { list: vi.fn().mockResolvedValue([first, second]) }
  const { result, rerender } = open(api, 'w1')
  expect(result.current.active).toBeNull()
  expect(result.current.ready).toBe(false)
  await act(async () => {})
  expect(result.current.ready).toBe(true)
  expect(result.current.active?.id).toBe('w1')
  rerender({ workId: 'w2' })
  expect(result.current.active?.title).toBe('둘째 작품')
  rerender({ workId: 'someone-elses' })
  expect(result.current.active).toBeNull()
  rerender({ workId: null })
  expect(result.current.active).toBeNull()
})

it('이력은 열린 작품의 것만 보이고 다른 작품으로 바뀌면 사라진다', async () => {
  const api = { list: vi.fn().mockResolvedValue([first, second]), history: vi.fn().mockResolvedValue(history) }
  const { result, rerender } = open(api, 'w1')
  await act(async () => {})
  await act(async () => { await result.current.loadHistory() })
  expect(api.history).toHaveBeenCalledWith('w1')
  expect(result.current.history).toEqual(history)
  rerender({ workId: 'w2' })
  expect(result.current.history).toBeNull()
  rerender({ workId: 'w1' })
  expect(result.current.history).toEqual(history)
})

it('분기 작품을 만들면 새 작품의 id를 돌려주고 목록에 넣는다 (화면이 그 작품의 관리 화면으로 간다)', async () => {
  const created = work('f1', '새 포크')
  const api = { list: vi.fn().mockResolvedValue([first]), fork: vi.fn().mockResolvedValue(created) }
  const { result } = open(api, 'w1')
  await act(async () => {})
  let id: string | null = null
  await act(async () => { id = await result.current.fork(2, '새 포크', '다른 선택') })
  expect(api.fork).toHaveBeenCalledWith('w1', 2, '새 포크', '다른 선택')
  expect(id).toBe('f1')
  expect(result.current.works.map((w) => w.id).sort()).toEqual(['f1', 'w1'])
  expect(result.current.notice).toBe('선택한 회차에서 비공개 분기 작품을 만들었어요.')
})

it('분기 작품 만들기에 실패하면 id 없이 서버 사유를 알린다', async () => {
  const api = { list: vi.fn().mockResolvedValue([first]), fork: vi.fn().mockRejectedValue(new Error('분기를 허용한 공개 원작에서만 시작할 수 있어요.')) }
  const { result } = open(api, 'w1')
  await act(async () => {})
  let id: string | null = 'x'
  await act(async () => { id = await result.current.fork(1, '포크', '') })
  expect(id).toBeNull()
  expect(result.current.error).toBe('분기를 허용한 공개 원작에서만 시작할 수 있어요.')
})

it('작품을 만들면 새 작품의 id를 돌려주고, 입력이 잘못되면 id 없이 오류를 알린다', async () => {
  const created = work('n1', '새 작품')
  const api = { list: vi.fn().mockResolvedValue([]), create: vi.fn().mockResolvedValueOnce(created).mockRejectedValueOnce(new Error('작품 제목을 입력해 주세요.')) }
  const { result } = open(api, null)
  await act(async () => {})
  let id: string | null = null
  await act(async () => { id = await result.current.create('새 작품', '') })
  expect(id).toBe('n1')
  expect(result.current.works.map((w) => w.id)).toEqual(['n1'])
  expect(result.current.notice).toBe('비공개 작품을 만들었어요. 첫 회차를 작성해 보세요.')
  await act(async () => { id = await result.current.create('', '') })
  expect(id).toBeNull()
  expect(result.current.error).toBe('작품 제목을 입력해 주세요.')
})
