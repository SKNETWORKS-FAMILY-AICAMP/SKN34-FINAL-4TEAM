// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import type { ManuscriptDownload } from '../../../../domain/entities/manuscript'
import type { ManuscriptUseCase } from '../../../../domain/usecases/ManuscriptUseCase'
import { useManuscriptExportViewModel } from './useManuscriptExportViewModel'

const workId = 'b142427a-cd9d-4fdc-a40d-c9e553d87d30'
const downloads: { download: string; href: string }[] = []
const createObjectURL = vi.fn(() => 'blob:manuscript')
const revokeObjectURL = vi.fn()

beforeEach(() => {
  vi.stubGlobal('URL', class extends URL { static createObjectURL = createObjectURL; static revokeObjectURL = revokeObjectURL })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { downloads.push({ download: this.download, href: this.href }) })
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); downloads.length = 0; createObjectURL.mockClear(); revokeObjectURL.mockClear() })

function setup(episode: number | null = 2) {
  const api = { exportManuscript: vi.fn<ManuscriptUseCase['exportManuscript']>(async () => ({ blob: new Blob(['본문']), filename: '작품_2화.txt' })) }
  return { api, ...renderHook(({ episode }) => useManuscriptExportViewModel(workId, episode, api), { initialProps: { episode } }) }
}

it('기본은 현재 회차의 초안을 TXT로 받는다', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const t = setup()
  expect(t.result.current).toMatchObject({ format: 'txt', scope: 'episode', source: 'draft', busy: false })
  await act(async () => { expect(await t.result.current.download()).toBe(true) })
  expect(t.api.exportManuscript).toHaveBeenCalledWith(workId, { format: 'txt', source: 'draft', episode: 2 }, expect.any(AbortSignal))
  expect(downloads).toEqual([{ download: '작품_2화.txt', href: 'blob:manuscript' }])
  expect(t.result.current.notice).toBe('작품_2화.txt 다운로드를 요청했어요.')
  expect(t.result.current.error).toBe('')
  expect(revokeObjectURL).not.toHaveBeenCalled()
  act(() => { vi.advanceTimersByTime(1000) })
  expect(revokeObjectURL).toHaveBeenCalledWith('blob:manuscript')
})

it('형식·범위·원본 선택을 서버 요청에 그대로 싣고 작품 전체는 회차 번호를 보내지 않는다', async () => {
  const t = setup()
  act(() => { t.result.current.setFormat('epub'); t.result.current.setScope('work'); t.result.current.setSource('published') })
  await act(async () => { await t.result.current.download() })
  expect(t.api.exportManuscript).toHaveBeenCalledWith(workId, { format: 'epub', source: 'published' }, expect.any(AbortSignal))
  expect(t.api.exportManuscript.mock.calls[0][1]).not.toHaveProperty('episode')
})

it('현재 회차가 없거나 내보낼 수 없는 회차이면 작품 전체로만 내보낸다', async () => {
  const t = setup(null)
  expect(t.result.current.scope).toBe('work')
  await act(async () => { await t.result.current.download() })
  expect(t.api.exportManuscript.mock.calls[0][1]).toEqual({ format: 'txt', source: 'draft' })
  t.rerender({ episode: 3 })
  expect(t.result.current.scope).toBe('episode')
})

it('실패하면 서버 사유를 보이고 다운로드를 만들지 않으며 선택은 그대로 둔다', async () => {
  const t = setup()
  act(() => { t.result.current.setFormat('epub') })
  t.api.exportManuscript.mockRejectedValueOnce(new Error('내보낼 수 있는 회차가 없어요.'))
  await act(async () => { expect(await t.result.current.download()).toBe(false) })
  expect(t.result.current.error).toBe('내보낼 수 있는 회차가 없어요.')
  expect(t.result.current.notice).toBe('')
  expect(t.result.current.format).toBe('epub')
  expect(t.result.current.busy).toBe(false)
  expect(downloads).toEqual([])
  expect(createObjectURL).not.toHaveBeenCalled()
})

it('진행 중 중복 요청은 보내지 않고, 취소하면 늦은 응답으로 다운로드하지 않는다', async () => {
  const t = setup()
  let resolve!: (value: ManuscriptDownload) => void
  let signal: AbortSignal | undefined
  t.api.exportManuscript.mockImplementationOnce((_w, _q, s) => { signal = s; return new Promise<ManuscriptDownload>((r) => { resolve = r }) })
  let pending!: Promise<boolean>
  act(() => { pending = t.result.current.download() })
  expect(t.result.current.busy).toBe(true)
  await act(async () => { expect(await t.result.current.download()).toBe(false) })
  expect(t.api.exportManuscript).toHaveBeenCalledTimes(1)
  act(() => t.result.current.cancel())
  expect(signal?.aborted).toBe(true)
  expect(t.result.current.busy).toBe(false)
  expect(t.result.current.error).toBe('내보내기를 취소했어요.')
  await act(async () => { resolve({ blob: new Blob(['late']), filename: 'late.txt' }); await pending })
  expect(downloads).toEqual([])
  expect(t.result.current.notice).toBe('')
})

it('화면을 떠나면 진행 중인 요청을 취소한다', () => {
  const t = setup()
  let signal: AbortSignal | undefined
  t.api.exportManuscript.mockImplementationOnce((_w, _q, s) => { signal = s; return new Promise<ManuscriptDownload>(() => {}) })
  act(() => { void t.result.current.download() })
  t.unmount()
  expect(signal?.aborted).toBe(true)
})
