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

const shape = (root: Element) => [...root.children].map((el) => (el.className ? `${el.tagName}.${el.className}` : el.tagName))

it('서식 없는 원고는 전처럼 줄은 줄바꿈으로, 빈 줄은 그 수만큼의 빈 줄로 보인다', () => {
  const { container } = render(<ManuscriptBody workId={workId} number={2} body={'첫 줄\n둘째 줄\n\n\n셋째 줄'} />)
  const root = container.querySelector('.manuscript-body')!
  expect(shape(root)).toEqual(['P', 'BR', 'BR', 'P'])
  expect([...root.querySelectorAll('p')].map((p) => p.textContent)).toEqual(['첫 줄\n둘째 줄', '셋째 줄'])
  expect(root.querySelector('strong, em, blockquote, hr, img')).toBeNull()
})

it('본문 맨 앞의 빈 줄은 그대로 두고, 본문을 끝내는 마지막 줄바꿈은 빈 줄을 만들지 않는다', () => {
  const lines = (text: string) => shape(render(<ManuscriptBody workId={workId} number={2} body={text} />).container.querySelector('.manuscript-body')!)
  expect(lines('\n가')).toEqual(['BR', 'P'])
  expect(lines('가\n')).toEqual(['P'])
  expect(lines('가\n\n')).toEqual(['P', 'BR'])
  expect(lines('')).toEqual([])
  expect(lines('(빈 원고)')).toEqual(['P'])
})

it('굵게·기울임·소제목·인용·구분선을 그리고 지원하지 않는 문법과 태그는 글자 그대로 보인다', () => {
  const text = ['## 1장 **새벽**', '그는 *분명히* 말했다.', '> 인용 첫 줄', '> 둘째 줄', '***', '- 목록 아님 <b>태그</b> \\*별표\\*'].join('\n')
  const { container } = render(<ManuscriptBody workId={workId} number={2} body={text} />)
  const root = container.querySelector('.manuscript-body')!
  expect(shape(root)).toEqual(['P.manuscript-heading', 'P', 'BLOCKQUOTE', 'HR', 'P'])
  expect(root.querySelector('.manuscript-heading')!.textContent).toBe('1장 새벽')
  expect([...root.querySelectorAll('strong')].map((el) => el.textContent)).toEqual(['새벽'])
  expect([...root.querySelectorAll('em')].map((el) => el.textContent)).toEqual(['분명히'])
  expect(root.querySelector('blockquote')!.textContent).toBe('인용 첫 줄\n둘째 줄')
  expect(screen.getByRole('separator')).toBeTruthy()
  expect(root.lastElementChild!.textContent).toBe('- 목록 아님 <b>태그</b> *별표*')
  expect(root.querySelector('b')).toBeNull()
})

it('소제목은 쓰는 화면마다 제목 단계가 달라 제목 요소로 그리지 않는다', () => {
  render(<ManuscriptBody workId={workId} number={2} body={'## 1장 새벽\n# 큰 제목'} />)
  expect(screen.queryByRole('heading')).toBeNull()
  expect(screen.getByText('1장 새벽').className).toBe('manuscript-heading')
})

it('일부러 만든 긴 줄로 채운 40,000자 원고도 예외 없이 그린다(줄 안 서식의 길이 상한 2,000자)', () => {
  // 한 줄 40,000자는 상한을 넘어 글자 그대로다. 상한이 없으면 겹침이 만 단계가 되어 그리다 죽는다.
  const line = '*'.repeat(39999) + 'a'
  const whole = render(<ManuscriptBody workId={workId} number={2} body={line} />)
  expect(whole.container.querySelector('.manuscript-body')!.textContent).toBe(line)
  expect(whole.container.querySelector('strong, em')).toBeNull()
  // 2,000자 줄 19개 + 1,981자 줄: 줄마다 굵게가 약 500겹이어도 그려진 요소는 겹치지 않는다.
  const body = [...Array<number>(19).fill(2000), 1981].map((n) => '*'.repeat(n - 1) + 'a').join('\n')
  const lines = render(<ManuscriptBody workId={workId} number={2} body={body} />).container.querySelector('.manuscript-body')!
  expect(lines.textContent).toBe([...Array<string>(19).fill('***a'), '****a'].join('\n'))
  expect(lines.querySelectorAll('strong')).toHaveLength(20)
  expect(lines.querySelector('strong strong')).toBeNull()
})

it('이미지는 줄 전체가 표식일 때만 그리고 순번은 그린 이미지끼리 센다', () => {
  render(<ManuscriptBody workId={workId} number={2} body={`글 가운데 ${imageMarker(A)} 표식\n${imageMarker(B)}`} />)
  expect(screen.getAllByRole('img')).toHaveLength(1)
  expect(screen.getByRole('img', { name: '본문 이미지 1' })).toBeTruthy()
  expect(screen.getByText(`글 가운데 ${imageMarker(A)} 표식`)).toBeTruthy()
})
