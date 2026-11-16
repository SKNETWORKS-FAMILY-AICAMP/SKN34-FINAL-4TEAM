// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { newSetting, type StudioSetting, type StudioWorld } from '../../../../domain/entities/studioWorld'
import type { ReviewFinding, WorldReview } from '../../../../domain/entities/worldReview'
import { WorldReviewUseCase } from '../../../../domain/usecases/WorldReviewUseCase'
import { useWorldReview } from './useWorldReview'

afterEach(() => vi.restoreAllMocks())

const card = (title: string, text = `${title} 설명`): StudioSetting => {
  const row = newSetting('places')
  row.item.title = title
  row.item.text = text
  return row
}
const world = (id: string, settings: StudioSetting[]): StudioWorld => ({ id, name: '세계', description: '', version: 1, settings, analysis: null })
const reviewOf = (findings: ReviewFinding[]): WorldReview => ({ reviewedCards: 2, totalCards: 2, findings })
type Props = Parameters<typeof useWorldReview>[0]

/** 훅은 렌더마다 새 대역을 받으면 안 되므로 입력은 한 번만 만들고 rerender로 바꿔 끼운다. */
function setup(over: Partial<Props> = {}, review = vi.fn(async (_world: string, _signal?: AbortSignal) => reviewOf([]))) {
  const castle = card('성', '옛 설명'), harbor = card('항구')
  const saved = world('w1', [castle, harbor])
  const patch = vi.fn()
  const initial: Props = { useCase: new WorldReviewUseCase({ review }), saved, editing: structuredClone(saved), unsaved: false, busy: false, patch, ...over }
  const hook = renderHook((props: Props) => useWorldReview(props), { initialProps: initial })
  const ask = async () => {
    act(() => hook.result.current.setConsent(true))
    await act(async () => { await hook.result.current.request() })
  }
  return { ...hook, review, patch, initial, ask, castle, harbor, saved }
}
const fixing = (cardId: string, text = '새 설명'): ReviewFinding => ({ cardIds: [cardId], kind: 'missing_info', message: '설명이 비었어요.', fix: { cardId, target: 'body', text } })

it('동의하기 전에는 요청하지 않고, 동의한 뒤의 요청은 세계관 id와 취소 신호로 보내 결과와 요약을 낸다', async () => {
  const { result, review } = setup()
  await act(async () => { await result.current.request() })
  expect(review).not.toHaveBeenCalled()
  expect(result.current.error).toMatch(/동의/) // 동의 규칙은 UseCase가 지킨다(화면은 동의 전에 버튼을 잠근다)
  expect(result.current.result).toBeNull()
  act(() => result.current.setConsent(true))
  await act(async () => { await result.current.request() })
  expect(review).toHaveBeenCalledOnce()
  expect(review).toHaveBeenCalledWith('w1', expect.any(AbortSignal))
  expect(result.current.running).toBe(false)
  expect(result.current.result?.summary).toMatch(/^AI 의견 0건 · 카드 2장 · \d{2}:\d{2} 검토$/)
  expect(result.current.findings).toEqual([])
})

it('저장하지 않은 변경·다른 요청 진행 중에는 이유를 주고 요청하지 않으며, 데모(UseCase 없음)는 지원하지 않는다고 답한다', async () => {
  const unsaved = setup({ unsaved: true })
  expect(unsaved.result.current.lock).toMatch(/저장하지 않은 변경이 있어요/)
  await unsaved.ask()
  expect(unsaved.review).not.toHaveBeenCalled()
  unsaved.rerender({ ...unsaved.initial, unsaved: false })
  expect(unsaved.result.current.lock).toBe('')
  unsaved.rerender({ ...unsaved.initial, unsaved: false, busy: true })
  expect(unsaved.result.current.lock).toMatch(/다른 요청이 진행 중/)
  const demo = setup({ useCase: null })
  expect(demo.result.current).toMatchObject({ demo: true, lock: '데모에서는 지원하지 않아요.' })
  await demo.ask()
  expect(demo.result.current.result).toBeNull()
})

it('실패하면 서버 문구를 error로 남기고 결과를 만들지 않으며, 다시 성공하면 error가 사라진다', async () => {
  const review = vi.fn(async (_world: string, _signal?: AbortSignal) => reviewOf([]))
  review.mockRejectedValueOnce(new Error('AI 응답이 늦어져 검토하지 못했어요.'))
  const { result, ask } = setup({}, review)
  await ask()
  expect(result.current.error).toBe('AI 응답이 늦어져 검토하지 못했어요.')
  expect(result.current.result).toBeNull()
  expect(result.current.running).toBe(false)
  await act(async () => { await result.current.request() })
  expect(result.current.error).toBe('')
  expect(result.current.result).not.toBeNull()
})

it('세계관이 바뀌면 검토 결과를 지운다', async () => {
  const castle = card('성')
  const review = vi.fn(async (_world: string, _signal?: AbortSignal) => reviewOf([fixing(castle.item.id)]))
  const saved = world('w1', [castle])
  const { result, rerender, initial, ask } = setup({ saved, editing: structuredClone(saved) }, review)
  await ask()
  expect(result.current.findings).toHaveLength(1)
  const other = world('w2', [castle])
  rerender({ ...initial, saved: other, editing: structuredClone(other) })
  expect(result.current.result).toBeNull()
  expect(result.current.findings).toEqual([])
  expect(result.current.forCard(castle.item.id)).toEqual([])
})

it('세계관 A에서 요청이 실패한 뒤 B로 바꾸면 A의 실패 문구가 사라진다', async () => {
  const castle = card('성')
  const review = vi.fn(async (_world: string, _signal?: AbortSignal) => reviewOf([]))
  review.mockRejectedValueOnce(new Error('AI 응답이 늦어져 검토하지 못했어요.'))
  const savedA = world('w1', [castle]), savedB = world('w2', [castle])
  const { result, rerender, initial, ask } = setup({ saved: savedA, editing: structuredClone(savedA) }, review)
  await ask()
  expect(result.current.error).toBe('AI 응답이 늦어져 검토하지 못했어요.')
  rerender({ ...initial, saved: savedB, editing: structuredClone(savedB) })
  expect(result.current.error).toBe('') // B의 시트에 A의 실패 문구와 '다시 시도'가 남지 않는다
})

it('세계관 A에서 받은 결과는 B로 바꿨다가 A로 돌아와도 되살아나지 않는다', async () => {
  const castle = card('성')
  const review = vi.fn(async (_world: string, _signal?: AbortSignal) => reviewOf([fixing(castle.item.id)]))
  const savedA = world('w1', [castle]), savedB = world('w2', [castle])
  const { result, rerender, initial, ask } = setup({ saved: savedA, editing: structuredClone(savedA) }, review)
  await ask()
  expect(result.current.findings).toHaveLength(1)
  rerender({ ...initial, saved: savedB, editing: structuredClone(savedB) })
  rerender(initial) // 다시 A다
  expect(result.current.result).toBeNull()
  expect(result.current.findings).toEqual([])
  expect(result.current.forCard(castle.item.id)).toEqual([])
})

it('A에서 요청 중에 B로 바꾸면 요청을 취소해 진행을 풀고, 취소된 요청의 거절이나 늦은 결과를 B의 오류·결과로 남기지 않는다', async () => {
  const castle = card('성')
  let signal: AbortSignal | undefined
  const review = vi.fn((_world: string, given?: AbortSignal) => new Promise<WorldReview>((_, reject) => {
    signal = given
    given?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))) // 진짜 fetch는 취소되면 이렇게 거절한다
  }))
  const savedA = world('w1', [castle]), savedB = world('w2', [castle])
  const { result, rerender, initial } = setup({ saved: savedA, editing: structuredClone(savedA) }, review)
  act(() => result.current.setConsent(true))
  act(() => { void result.current.request() })
  expect(result.current.running).toBe(true)
  await act(async () => { rerender({ ...initial, saved: savedB, editing: structuredClone(savedB) }) })
  expect(signal?.aborted).toBe(true)
  expect(result.current.running).toBe(false)
  expect(result.current.error).toBe('') // 취소로 거절된 요청이 B에 오류를 남기지 않는다
  expect(result.current.result).toBeNull()
})

it('요청 중에 화면을 벗어나면 요청을 취소한다', async () => {
  let signal: AbortSignal | undefined
  const review = vi.fn((_world: string, given?: AbortSignal) => new Promise<WorldReview>(() => { signal = given }))
  const { result, unmount } = setup({}, review)
  act(() => result.current.setConsent(true))
  act(() => { void result.current.request() })
  expect(result.current.running).toBe(true)
  await act(async () => { await result.current.request() }) // 진행 중의 두 번째 요청은 보내지 않는다
  expect(review).toHaveBeenCalledOnce()
  unmount()
  expect(signal?.aborted).toBe(true)
})

it('forCard는 그 카드를 가리킨 지적에 반영 여부·관련 설정·수정안(지금 글·상태)을 붙인다', async () => {
  const castle = card('성', '옛 설명'), harbor = card('항구', '항구 설명')
  const saved = world('w1', [castle, harbor])
  const both: ReviewFinding = { cardIds: [castle.item.id, harbor.item.id], kind: 'contradiction', message: '어긋나요.', fix: { cardId: castle.item.id, target: 'body', text: '새 설명' } }
  const { result, ask } = setup({ saved, editing: structuredClone(saved) }, vi.fn(async () => reviewOf([both])))
  await ask()
  const [mine] = result.current.forCard(castle.item.id)
  expect(mine).toMatchObject({ id: 0, finding: both, related: [{ id: harbor.item.id, title: '항구' }], fix: { name: '설정 본문', state: 'ready', now: '옛 설명', text: '새 설명' } })
  expect(mine.fixIn).toBeUndefined()
  const [other] = result.current.forCard(harbor.item.id)
  expect(other.fix).toBeUndefined()
  expect(other).toMatchObject({ related: [{ id: castle.item.id, title: '성' }], fixIn: { id: castle.item.id, title: '성' } })
})

it('초안에 반영은 그 칸만 바꾼 설정을 patch로 넘기고 반영함으로 표시하며, 같은 지적은 두 번 반영하지 않는다', async () => {
  const castle = card('성', '옛 설명')
  const saved = world('w1', [castle])
  const { result, patch, ask } = setup({ saved, editing: structuredClone(saved) }, vi.fn(async () => reviewOf([fixing(castle.item.id)])))
  await ask()
  act(() => result.current.apply(0))
  expect(patch).toHaveBeenCalledOnce()
  expect(patch.mock.calls[0][0].settings[0].item.text).toBe('새 설명')
  expect(result.current.forCard(castle.item.id)[0].handled).toBe('applied')
  act(() => result.current.apply(0))
  expect(patch).toHaveBeenCalledOnce()
})

it('검토 뒤에 그 칸의 글이 바뀌었거나 저장 같은 요청이 진행 중이면 반영하지 않는다', async () => {
  const castle = card('성', '옛 설명')
  const saved = world('w1', [castle])
  const { result, patch, rerender, initial, ask } = setup({ saved, editing: structuredClone(saved) }, vi.fn(async () => reviewOf([fixing(castle.item.id)])))
  await ask()
  const edited = structuredClone(saved)
  edited.settings[0].item.text = '내가 고친 설명'
  rerender({ ...initial, editing: edited })
  expect(result.current.forCard(castle.item.id)[0].fix).toMatchObject({ state: 'stale', now: '내가 고친 설명' })
  act(() => result.current.apply(0))
  expect(patch).not.toHaveBeenCalled()
  expect(result.current.forCard(castle.item.id)[0].handled).toBeUndefined()
  rerender({ ...initial, busy: true })
  act(() => result.current.apply(0))
  expect(patch).not.toHaveBeenCalled()
  const gone = structuredClone(saved)
  gone.settings = []
  rerender({ ...initial, editing: gone })
  expect(result.current.forCard(castle.item.id)[0].fix).toMatchObject({ state: 'missing' })
})

it('반영하지 않기는 초안을 바꾸지 않고 그 지적을 반영하지 않음으로 남기며 그 뒤에는 반영할 수 없다', async () => {
  const castle = card('성', '옛 설명')
  const saved = world('w1', [castle])
  const { result, patch, ask } = setup({ saved, editing: structuredClone(saved) }, vi.fn(async () => reviewOf([fixing(castle.item.id)])))
  await ask()
  act(() => result.current.decline(0))
  expect(result.current.forCard(castle.item.id)[0].handled).toBe('declined')
  act(() => result.current.apply(0))
  expect(patch).not.toHaveBeenCalled()
})
