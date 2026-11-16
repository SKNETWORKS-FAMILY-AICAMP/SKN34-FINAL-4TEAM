// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { useCardImages, useCardImageUrl } from './useCardImages'

/** jsdom에는 URL.createObjectURL이 없어 만든 순서대로 blob:card-1, 2 …를 주는 대역이다. */
const objectUrls = { created: 0, createObjectURL: vi.fn(), revokeObjectURL: vi.fn() }
beforeEach(() => {
  objectUrls.created = 0
  objectUrls.createObjectURL = vi.fn(() => `blob:card-${++objectUrls.created}`)
  objectUrls.revokeObjectURL = vi.fn()
  vi.stubGlobal('URL', class extends URL { static createObjectURL = objectUrls.createObjectURL; static revokeObjectURL = objectUrls.revokeObjectURL })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const png = () => new Blob(['png'], { type: 'image/png' })
type Read = (worldId: string, imageId: string, signal?: AbortSignal) => Promise<Blob>
const withReader = (cardImage: Read = vi.fn<Read>(async () => png()), supportsCardImages = true) => ({ cardImage, useCase: { supportsCardImages, cardImage } })

it('같은 이미지는 소비자가 몇이든 한 번만 읽고 같은 객체 주소를 나눠 쓰며, 다른 이미지는 따로 읽는다', async () => {
  const { cardImage, useCase } = withReader()
  const { result } = renderHook(() => {
    const images = useCardImages(useCase, 'w1')
    return [useCardImageUrl(images, 'i1'), useCardImageUrl(images, 'i1'), useCardImageUrl(images, 'i2')] as const
  })
  await waitFor(() => expect(result.current.every((image) => image.url)).toBe(true))
  expect(cardImage).toHaveBeenCalledTimes(2)
  expect(vi.mocked(cardImage).mock.calls.map(([world, image]) => [world, image])).toEqual([['w1', 'i1'], ['w1', 'i2']])
  expect(result.current[0].url).toBe(result.current[1].url)
  expect(result.current[2].url).not.toBe(result.current[0].url)
})

it('읽는 동안은 pending이고, 끝나면 url이 차고 pending이 풀리며, 이미지 id가 없으면 읽지 않는다', async () => {
  let finish!: (blob: Blob) => void
  const cardImage = vi.fn<Read>(() => new Promise<Blob>((resolve) => { finish = resolve }))
  const { useCase } = withReader(cardImage)
  const { result, rerender } = renderHook(({ imageId }: { imageId?: string }) => useCardImageUrl(useCardImages(useCase, 'w1'), imageId), { initialProps: { imageId: undefined as string | undefined } })
  expect(result.current).toEqual({ url: '', error: '', pending: false })
  expect(cardImage).not.toHaveBeenCalled()
  rerender({ imageId: 'i1' })
  await waitFor(() => expect(cardImage).toHaveBeenCalledOnce())
  expect(result.current).toEqual({ url: '', error: '', pending: true })
  await act(async () => finish(png()))
  expect(result.current).toEqual({ url: 'blob:card-1', error: '', pending: false })
  // 다른 이미지로 바뀌면 이전 이미지가 새 이미지인 것처럼 남지 않고 다시 읽는 중이 된다.
  rerender({ imageId: 'i2' })
  expect(result.current).toEqual({ url: '', error: '', pending: true })
})

it('읽지 못하면 이유를 알리고 캐시에 남기지 않아 같은 이미지를 다시 부르면 다시 읽는다', async () => {
  const cardImage = vi.fn<Read>().mockRejectedValueOnce(new Error('이미지를 찾을 수 없어요.')).mockResolvedValue(png())
  const { useCase } = withReader(cardImage)
  const { result } = renderHook(() => {
    const images = useCardImages(useCase, 'w1')
    return { images, shown: useCardImageUrl(images, 'i1') }
  })
  await waitFor(() => expect(result.current.shown.error).toBe('이미지를 찾을 수 없어요.'))
  expect(result.current.shown).toMatchObject({ url: '', pending: false })
  await act(async () => { await expect(result.current.images.load('i1')).resolves.toBe('blob:card-1') })
  expect(cardImage).toHaveBeenCalledTimes(2)
  await act(async () => { await result.current.images.load('i1') }) // 성공한 것은 다시 읽지 않는다
  expect(cardImage).toHaveBeenCalledTimes(2)
})

it('형식이 PNG·JPEG·WebP가 아닌 응답은 객체 주소로 만들지 않고 실패로 알린다', async () => {
  const { useCase } = withReader(vi.fn<Read>(async () => new Blob(['<svg/>'], { type: 'image/svg+xml' })))
  const { result } = renderHook(() => useCardImageUrl(useCardImages(useCase, 'w1'), 'i1'))
  await waitFor(() => expect(result.current.error).not.toBe(''))
  expect(result.current.url).toBe('')
  expect(objectUrls.createObjectURL).not.toHaveBeenCalled()
})

it('화면을 떠나면 읽던 요청을 끊고 만든 객체 주소를 모두 해제한다', async () => {
  const signals: AbortSignal[] = []
  const cardImage = vi.fn<Read>((_world, imageId, signal) => {
    if (signal) signals.push(signal)
    return imageId === 'slow' ? new Promise<Blob>(() => undefined) : Promise.resolve(png())
  })
  const { useCase } = withReader(cardImage)
  const { result, unmount } = renderHook(() => {
    const images = useCardImages(useCase, 'w1')
    return [useCardImageUrl(images, 'i1'), useCardImageUrl(images, 'i2'), useCardImageUrl(images, 'slow')] as const
  })
  await waitFor(() => expect([result.current[0].url, result.current[1].url]).toEqual(['blob:card-1', 'blob:card-2']))
  expect(objectUrls.revokeObjectURL).not.toHaveBeenCalled() // 읽는 동안 다른 화면이 같은 주소를 쓰므로 바꿔도 해제하지 않는다
  unmount()
  expect(objectUrls.revokeObjectURL.mock.calls.map(([url]) => url).sort()).toEqual(['blob:card-1', 'blob:card-2'])
  expect(signals.every((signal) => signal.aborted)).toBe(true)
})

it('세계관이 바뀌면 이전 세계관의 객체 주소를 해제하고 새 세계관의 이미지를 새로 읽는다', async () => {
  const { cardImage, useCase } = withReader()
  const { result, rerender } = renderHook(({ worldId }: { worldId: string }) => useCardImageUrl(useCardImages(useCase, worldId), 'i1'), { initialProps: { worldId: 'w1' } })
  await waitFor(() => expect(result.current.url).toBe('blob:card-1'))
  rerender({ worldId: 'w2' })
  await waitFor(() => expect(result.current.url).toBe('blob:card-2'))
  expect(objectUrls.revokeObjectURL).toHaveBeenCalledWith('blob:card-1')
  expect(vi.mocked(cardImage).mock.calls.map(([world, image]) => [world, image])).toEqual([['w1', 'i1'], ['w2', 'i1']])
})

it('release는 그 이미지의 객체 주소만 해제하고 읽던 요청을 끊으며, 다음에 부르면 새로 읽는다', async () => {
  const signals: AbortSignal[] = []
  const cardImage = vi.fn<Read>(async (_world, _imageId, signal) => { if (signal) signals.push(signal); return png() })
  const { useCase } = withReader(cardImage)
  const { result } = renderHook(() => useCardImages(useCase, 'w1'))
  await act(async () => { await result.current.load('i1'); await result.current.load('i2') })
  act(() => result.current.release('i1'))
  expect(objectUrls.revokeObjectURL.mock.calls.map(([url]) => url)).toEqual(['blob:card-1'])
  expect(signals.map((signal) => signal.aborted)).toEqual([true, false])
  await act(async () => { await expect(result.current.load('i1')).resolves.toBe('blob:card-3') })
  expect(cardImage).toHaveBeenCalledTimes(3)
  act(() => result.current.release('없는-이미지')) // 읽은 적 없는 이미지는 아무 일도 하지 않는다
  expect(objectUrls.revokeObjectURL).toHaveBeenCalledTimes(1)
})

it('이미지를 읽을 수 없는 저장소(데모)나 세계관 없이는 지원하지 않는다고 알리고 읽지 않는다', () => {
  const { cardImage, useCase } = withReader(undefined, false)
  const demo = renderHook(() => { const images = useCardImages(useCase, 'w1'); return { supported: images.supported, shown: useCardImageUrl(images, 'i1') } })
  expect(demo.result.current).toEqual({ supported: false, shown: { url: '', error: '', pending: false } })
  const none = renderHook(() => useCardImages(withReader().useCase, undefined))
  expect(none.result.current.supported).toBe(false)
  expect(cardImage).not.toHaveBeenCalled()
})

it('개발 모드(StrictMode)처럼 효과가 두 번 돌아도 이미지는 읽히고, 끝내면 만든 객체 주소가 모두 해제된다', async () => {
  const { useCase } = withReader()
  const { result, unmount } = renderHook(() => useCardImageUrl(useCardImages(useCase, 'w1'), 'i1'), { wrapper: StrictMode })
  await waitFor(() => expect(result.current.url).not.toBe(''))
  unmount()
  expect(objectUrls.revokeObjectURL).toHaveBeenCalledTimes(objectUrls.created)
})
