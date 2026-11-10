// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { imageMarker } from '../../../domain/entities/media'

const fakes = vi.hoisted(() => ({ mediaUseCase: { publicEpisodeImageAlts: vi.fn() } }))
vi.mock('../../../app/appContainer', () => ({ appContainer: { resolve: (name: keyof typeof fakes) => fakes[name] } }))
vi.mock('./useMediaViewModel', () => ({ useMediaViewModel: vi.fn(), useStoredImage: () => ({ url: 'blob:image', error: '' }) }))

import { ManuscriptBody } from './MediaPanel'

const workId = 'b142427a-cd9d-4fdc-a40d-c9e553d87d30'
const A = 'e25ffb25-8128-48c0-8d66-e1d56831cd56'
const B = '6f0c6c4e-8f4a-4d0b-9d52-1c3b5a7e9f10'
const body = `앞\n\n${imageMarker(A)}\n\n${imageMarker(B)}\n\n뒤`
afterEach(() => { cleanup(); vi.clearAllMocks() })

it('공개 보기에서는 공개 대체 텍스트를 img alt로 쓰고 설명이 없는 이미지는 기존 문구를 쓴다', async () => {
  fakes.mediaUseCase.publicEpisodeImageAlts.mockResolvedValue({ [A]: '강 위의 다리', [B]: '' })
  render(<ManuscriptBody workId={workId} number={2} body={body} publicView />)
  expect(screen.getByRole('img', { name: '본문 이미지 1' })).toBeTruthy()
  expect(await screen.findByRole('img', { name: '강 위의 다리' })).toBeTruthy()
  expect(screen.getByRole('img', { name: '본문 이미지 2' })).toBeTruthy()
  expect(fakes.mediaUseCase.publicEpisodeImageAlts).toHaveBeenCalledTimes(1)
  expect(fakes.mediaUseCase.publicEpisodeImageAlts).toHaveBeenCalledWith(workId, 2, expect.any(AbortSignal))
})

it('공개 설명을 불러오지 못해도 기존 대체 문구로 이미지를 보여 주고 화면은 그대로 둔다', async () => {
  fakes.mediaUseCase.publicEpisodeImageAlts.mockRejectedValue(new Error('공개 이미지 설명을 불러오지 못했어요.'))
  render(<ManuscriptBody workId={workId} number={2} body={body} publicView />)
  await vi.waitFor(() => expect(fakes.mediaUseCase.publicEpisodeImageAlts).toHaveBeenCalled())
  expect(screen.getByRole('img', { name: '본문 이미지 1' })).toBeTruthy()
  expect(screen.getByRole('img', { name: '본문 이미지 2' })).toBeTruthy()
  expect(screen.queryByRole('alert')).toBeNull()
})

it('공개 보기가 아니거나 이미지 표식이 없으면 공개 설명을 요청하지 않는다', () => {
  render(<ManuscriptBody workId={workId} number={2} body={body} />)
  expect(screen.getByRole('img', { name: '본문 이미지 1' })).toBeTruthy()
  cleanup()
  render(<ManuscriptBody workId={workId} number={2} body="이미지 없는 본문" publicView />)
  expect(screen.getByText('이미지 없는 본문')).toBeTruthy()
  expect(fakes.mediaUseCase.publicEpisodeImageAlts).not.toHaveBeenCalled()
})

it('화면을 떠나면 공개 설명 요청을 취소한다', () => {
  let signal: AbortSignal | undefined
  fakes.mediaUseCase.publicEpisodeImageAlts.mockImplementation((_w: string, _n: number, s: AbortSignal) => { signal = s; return new Promise(() => {}) })
  const view = render(<ManuscriptBody workId={workId} number={2} body={body} publicView />)
  view.unmount()
  expect(signal?.aborted).toBe(true)
})
