// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'

import type { Work } from '../../../../domain/entities/content'
import type { ManuscriptImportSummary, ManuscriptPreview } from '../../../../domain/entities/manuscript'
import type { ManuscriptUseCase } from '../../../../domain/usecases/ManuscriptUseCase'
import { useManuscriptImportViewModel } from './useManuscriptImportViewModel'

const A = 'b142427a-cd9d-4fdc-a40d-c9e553d87d30'
const B = '6f0c6c4e-8f4a-4d0b-9d52-1c3b5a7e9f10'
const C = '0d3b6f0e-6a55-4c1e-8f3a-2b9d4e7a1c55'
const work = (id: string, title: string): Work => ({ id, title, summary: '', visibility: 'private', allowFork: false, allowForkPublication: false, source: null, episodes: [], draft: { title: '', body: '', revision: 0 } })
const episode = (title: string, from: number, to: number) => ({ title, from, to, charCount: to - from, excerpt: `${title} 발췌`, imageCount: 0, warnings: [] as string[] })
const preview: ManuscriptPreview = { format: 'txt', unit: 'line', unitCount: 30, existingEpisodeCount: 2, episodes: [episode('1화', 0, 10), episode('2화', 10, 20), episode('3화', 20, 30)] }
const summary: ManuscriptImportSummary = { succeeded: 2, failed: 1, results: [
  { number: 1, title: '1화', status: 'versioned', reason: null, missingImages: 0 },
  { number: 2, title: '2화', status: 'created', reason: null, missingImages: 0 },
  { number: 3, title: '3화', status: 'failed', reason: '본문이 40,000자를 넘어 등록할 수 없어요.', missingImages: 0 },
] }
const upload = () => new File(['1화\n본문'], '원고.txt')
afterEach(cleanup)

function setup(search = '') {
  const manuscript = { preview: vi.fn<ManuscriptUseCase['preview']>(async () => preview), confirm: vi.fn<ManuscriptUseCase['confirm']>(async () => summary) }
  const works = { list: vi.fn(async () => [work(A, '첫 작품'), work(B, '둘째 작품')]) }
  const wrapper = ({ children }: { children: ReactNode }) => <MemoryRouter initialEntries={[`/import${search}`]}>{children}</MemoryRouter>
  return { manuscript, works, ...renderHook(() => useManuscriptImportViewModel(manuscript, works), { wrapper }) }
}
type Setup = ReturnType<typeof setup>
const loaded = (t: Setup) => waitFor(() => expect(t.result.current.works).toHaveLength(2))
async function ready(t: Setup, file = upload()) {
  await loaded(t)
  act(() => t.result.current.selectWork(A))
  act(() => { for (const i of [0, 1, 2]) t.result.current.setRight(i, true) })
  act(() => t.result.current.pickFile(file))
  return file
}

it('?work= 로 넘어온 내 작품만 미리 고르고, 직접 고른 작품이 우선한다', async () => {
  const known = setup(`?work=${A}`)
  await waitFor(() => expect(known.result.current.workId).toBe(A))
  act(() => known.result.current.selectWork(B))
  expect(known.result.current.workId).toBe(B)
  act(() => known.result.current.selectWork(''))
  expect(known.result.current.workId).toBe('')
  const unknown = setup(`?work=${C}`)
  await loaded(unknown)
  expect(unknown.result.current.workId).toBe('')
})

it('작품 목록을 불러오는 동안·실패했을 때를 구분해 알린다', async () => {
  const t = setup()
  expect(t.result.current.worksLoading).toBe(true)
  await loaded(t)
  expect(t.result.current.worksLoading).toBe(false)
  cleanup()
  const failing = { list: vi.fn().mockRejectedValue(new Error('작품을 불러오지 못했어요.')) }
  const failed = renderHook(() => useManuscriptImportViewModel({ preview: vi.fn(), confirm: vi.fn() }, failing), { wrapper: ({ children }: { children: ReactNode }) => <MemoryRouter>{children}</MemoryRouter> })
  await waitFor(() => expect(failed.result.current.worksError).toBe('작품을 불러오지 못했어요.'))
})

it('작품·권리 3개·파일이 모두 있어야 미리보기를 보내고 결과를 제외 표시 없는 조정 목록으로 둔다', async () => {
  const t = setup()
  await loaded(t)
  act(() => t.result.current.selectWork(A))
  const file = upload()
  act(() => t.result.current.pickFile(file))
  expect(t.result.current.canPreview).toBe(false)
  await act(async () => { expect(await t.result.current.preview()).toBe(false) })
  expect(t.manuscript.preview).not.toHaveBeenCalled()
  act(() => { for (const i of [0, 1]) t.result.current.setRight(i, true) })
  expect(t.result.current.allRights).toBe(false)
  expect(t.result.current.canPreview).toBe(false)
  act(() => t.result.current.setRight(2, true))
  expect(t.result.current.canPreview).toBe(true)
  await act(async () => { expect(await t.result.current.preview()).toBe(true) })
  expect(t.manuscript.preview).toHaveBeenCalledWith(A, file, expect.any(AbortSignal))
  expect(t.result.current.plan).toMatchObject({ format: 'txt', existingEpisodeCount: 2 })
  expect(t.result.current.plan?.episodes.map((e) => [e.title, e.excluded])).toEqual([['1화', false], ['2화', false], ['3화', false]])
  expect(t.result.current.busy).toBeNull()
  expect(t.result.current.error).toBe('')
})

it('미리보기 실패는 서버 사유를 보이고 미리보기를 만들지 않으며 진행 중 중복 요청은 보내지 않는다', async () => {
  const t = setup()
  await ready(t)
  let reject!: (error: Error) => void
  t.manuscript.preview.mockImplementationOnce(() => new Promise<ManuscriptPreview>((_, r) => { reject = r }))
  let pending!: Promise<boolean>
  act(() => { pending = t.result.current.preview() })
  expect(t.result.current.busy).toBe('preview')
  await act(async () => { expect(await t.result.current.preview()).toBe(false) })
  expect(t.manuscript.preview).toHaveBeenCalledTimes(1)
  await act(async () => { reject(new Error('DRM이 걸린 EPUB은 읽을 수 없어요.')); expect(await pending).toBe(false) })
  expect(t.result.current.error).toBe('DRM이 걸린 EPUB은 읽을 수 없어요.')
  expect(t.result.current.plan).toBeNull()
  expect(t.result.current.busy).toBeNull()
})

it('제목 수정·제외·합치기를 조정 목록에 반영하고 남긴 회차 수를 센다', async () => {
  const t = setup()
  await ready(t)
  await act(async () => { await t.result.current.preview() })
  act(() => t.result.current.setTitle(0, '새 1화'))
  act(() => t.result.current.setExcluded(1, true))
  expect(t.result.current.included).toBe(2)
  act(() => t.result.current.mergeNext(1))
  expect(t.result.current.plan?.episodes).toHaveLength(3)
  act(() => t.result.current.setExcluded(1, false))
  act(() => t.result.current.mergeNext(1))
  expect(t.result.current.plan?.episodes.map((e) => [e.title, e.from, e.to])).toEqual([['새 1화', 0, 10], ['2화', 10, 30]])
  expect(t.result.current.included).toBe(2)
})

it('확정은 조정한 목록과 권리 확인을 보내고 회차별 결과를 그대로 보관한다', async () => {
  const t = setup()
  const file = await ready(t)
  await act(async () => { await t.result.current.preview() })
  act(() => t.result.current.setExcluded(0, true))
  expect(t.result.current.canConfirm).toBe(true)
  await act(async () => { expect(await t.result.current.confirm()).toBe(true) })
  expect(t.manuscript.confirm).toHaveBeenCalledWith(A, file, true, expect.any(Array), expect.any(AbortSignal))
  expect(t.manuscript.confirm.mock.calls[0][3].map((e) => [e.title, e.excluded])).toEqual([['1화', true], ['2화', false], ['3화', false]])
  expect(t.result.current.result).toBe(summary)
  expect(t.result.current.busy).toBeNull()
})

it('확정 요청 전체가 실패하면 미리보기 편집을 그대로 두고 성공 결과를 만들지 않는다', async () => {
  const t = setup()
  await ready(t)
  await act(async () => { await t.result.current.preview() })
  act(() => t.result.current.setTitle(0, '고친 제목'))
  t.manuscript.confirm.mockRejectedValueOnce(new Error('회차 번호가 겹쳐요.'))
  await act(async () => { expect(await t.result.current.confirm()).toBe(false) })
  expect(t.result.current.error).toBe('회차 번호가 겹쳐요.')
  expect(t.result.current.result).toBeNull()
  expect(t.result.current.plan?.episodes[0].title).toBe('고친 제목')
})

it('남긴 회차가 없거나 제목이 비었거나 권리 확인이 빠지면 확정할 수 없다', async () => {
  const t = setup()
  await ready(t)
  await act(async () => { await t.result.current.preview() })
  act(() => t.result.current.setTitle(1, '  '))
  expect(t.result.current.canConfirm).toBe(false)
  act(() => t.result.current.setTitle(1, '2화'))
  expect(t.result.current.canConfirm).toBe(true)
  act(() => t.result.current.setRight(1, false))
  expect(t.result.current.canConfirm).toBe(false)
  act(() => t.result.current.setRight(1, true))
  act(() => { for (const i of [0, 1, 2]) t.result.current.setExcluded(i, true) })
  expect(t.result.current.canConfirm).toBe(false)
  await act(async () => { expect(await t.result.current.confirm()).toBe(false) })
  expect(t.manuscript.confirm).not.toHaveBeenCalled()
})

it('확정 중 중복 요청은 보내지 않고, 취소하면 늦은 성공 응답을 적용하지 않는다', async () => {
  const t = setup()
  await ready(t)
  await act(async () => { await t.result.current.preview() })
  let resolve!: (value: ManuscriptImportSummary) => void
  let signal: AbortSignal | undefined
  t.manuscript.confirm.mockImplementationOnce((_w, _f, _r, _e, s) => { signal = s; return new Promise<ManuscriptImportSummary>((r) => { resolve = r }) })
  let pending!: Promise<boolean>
  act(() => { pending = t.result.current.confirm() })
  expect(t.result.current.busy).toBe('confirm')
  await act(async () => { expect(await t.result.current.confirm()).toBe(false) })
  expect(t.manuscript.confirm).toHaveBeenCalledTimes(1)
  act(() => t.result.current.cancel())
  expect(signal?.aborted).toBe(true)
  expect(t.result.current.busy).toBeNull()
  expect(t.result.current.error).toContain('이미 처리했을 수 있어요')
  await act(async () => { resolve(summary); await pending })
  expect(t.result.current.result).toBeNull()
})

it('화면을 떠나면 진행 중인 요청을 취소한다', async () => {
  const t = setup()
  await ready(t)
  let signal: AbortSignal | undefined
  t.manuscript.preview.mockImplementationOnce((_w, _f, s) => { signal = s; return new Promise<ManuscriptPreview>(() => {}) })
  act(() => { void t.result.current.preview() })
  t.unmount()
  expect(signal?.aborted).toBe(true)
})

it('작품이나 파일을 바꾸면 이전 미리보기와 결과를 버리고, 다시 시작하면 입력을 모두 비운다', async () => {
  const t = setup()
  await ready(t)
  await act(async () => { await t.result.current.preview() })
  act(() => t.result.current.selectWork(B))
  expect(t.result.current.plan).toBeNull()
  await act(async () => { await t.result.current.preview() })
  expect(t.result.current.plan).not.toBeNull()
  act(() => t.result.current.pickFile(upload()))
  expect(t.result.current.plan).toBeNull()
  await act(async () => { await t.result.current.preview() })
  await act(async () => { await t.result.current.confirm() })
  expect(t.result.current.result).toBe(summary)
  act(() => t.result.current.reset())
  expect(t.result.current).toMatchObject({ result: null, plan: null, file: null, rights: [false, false, false], error: '' })
  expect(t.result.current.workId).toBe(B)
})
