// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import type { Draft, WritingEpisode } from '../../../../domain/entities/content'
import { imageMarker, type EpisodeImage } from '../../../../domain/entities/media'
import type { EpisodeUseCase } from '../../../../domain/usecases/EpisodeUseCase'
import type { MediaUseCase } from '../../../../domain/usecases/MediaUseCase'
import { useEpisodeImageViewModel } from './useEpisodeImageViewModel'

const workId = 'b142427a-cd9d-4fdc-a40d-c9e553d87d30'
const A = 'e25ffb25-8128-48c0-8d66-e1d56831cd56'
const B = '6f0c6c4e-8f4a-4d0b-9d52-1c3b5a7e9f10'
const image = (id: string, extra: Partial<EpisodeImage> = {}): EpisodeImage => ({ id, filename: `${id.slice(0, 4)}.png`, mediaType: 'image/png', byteSize: 2048, altText: '', createdAt: '2026-11-03T10:00:00Z', url: '/unused', referenced: true, ...extra })
const draft = (body: string, revision = 3): Draft => ({ title: '둘째 화', body, revision })
const writing = (value: Draft): WritingEpisode => ({ number: 2, draft: value, versions: [], publishedVersionId: null, inherited: false, updatedAt: null, checkpointStatus: 'READY', checkpoints: [] })
const body = `앞\n\n${imageMarker(A)}\n\n뒤`
afterEach(cleanup)

type Initial = { draft?: Draft; unsaved?: boolean; episode?: number; listError?: Error }
function setup(initial: Initial = {}) {
  const media = {
    listEpisodeImages: vi.fn<MediaUseCase['listEpisodeImages']>(async () => { if (initial.listError) throw initial.listError; return [image(A), image(B, { referenced: false })] }),
    updateEpisodeImageAlt: vi.fn<MediaUseCase['updateEpisodeImageAlt']>(async (_w, _n, id, altText) => image(id, { altText })),
  }
  const episodes = { writeEpisode: vi.fn<EpisodeUseCase['writeEpisode']>(async (_id, _n, value) => writing({ ...value, revision: value.revision + 1 })) }
  const onDraftSaved = vi.fn()
  const hook = renderHook((props) => useEpisodeImageViewModel({ workId, onDraftSaved, ...props }, media, episodes), {
    initialProps: { episode: initial.episode ?? 2, draft: initial.draft ?? draft(body), unsaved: initial.unsaved ?? false },
  })
  return { media, episodes, onDraftSaved, ...hook }
}
const loaded = (t: ReturnType<typeof setup>) => waitFor(() => expect(t.result.current.images).toHaveLength(2))

it('회차의 이미지 목록을 불러와 참조 여부와 함께 보관한다', async () => {
  const t = setup()
  expect(t.result.current.loading).toBe(true)
  await loaded(t)
  expect(t.media.listEpisodeImages).toHaveBeenCalledWith(workId, 2, expect.any(AbortSignal))
  expect(t.result.current).toMatchObject({ loading: false, error: '', busy: false })
  expect(t.result.current.images.map((i) => [i.id, i.referenced])).toEqual([[A, true], [B, false]])
})

it('초안이 저장돼 revision이 바뀌면 이전 목록을 둔 채 다시 읽고, 회차가 바뀌면 이전 회차 이미지를 감춘다', async () => {
  const t = setup()
  await loaded(t)
  let resolve!: (rows: EpisodeImage[]) => void
  t.media.listEpisodeImages.mockImplementationOnce(() => new Promise<EpisodeImage[]>((r) => { resolve = r }))
  t.rerender({ episode: 2, draft: draft('새 본문', 4), unsaved: false })
  expect(t.result.current.images).toHaveLength(2)
  await act(async () => { resolve([image(A, { referenced: false })]) })
  expect(t.result.current.images.map((i) => i.referenced)).toEqual([false])
  t.media.listEpisodeImages.mockImplementationOnce(() => new Promise<EpisodeImage[]>(() => {}))
  t.rerender({ episode: 3, draft: draft('셋째', 1), unsaved: false })
  expect(t.result.current.images).toEqual([])
  expect(t.media.listEpisodeImages).toHaveBeenLastCalledWith(workId, 3, expect.any(AbortSignal))
})

it('목록을 못 불러오면 서버 사유를 보이고 다시 불러올 수 있다', async () => {
  const t = setup({ listError: new Error('저장소 연결 실패') })
  await waitFor(() => expect(t.result.current.error).toBe('저장소 연결 실패'))
  expect(t.result.current).toMatchObject({ loading: false, images: [] })
  t.media.listEpisodeImages.mockResolvedValue([image(A)])
  act(() => t.result.current.reload())
  await waitFor(() => expect(t.result.current.images).toHaveLength(1))
  expect(t.result.current.error).toBe('')
})

it('대체 텍스트를 저장하면 그 이미지만 갱신하고, 진행 중에는 다시 보내지 않는다', async () => {
  const t = setup()
  await loaded(t)
  let resolve!: (value: EpisodeImage) => void
  t.media.updateEpisodeImageAlt.mockImplementationOnce(() => new Promise<EpisodeImage>((r) => { resolve = r }))
  let pending!: Promise<boolean>
  act(() => { pending = t.result.current.saveAlt(t.result.current.images[0], '강 위의 다리') })
  expect(t.result.current.busy).toBe(true)
  await act(async () => { expect(await t.result.current.saveAlt(t.result.current.images[1], '중복')).toBe(false) })
  expect(t.media.updateEpisodeImageAlt).toHaveBeenCalledTimes(1)
  expect(t.media.updateEpisodeImageAlt).toHaveBeenCalledWith(workId, 2, A, '강 위의 다리', expect.any(AbortSignal))
  await act(async () => { resolve(image(A, { altText: '강 위의 다리' })); expect(await pending).toBe(true) })
  expect(t.result.current.images.map((i) => [i.id, i.altText])).toEqual([[A, '강 위의 다리'], [B, '']])
  expect(t.result.current).toMatchObject({ busy: false, error: '', notice: '이미지 설명을 저장했어요.' })
})

it('대체 텍스트 저장이 실패하면 서버 사유를 보이고 기존 설명을 그대로 둔다', async () => {
  const t = setup()
  await loaded(t)
  t.media.updateEpisodeImageAlt.mockRejectedValueOnce(new Error('이미지 설명에 제어 문자를 쓸 수 없어요.'))
  await act(async () => { expect(await t.result.current.saveAlt(t.result.current.images[0], '나쁜\u0000설명')).toBe(false) })
  expect(t.result.current.error).toBe('이미지 설명에 제어 문자를 쓸 수 없어요.')
  expect(t.result.current.images[0].altText).toBe('')
  expect(t.result.current.notice).toBe('')
  expect(t.result.current.busy).toBe(false)
})

it('본문에서 빼기는 현재 초안에서 표식만 지워 revision과 함께 초안 저장 경로로 보내고 화면을 다시 읽게 알린다', async () => {
  const t = setup()
  await loaded(t)
  await act(async () => { expect(await t.result.current.removeFromBody(t.result.current.images[0])).toBe(true) })
  expect(t.episodes.writeEpisode).toHaveBeenCalledWith(workId, 2, { title: '둘째 화', body: '앞\n\n뒤', revision: 3 }, false, expect.any(AbortSignal))
  expect(t.onDraftSaved).toHaveBeenCalledTimes(1)
  expect(t.result.current.images.map((i) => [i.id, i.referenced])).toEqual([[A, false], [B, false]])
  expect(t.result.current.notice).toBe('본문에서 뺐어요. 이미지 파일은 저장 버전·발행본을 위해 남겨 두었어요.')
  expect(t.result.current.error).toBe('')
})

it('저장하지 않은 입력이 있으면 덮어쓰지 않고 먼저 저장하도록 안내한다', async () => {
  const t = setup({ unsaved: true })
  await loaded(t)
  await act(async () => { expect(await t.result.current.removeFromBody(t.result.current.images[0])).toBe(false) })
  expect(t.episodes.writeEpisode).not.toHaveBeenCalled()
  expect(t.onDraftSaved).not.toHaveBeenCalled()
  expect(t.result.current.error).toContain('저장하지 않은 입력')
  expect(t.result.current.images[0].referenced).toBe(true)
})

it('이미 본문에 없는 이미지는 초안을 저장하지 않고 목록만 바로잡는다', async () => {
  const t = setup({ draft: draft('표식 없는 본문') })
  await loaded(t)
  await act(async () => { expect(await t.result.current.removeFromBody(t.result.current.images[0])).toBe(true) })
  expect(t.episodes.writeEpisode).not.toHaveBeenCalled()
  expect(t.onDraftSaved).not.toHaveBeenCalled()
  expect(t.result.current.images[0].referenced).toBe(false)
  expect(t.result.current.notice).toBe('이 이미지는 이미 본문에 없어요.')
})

it('초안 저장이 revision 충돌 등으로 실패하면 서버 사유와 다시 불러오기 안내를 보이고 아무것도 바꾸지 않는다', async () => {
  const t = setup()
  await loaded(t)
  t.episodes.writeEpisode.mockRejectedValueOnce(new Error('다른 곳에서 원고가 바뀌었어요.'))
  await act(async () => { expect(await t.result.current.removeFromBody(t.result.current.images[0])).toBe(false) })
  expect(t.result.current.error).toContain('다른 곳에서 원고가 바뀌었어요.')
  expect(t.result.current.error).toContain('다시 불러온 뒤')
  expect(t.result.current.error).toContain('이미지 설명은 그대로')
  expect(t.onDraftSaved).not.toHaveBeenCalled()
  expect(t.result.current.images[0].referenced).toBe(true)
  expect(t.result.current.busy).toBe(false)
})

it('화면을 떠나면 진행 중인 목록·저장 요청을 취소하고 늦은 응답을 적용하지 않는다', async () => {
  const t = setup()
  await loaded(t)
  let signal: AbortSignal | undefined
  let resolve!: (value: EpisodeImage) => void
  t.media.updateEpisodeImageAlt.mockImplementationOnce((_w, _n, _id, _alt, s) => { signal = s; return new Promise<EpisodeImage>((r) => { resolve = r }) })
  act(() => { void t.result.current.saveAlt(t.result.current.images[0], '설명') })
  t.unmount()
  expect(signal?.aborted).toBe(true)
  await act(async () => { resolve(image(A, { altText: '늦은 응답' })) })
  expect(t.result.current.images[0].altText).toBe('')
})
