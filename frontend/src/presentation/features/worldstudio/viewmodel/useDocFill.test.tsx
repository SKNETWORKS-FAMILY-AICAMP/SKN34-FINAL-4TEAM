// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import type { DocFill, DocFillLine } from '../../../../domain/entities/characterDocs'
import type { StudioWorld } from '../../../../domain/entities/studioWorld'
import { WorldReviewUseCase } from '../../../../domain/usecases/WorldReviewUseCase'
import { useDocFill } from './useDocFill'

afterEach(() => vi.restoreAllMocks())

const BODY: DocFillLine = { target: 'body', kind: 'description', episode: 2, quote: '키가 작고 얼굴이 검게 탔다.' }
const SOUL: DocFillLine = { target: 'soul', kind: 'fact', episode: 4, quote: '가람은 말수가 적다.' }
const fill = (...lines: DocFillLine[]): DocFill => ({ lines, skipped: 0 })
const world = (id: string, linkedWorkId: string | null = 'w1'): StudioWorld => ({ id, name: '세계', description: '', version: 1, settings: [], analysis: null, linkedWorkId })
const unused = async () => { throw new Error('이 테스트는 요청하지 않아요.') }
type Suggest = (world: string, card: string, signal?: AbortSignal) => Promise<DocFill>
type Props = Parameters<typeof useDocFill>[0]

/** 훅은 렌더마다 새 대역을 받으면 안 되므로 입력은 한 번만 만들고 rerender로 바꿔 끼운다. */
function setup(over: Partial<Props> = {}, suggestDocs = vi.fn<Suggest>(async () => fill(BODY, SOUL))) {
  const initial: Props = { useCase: new WorldReviewUseCase({ review: vi.fn(unused), latest: vi.fn(unused), suggestDocs }), saved: world('w1'), unsaved: false, busy: false, ...over }
  const hook = renderHook((props: Props) => useDocFill(props), { initialProps: initial })
  const ask = async (card = 'c1') => {
    act(() => hook.result.current.setConsent(true))
    await act(async () => { await hook.result.current.request(card) })
  }
  return { ...hook, suggestDocs, initial, ask }
}

it('동의하기 전에는 요청하지 않고, 동의한 뒤의 요청은 세계관·카드 id와 취소 신호로 보내 문서별 줄을 낸다', async () => {
  const { result, suggestDocs } = setup()
  await act(async () => { await result.current.request('c1') })
  expect(suggestDocs).not.toHaveBeenCalled()
  expect(result.current.error('c1')).toMatch(/동의/) // 동의 규칙은 UseCase가 지킨다(화면은 동의 전에 버튼을 잠근다)
  expect(result.current.proposal('c1', 'body')).toBeNull()
  act(() => result.current.setConsent(true))
  await act(async () => { await result.current.request('c1') })
  expect(suggestDocs).toHaveBeenCalledOnce()
  expect(suggestDocs).toHaveBeenCalledWith('w1', 'c1', expect.any(AbortSignal))
  expect(result.current.running('c1')).toBe(false)
  expect(result.current.error('c1')).toBe('')
  expect(result.current.proposal('c1', 'body')).toEqual({ lines: [BODY], skipped: 0 })
  expect(result.current.proposal('c1', 'soul')).toEqual({ lines: [SOUL], skipped: 0 })
  expect(result.current.proposal('c2', 'body')).toBeNull() // 다른 카드의 제안이 아니다
})

it('소설이 연결되지 않았거나 저장하지 않은 변경·다른 요청이 있거나 세계관을 아직 못 읽었으면 이유를 주고 요청하지 않으며, 데모는 지원하지 않는다고 답한다', async () => {
  const noLink = setup({ saved: world('w1', null) })
  expect(noLink.result.current.lock).toMatch(/연결된 소설이 없어요/)
  await noLink.ask()
  expect(noLink.suggestDocs).not.toHaveBeenCalled()
  noLink.rerender({ ...noLink.initial, saved: world('w1'), unsaved: true })
  expect(noLink.result.current.lock).toMatch(/저장하지 않은 변경이 있어요/)
  noLink.rerender({ ...noLink.initial, saved: world('w1'), busy: true })
  expect(noLink.result.current.lock).toMatch(/다른 요청이 진행 중/)
  noLink.rerender({ ...noLink.initial, saved: world('w1') })
  expect(noLink.result.current.lock).toBe('')
  expect(setup({ saved: null }).result.current.lock).toMatch(/불러온 뒤/)
  const demo = setup({ useCase: null })
  expect(demo.result.current.lock).toBe('데모에서는 지원하지 않아요.')
  await demo.ask()
  expect(demo.result.current.proposal('c1', 'body')).toBeNull()
})

it('실패하면 서버 문구를 그 카드의 error로 남기고 제안을 만들지 않으며, 다시 성공하면 error가 사라진다', async () => {
  const suggestDocs = vi.fn<Suggest>(async () => fill(BODY))
  suggestDocs.mockRejectedValueOnce(new Error('이 세계관에 연결된 소설이 없어 원고에서 근거를 찾을 수 없어요.'))
  const { result, ask } = setup({}, suggestDocs)
  await ask()
  expect(result.current.error('c1')).toBe('이 세계관에 연결된 소설이 없어 원고에서 근거를 찾을 수 없어요.')
  expect(result.current.error('c2')).toBe('')
  expect(result.current.proposal('c1', 'body')).toBeNull()
  expect(result.current.running('c1')).toBe(false)
  await act(async () => { await result.current.request('c1') })
  expect(result.current.error('c1')).toBe('')
  expect(result.current.proposal('c1', 'body')?.lines).toEqual([BODY])
})

it('근거가 없는 제안은 null이 아니라 줄이 없는 제안이다(요청 전과 구별한다)', async () => {
  const { result, ask } = setup({}, vi.fn<Suggest>(async () => ({ lines: [], skipped: 0 })))
  expect(result.current.proposal('c1', 'body')).toBeNull()
  await ask()
  expect(result.current.proposal('c1', 'body')).toEqual({ lines: [], skipped: 0 })
  expect(result.current.proposal('c1', 'soul')).toEqual({ lines: [], skipped: 0 })
})

it('문서의 제안을 처리하면 그 문서의 줄만 사라지고, 다른 문서의 줄은 남는다', async () => {
  const { result, ask } = setup()
  await ask()
  act(() => result.current.settle('c1', 'body'))
  expect(result.current.proposal('c1', 'body')).toBeNull()
  expect(result.current.proposal('c1', 'soul')?.lines).toEqual([SOUL])
  act(() => result.current.settle('c2', 'soul')) // 다른 카드의 처리는 영향이 없다
  expect(result.current.proposal('c1', 'soul')?.lines).toEqual([SOUL])
})

it('다른 카드를 요청하면 이전 카드의 제안을 대신하고, 요청 중에는 같은 요청을 한 번만 보낸다', async () => {
  let release: (value: DocFill) => void = () => undefined
  const suggestDocs = vi.fn<Suggest>(() => new Promise<DocFill>((resolve) => { release = resolve }))
  const { result } = setup({}, suggestDocs)
  act(() => result.current.setConsent(true))
  let first: Promise<void> = Promise.resolve()
  act(() => { first = result.current.request('c1'); void result.current.request('c1') })
  expect(suggestDocs).toHaveBeenCalledOnce()
  expect(result.current.running('c1')).toBe(true)
  expect(result.current.running('c2')).toBe(false)
  expect(result.current.lock).toMatch(/다른 요청이 진행 중/)
  await act(async () => { release(fill(BODY)); await first })
  expect(result.current.running('c1')).toBe(false)
  expect(result.current.proposal('c1', 'body')?.lines).toEqual([BODY])
  suggestDocs.mockResolvedValueOnce(fill(SOUL))
  await act(async () => { await result.current.request('c2') })
  expect(result.current.proposal('c2', 'soul')?.lines).toEqual([SOUL])
  expect(result.current.proposal('c1', 'body')).toBeNull()
})

it('세계관이 바뀌면 실패와 제안을 지운다', async () => {
  const { result, rerender, initial, ask } = setup()
  await ask()
  expect(result.current.proposal('c1', 'body')).not.toBeNull()
  rerender({ ...initial, saved: world('w2') })
  expect(result.current.proposal('c1', 'body')).toBeNull()
  expect(result.current.error('c1')).toBe('')
})
