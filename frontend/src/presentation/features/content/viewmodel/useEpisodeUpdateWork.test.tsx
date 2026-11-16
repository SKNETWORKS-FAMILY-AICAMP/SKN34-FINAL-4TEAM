// @vitest-environment jsdom
// React Hook 조립 회귀: CI 통합 계층에서만 실행한다.
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useEpisodeViewModel } from './useEpisodeViewModel'
import type { History, Work } from '../../../../domain/entities/content'
import type { EpisodeUseCase } from '../../../../domain/usecases/EpisodeUseCase'

afterEach(cleanup)

const work: Work = {
  id: 'w1', title: '옛 제목', summary: '옛 소개', visibility: 'private', allowFork: false, allowForkPublication: false, source: null,
  episodes: [], draft: { title: '새 회차', body: '', revision: 4 }, revision: 4,
}

/** api 대역은 렌더 밖에서 한 번만 만든다(훅이 api가 바뀌면 다시 조회한다). 열린 작품은 주소의 ?work= 값(workId)으로 정해진다. */
function open(api: object) {
  return renderHook(() => useEpisodeViewModel('w1', api as unknown as EpisodeUseCase, { upload: vi.fn() }))
}

it('작품 정보를 저장하면 현재 revision으로 서버에 수정하고 갱신된 작품을 보인다', async () => {
  const saved: Work = { ...work, title: '새 제목', summary: '새 소개', revision: 5, draft: { ...work.draft, revision: 5 } }
  const api = { list: vi.fn().mockResolvedValue([work]), updateWork: vi.fn().mockResolvedValue(saved) }
  const { result } = open(api)
  await act(async () => {})
  let ok = false
  await act(async () => { ok = await result.current.updateWork('새 제목', '새 소개') })
  expect(ok).toBe(true)
  // 장르·해시태그를 바꾸지 않았으면 서버에 보내지 않는다(생략 = 유지).
  expect(api.updateWork).toHaveBeenCalledWith('w1', '새 제목', '새 소개', 4, undefined, undefined)
  expect(result.current.active?.title).toBe('새 제목')
  expect(result.current.works.map((w) => w.title)).toEqual(['새 제목'])
  expect(result.current.notice).toBe('작품 정보를 저장했어요.')
  expect(result.current.error).toBe('')
})

it('저장에 실패하면 서버 사유를 오류로 알리고 기존 작품을 그대로 둔다 (성공 안내를 남기지 않는다)', async () => {
  const api = {
    list: vi.fn().mockResolvedValue([work]),
    updateWork: vi.fn().mockRejectedValue(new Error('원고가 변경됐어요. 최신 데이터를 불러와 주세요.')),
  }
  const { result } = open(api)
  await act(async () => {})
  let ok = true
  await act(async () => { ok = await result.current.updateWork('새 제목', '새 소개') })
  expect(ok).toBe(false)
  expect(result.current.error).toBe('원고가 변경됐어요. 최신 데이터를 불러와 주세요.')
  expect(result.current.active?.title).toBe('옛 제목')
  expect(result.current.notice).toBe('')
})

it('연속으로 저장하면 서버가 돌려준 새 revision으로 수정한다 (오래된 revision으로 충돌하지 않는다)', async () => {
  const first: Work = { ...work, title: '첫 수정', revision: 5, draft: { ...work.draft, revision: 5 } }
  const second: Work = { ...first, title: '둘째 수정', revision: 6, draft: { ...first.draft, revision: 6 } }
  const api = {
    list: vi.fn().mockResolvedValue([work]),
    updateWork: vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second),
  }
  const { result } = open(api)
  await act(async () => {})
  await act(async () => { await result.current.updateWork('첫 수정', '옛 소개') })
  await act(async () => { await result.current.updateWork('둘째 수정', '옛 소개') })
  expect(api.updateWork).toHaveBeenNthCalledWith(1, 'w1', '첫 수정', '옛 소개', 4, undefined, undefined)
  expect(api.updateWork).toHaveBeenNthCalledWith(2, 'w1', '둘째 수정', '옛 소개', 5, undefined, undefined)
  expect(result.current.active?.title).toBe('둘째 수정')
})

it('이력을 불러온 뒤 작품 정보를 저장해도 이력은 그대로 보인다 (저장은 이력 내용을 바꾸지 않는다)', async () => {
  const history: History = { versions: [], proposals: [], publicationHistory: [] }
  const saved: Work = { ...work, title: '새 제목', revision: 5, draft: { ...work.draft, revision: 5 } }
  const api = { list: vi.fn().mockResolvedValue([work]), history: vi.fn().mockResolvedValue(history), updateWork: vi.fn().mockResolvedValue(saved) }
  const { result } = open(api)
  await act(async () => {})
  await act(async () => { await result.current.loadHistory() })
  await act(async () => { await result.current.updateWork('새 제목', '옛 소개') })
  expect(result.current.history).toEqual(history)
  expect(api.history).toHaveBeenCalledTimes(1)
})

it('바뀐 장르·해시태그는 제목·소개와 함께 같은 revision으로 보내고, 서버가 돌려준 값으로 화면을 바꾼다', async () => {
  const saved: Work = { ...work, genres: ['무협'], hashtags: ['복수', '성장'], revision: 5, draft: { ...work.draft, revision: 5 } }
  const api = { list: vi.fn().mockResolvedValue([work]), updateWork: vi.fn().mockResolvedValue(saved) }
  const { result } = open(api)
  await act(async () => {})
  await act(async () => { await result.current.updateWork('옛 제목', '옛 소개', { genres: ['무협'], hashtags: ['복수', '성장'] }) })
  expect(api.updateWork).toHaveBeenCalledWith('w1', '옛 제목', '옛 소개', 4, undefined, { genres: ['무협'], hashtags: ['복수', '성장'] })
  expect(result.current.active?.genres).toEqual(['무협'])
  expect(result.current.active?.hashtags).toEqual(['복수', '성장'])
  expect(result.current.notice).toBe('작품 정보를 저장했어요.')
})
