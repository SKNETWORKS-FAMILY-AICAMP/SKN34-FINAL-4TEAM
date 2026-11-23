// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { newSetting, type StudioSetting, type StudioWorld } from '../../../../domain/entities/studioWorld'
import type { ReviewBasis, ReviewFinding, WorldReview } from '../../../../domain/entities/worldReview'
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
/** 서버가 검토 응답에 싣는 기준: 수정안이 가리킨 카드마다 검토한 초안의 그 카드 글. 시각은 응답의 reviewedAt(로컬 시각 09:05)이다. */
const basisOf = (...rows: StudioSetting[]): ReviewBasis => Object.fromEntries(rows.map((row) => [row.item.id, { body: row.item.text }]))
const reviewOf = (findings: ReviewFinding[], basis: ReviewBasis = {}, over: Partial<WorldReview> = {}): WorldReview =>
  ({ reviewedCards: 2, totalCards: 2, findings, reviewedAt: new Date(2026, 10, 19, 9, 5), basis, ...over })
type Latest = (world: string, signal?: AbortSignal) => Promise<WorldReview | null>
type Props = Parameters<typeof useWorldReview>[0]

/** 훅은 렌더마다 새 대역을 받으면 안 되므로 입력은 한 번만 만들고 rerender로 바꿔 끼운다. */
function setup(
  over: Partial<Props> = {},
  review = vi.fn(async (_world: string, _signal?: AbortSignal) => reviewOf([])),
  latest = vi.fn<Latest>(async () => null), // 기본은 저장된 검토가 아직 없는 세계관(404)이다
) {
  const castle = card('성', '옛 설명'), harbor = card('항구')
  const saved = world('w1', [castle, harbor])
  const patch = vi.fn()
  const initial: Props = { useCase: new WorldReviewUseCase({ review, latest }), saved, editing: structuredClone(saved), unsaved: false, busy: false, patch, ...over }
  const hook = renderHook((props: Props) => useWorldReview(props), { initialProps: initial })
  const ask = async () => {
    act(() => hook.result.current.setConsent(true))
    await act(async () => { await hook.result.current.request() })
  }
  return { ...hook, review, latest, patch, initial, ask, castle, harbor, saved }
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
  const review = vi.fn(async (_world: string, _signal?: AbortSignal) => reviewOf([fixing(castle.item.id)], basisOf(castle)))
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
  const review = vi.fn(async (_world: string, _signal?: AbortSignal) => reviewOf([fixing(castle.item.id)], basisOf(castle)))
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
  const { result, ask } = setup({ saved, editing: structuredClone(saved) }, vi.fn(async () => reviewOf([both], basisOf(castle))))
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
  const { result, patch, ask } = setup({ saved, editing: structuredClone(saved) }, vi.fn(async () => reviewOf([fixing(castle.item.id)], basisOf(castle))))
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
  const { result, patch, rerender, initial, ask } = setup({ saved, editing: structuredClone(saved) }, vi.fn(async () => reviewOf([fixing(castle.item.id)], basisOf(castle))))
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
  const { result, patch, ask } = setup({ saved, editing: structuredClone(saved) }, vi.fn(async () => reviewOf([fixing(castle.item.id)], basisOf(castle))))
  await ask()
  act(() => result.current.decline(0))
  expect(result.current.forCard(castle.item.id)[0].handled).toBe('declined')
  act(() => result.current.apply(0))
  expect(patch).not.toHaveBeenCalled()
})

// ── 마지막 검토 읽기(#555): 서버가 저장한 마지막 검토를 세계관을 읽은 뒤 불러와 검토 직후와 같은 상태로 채운다 ──
const LOAD_FAILED = '지난 검토 결과를 불러오지 못했어요'

it('세계관을 읽으면 서버의 마지막 검토를 한 번 읽어 검토 직후와 같은 상태(요약·시각·지적·수정안)로 채우고, 새로 검토하지는 않는다', async () => {
  const castle = card('성', '옛 설명'), harbor = card('항구', '항구 설명')
  const saved = world('w1', [castle, harbor])
  const stored = reviewOf(
    [fixing(castle.item.id), { cardIds: [harbor.item.id], kind: 'doc_role', message: '역할이 달라요.' }],
    basisOf(castle), { reviewedCards: 2, reviewedAt: new Date(2026, 10, 18, 22, 7) },
  )
  const latest = vi.fn<Latest>(async () => stored)
  const { result, review } = setup({ saved, editing: structuredClone(saved) }, undefined, latest)
  expect(result.current.result).toBeNull() // 읽는 동안은 비어 있다
  await waitFor(() => expect(result.current.result).not.toBeNull())
  expect(latest).toHaveBeenCalledOnce()
  expect(latest).toHaveBeenCalledWith('w1', expect.any(AbortSignal))
  expect(result.current.result).toEqual({ summary: 'AI 의견 2건 · 카드 2장 · 22:07 검토', clock: '22:07', partial: '' }) // 시각은 응답의 reviewedAt이다
  expect(result.current.findings).toEqual(stored.findings)
  expect(result.current.forCard(castle.item.id)[0]).toMatchObject({ id: 0, fix: { name: '설정 본문', state: 'ready', now: '옛 설명', text: '새 설명' } })
  expect(result.current.forCard(harbor.item.id)[0].finding.message).toBe('역할이 달라요.')
  expect(review).not.toHaveBeenCalled()
  expect(result.current.error).toBe('')
  expect(result.current.loadError).toBe('')
})

it('저장된 검토가 아직 없으면(404 → null) 결과도 오류도 없이 요청만 기다린다', async () => {
  const { result, latest } = setup()
  await waitFor(() => expect(latest).toHaveBeenCalledOnce())
  await act(async () => {})
  expect(result.current).toMatchObject({ result: null, findings: [], error: '', loadError: '', lock: '' })
})

it('데모(UseCase 없음)와 세계관을 읽기 전(saved 없음)에는 읽지 않고, 읽은 뒤에는 한 번만 읽는다(같은 세계관의 새 저장본으로 다시 읽지 않는다)', async () => {
  const demo = setup({ useCase: null })
  await act(async () => {})
  expect(demo.latest).not.toHaveBeenCalled()
  const { rerender, initial, latest, saved } = setup({ saved: null, editing: null })
  await act(async () => {})
  expect(latest).not.toHaveBeenCalled()
  rerender({ ...initial, saved, editing: structuredClone(saved) })
  await waitFor(() => expect(latest).toHaveBeenCalledOnce())
  rerender({ ...initial, saved: { ...saved, version: 2 }, editing: structuredClone(saved) })
  await act(async () => {})
  expect(latest).toHaveBeenCalledOnce()
})

it('마지막 검토를 읽지 못하면(404 외) 시트에 알릴 문구만 남기고 결과는 비워 둔 채 화면 사용·새 검토 요청은 막지 않으며, 새 검토가 성공하면 그 문구는 사라진다', async () => {
  const latest = vi.fn<Latest>(async () => { throw new Error('서버가 응답하지 않아요.') })
  const { result, ask } = setup({}, undefined, latest)
  await waitFor(() => expect(result.current.loadError).toBe(LOAD_FAILED))
  expect(result.current).toMatchObject({ result: null, findings: [], error: '', lock: '' }) // 서버가 준 오류 문구는 쓰지 않고, 요청 실패 문구와 섞이지 않는다
  await ask()
  expect(result.current.result).not.toBeNull()
  expect(result.current.loadError).toBe('')
})

it('읽지 못한 뒤의 새 검토 요청이 실패해도 지난 검토를 못 읽었다는 알림은 그대로 남는다', async () => {
  const review = vi.fn(async (_world: string, _signal?: AbortSignal) => reviewOf([]))
  review.mockRejectedValueOnce(new Error('AI 응답이 늦어져 검토하지 못했어요.'))
  const { result, ask } = setup({}, review, vi.fn<Latest>(async () => { throw new Error('x') }))
  await waitFor(() => expect(result.current.loadError).toBe(LOAD_FAILED))
  await ask()
  expect(result.current).toMatchObject({ error: 'AI 응답이 늦어져 검토하지 못했어요.', loadError: LOAD_FAILED, result: null })
})

it('새 검토가 먼저 오면 늦게 도착한 마지막 검토로 덮어쓰지 않는다', async () => {
  let finish!: (review: WorldReview | null) => void
  const latest = vi.fn<Latest>(() => new Promise((resolve) => { finish = resolve }))
  const { result, ask } = setup({}, vi.fn(async () => reviewOf([], {}, { reviewedAt: new Date(2026, 10, 19, 10, 0) })), latest)
  await ask()
  expect(result.current.result?.clock).toBe('10:00')
  await act(async () => finish(reviewOf([], {}, { reviewedAt: new Date(2026, 10, 1, 8, 0) }))) // 옛 검토가 뒤늦게 온다
  expect(result.current.result?.clock).toBe('10:00')
})

it('마지막 검토를 읽는 중에 세계관을 바꾸면 읽기를 취소하고 늦게 온 결과를 새 세계관에 쓰지 않으며, 새 세계관의 검토를 읽는다', async () => {
  const castle = card('성')
  const savedA = world('w1', [castle]), savedB = world('w2', [castle])
  const calls: { world: string; signal?: AbortSignal; finish: (review: WorldReview | null) => void }[] = []
  const latest = vi.fn<Latest>((world, signal) => new Promise((resolve) => { calls.push({ world, signal, finish: resolve }) })) // 취소를 알아도 값을 늦게 돌려주는 가장 나쁜 경우
  const { result, rerender, initial } = setup({ saved: savedA, editing: structuredClone(savedA) }, undefined, latest)
  await waitFor(() => expect(calls).toHaveLength(1))
  rerender({ ...initial, saved: savedB, editing: structuredClone(savedB) })
  await waitFor(() => expect(calls).toHaveLength(2))
  expect(calls.map((c) => c.world)).toEqual(['w1', 'w2'])
  expect(calls[0].signal?.aborted).toBe(true)
  expect(calls[1].signal?.aborted).toBe(false)
  await act(async () => calls[0].finish(reviewOf([fixing(castle.item.id)], basisOf(castle)))) // A의 늦은 결과
  expect(result.current.result).toBeNull()
  expect(result.current.findings).toEqual([])
  await act(async () => calls[1].finish(reviewOf([], {}, { reviewedAt: new Date(2026, 10, 19, 7, 3) })))
  expect(result.current.result?.clock).toBe('07:03')
})

it('세계관 A에서 마지막 검토를 읽지 못한 알림은 B로 바꾸면 사라지고, 취소된 읽기의 거절은 B에 알림을 남기지 않는다', async () => {
  const castle = card('성')
  const savedA = world('w1', [castle]), savedB = world('w2', [castle])
  const latest = vi.fn<Latest>(async (world) => { if (world === 'w1') throw new Error('x'); return null })
  const { result, rerender, initial } = setup({ saved: savedA, editing: structuredClone(savedA) }, undefined, latest)
  await waitFor(() => expect(result.current.loadError).toBe(LOAD_FAILED))
  rerender({ ...initial, saved: savedB, editing: structuredClone(savedB) })
  expect(result.current.loadError).toBe('')
  await waitFor(() => expect(latest).toHaveBeenCalledTimes(2))
  await act(async () => {})
  expect(result.current.loadError).toBe('')
})

it('화면을 벗어나면 읽던 마지막 검토를 취소한다', async () => {
  let signal: AbortSignal | undefined
  const latest = vi.fn<Latest>((_world, given) => new Promise(() => { signal = given }))
  const { unmount } = setup({}, undefined, latest)
  await waitFor(() => expect(signal).toBeDefined())
  expect(signal?.aborted).toBe(false)
  unmount()
  expect(signal?.aborted).toBe(true)
})

it('잠금은 요청 때 화면의 저장본이 아니라 응답의 기준과 견준다: 새로 고친 뒤 기준과 다른 글은 반영하지 않고, 같은 글은 반영한다', async () => {
  const castle = card('성', '서버에서 바뀐 설명') // 새로 고친 뒤 화면이 읽은 지금 글
  const saved = world('w1', [castle])
  const stored = reviewOf([fixing(castle.item.id)], { [castle.item.id]: { body: '검토 때의 설명' } })
  const { result, patch } = setup({ saved, editing: structuredClone(saved) }, undefined, vi.fn<Latest>(async () => stored))
  await waitFor(() => expect(result.current.findings).toHaveLength(1))
  expect(result.current.forCard(castle.item.id)[0].fix).toMatchObject({ state: 'stale', now: '서버에서 바뀐 설명' })
  act(() => result.current.apply(0))
  expect(patch).not.toHaveBeenCalled()
  expect(result.current.forCard(castle.item.id)[0].handled).toBeUndefined()
})

it('방금 받은 검토(POST 직후)도 같은 기준이다: 응답의 기준과 화면의 저장본이 다르면(다른 탭이 저장함) 바로 잠긴다', async () => {
  const castle = card('성', '이 화면이 아는 설명')
  const saved = world('w1', [castle])
  const { result, patch, ask } = setup({ saved, editing: structuredClone(saved) }, vi.fn(async () => reviewOf([fixing(castle.item.id)], { [castle.item.id]: { body: '다른 탭이 저장한 설명' } })))
  await ask()
  expect(result.current.forCard(castle.item.id)[0].fix).toMatchObject({ state: 'stale' })
  act(() => result.current.apply(0))
  expect(patch).not.toHaveBeenCalled()
})

it('지금 초안에 없는 카드의 지적은 보이지 않고 요약의 의견 수에도 세지 않는다(카드를 다시 만들면 다시 보인다)', async () => {
  const castle = card('성', '옛 설명'), gone = card('사라진 카드')
  const saved = world('w1', [castle])
  const both: ReviewFinding = { cardIds: [gone.item.id, castle.item.id], kind: 'contradiction', message: '둘 다 가리켜요.' }
  const stored = reviewOf([fixing(castle.item.id), fixing(gone.item.id, '다른 글'), both], basisOf(castle, gone))
  const { result, rerender, initial } = setup({ saved, editing: structuredClone(saved) }, undefined, vi.fn<Latest>(async () => stored))
  await waitFor(() => expect(result.current.result).not.toBeNull())
  expect(result.current.findings).toEqual([stored.findings[0], both]) // 사라진 카드만 가리킨 지적은 빠진다
  expect(result.current.result?.summary).toMatch(/^AI 의견 2건 · 카드 2장 · /)
  expect(result.current.forCard(castle.item.id).map((f) => f.id)).toEqual([0, 2]) // 번호는 검토가 준 목록의 것이다
  const withGone = world('w1', [castle, gone])
  rerender({ ...initial, saved: withGone, editing: structuredClone(withGone) })
  expect(result.current.findings).toHaveLength(3)
  expect(result.current.result?.summary).toMatch(/^AI 의견 3건/)
})
