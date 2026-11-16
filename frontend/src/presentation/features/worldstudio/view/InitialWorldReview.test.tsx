// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { currentCandidate, type Analysis, type Candidate, type Decision } from '../../../../domain/entities/initialWorld'
import type { useWorldStudioViewModel } from '../viewmodel/useWorldStudioViewModel'
import { ReviewBody, type Review } from './InitialWorldReview'

afterEach(cleanup)

type Studio = ReturnType<typeof useWorldStudioViewModel>
const candidate = (localRef: string, over: Partial<Candidate> = {}): Candidate => ({
  localRef, type: 'fact', title: `후보 ${localRef}`, text: `${localRef} 내용`, subjectId: null, relatedEntityIds: [], provenance: 'ai_extraction',
  evidence: [{ sourceId: 'w:description', start: 0, end: 3, quote: `${localRef} 근거 문장`, quoteHash: 'h' }], relation: null, condition: '', timeText: '', polarity: 'asserted', ...over,
})
const decision = (c: Candidate, sequence: number, state: Decision['state']): Decision => ({ candidateId: `id-${c.localRef}`, candidateRef: c.localRef, sequence, state, content: c })
const analysisOf = (candidates: Candidate[], decisions: Decision[] = [], over: Partial<Analysis> = {}): Analysis => ({
  analysisId: 'a1', basis: { draftRevision: 2, relationshipVersion: 1, currentRevisionId: null, inputHash: 'h' }, executionStatus: 'completed', freshness: 'current',
  output: { schemaVersion: 'initial-world.v1', candidates, diagnostics: [] }, candidateIds: Object.fromEntries(candidates.map((c) => [c.localRef, `id-${c.localRef}`])), decisions, ...over,
})
const review = (analysis?: Analysis, over: Partial<Review> = {}): Review => ({
  analyses: analysis ? [analysis] : [], analysis, busy: false, error: '', message: '', pending: false, receipt: null, demo: false,
  select: vi.fn(), analyze: vi.fn(async () => undefined), refresh: vi.fn(async () => undefined), recover: vi.fn(async () => undefined),
  decide: vi.fn(async () => undefined), apply: vi.fn(async () => undefined),
  current: (c: Candidate) => (analysis ? currentCandidate(analysis, c) : null),
  ...over,
})
const studio = (over: Record<string, unknown> = {}) => ({ dirty: false, relationDirty: false, saved: { id: 'w', version: 2, settings: [], analysis: null }, ...over }) as unknown as Studio
const card = (title: string) => within(screen.getByRole('heading', { name: title }).closest('article')!)
const titles = () => screen.getAllByRole('heading', { level: 4 }).map((h) => h.textContent)

it('상태 필터 칩이 검토 대기·승인·거절 수를 보이고 기본은 검토 대기이며 칩을 누르면 그 후보만 보이고, 보류는 검토 대기에 든다', () => {
  const [a, b, c, d] = ['a', 'b', 'c', 'd'].map((ref) => candidate(ref))
  render(<ReviewBody studio={studio()} vm={review(analysisOf([a, b, c, d], [decision(b, 1, 'approved'), decision(c, 1, 'rejected'), decision(d, 1, 'held')]))} />)
  const chips = () => within(screen.getByRole('group', { name: '후보 상태' }))
  expect(chips().getAllByRole('button').map((x) => x.textContent)).toEqual(['검토 대기 2', '승인 1', '거절 1'])
  expect(chips().getByRole('button', { name: '검토 대기 2' }).getAttribute('aria-pressed')).toBe('true')
  expect(titles()).toEqual(['후보 a', '후보 d'])
  expect(card('후보 d').getByText('보류', { selector: '.chip' })).toBeTruthy()
  expect(card('후보 d').queryByRole('button', { name: '보류' })).toBeNull() // 이미 보류한 후보에는 보류 버튼이 없다
  fireEvent.click(chips().getByRole('button', { name: '승인 1' }))
  expect(titles()).toEqual(['후보 b'])
  expect(card('후보 b').queryByRole('button', { name: '승인' })).toBeNull() // 이미 승인한 후보에는 승인이 없다
  expect(card('후보 b').getByRole('button', { name: '거절' })).toBeTruthy()
  fireEvent.click(chips().getByRole('button', { name: '거절 1' }))
  expect(titles()).toEqual(['후보 c'])
  expect(card('후보 c').getByRole('button', { name: '승인' })).toBeTruthy() // 거절을 번복할 수 있다
  expect(card('후보 c').queryByRole('button', { name: '거절' })).toBeNull()
})

it('후보 카드는 분류 칩·이름·내용·누가 쓴 내용인지를 보이고 근거는 근거 보기에 접어 두며 하단에 승인·거절·보류·내용 수정을 둔다', () => {
  const ai = candidate('a', { type: 'relation' })
  const mine = candidate('b', { provenance: 'author_revision', title: '내가 고친 후보' })
  render(<ReviewBody studio={studio()} vm={review(analysisOf([ai, mine], [decision(mine, 1, 'pending')]))} />)
  const first = card('후보 a')
  expect(first.getByText('관계', { selector: '.chip' })).toBeTruthy()
  expect(first.getByText('AI가 제안한 내용')).toBeTruthy()
  expect(first.getAllByText('a 내용')[0].className).toContain('initial-clamp') // 카드의 내용은 3줄까지만 보이고(전체와 원래 제안은 근거 보기 안에도 있다)
  expect(first.getByText('근거 보기').closest('details')?.open).toBe(false)
  expect(first.getByText('a 근거 문장')).toBeTruthy()
  expect(Array.from(first.getAllByRole('button'), (b) => b.textContent)).toEqual(['승인', '거절', '보류', '내용 수정'])
  expect(first.getByRole('button', { name: '보류' }).className).toContain('initial-hold') // 보류는 보조 스타일
  expect(first.getByRole('button', { name: '승인' }).className).toContain('pri')
  expect(card('내가 고친 후보').getByText('작가가 수정한 내용')).toBeTruthy()
})

it('승인·거절하면 다음 후보로 초점이 가고, 마지막이면 앞 후보로, 모두 처리하면 안내로 간다', async () => {
  const [a, b] = [candidate('a'), candidate('b')]
  const decide = vi.fn(async () => undefined)
  const view = render(<ReviewBody studio={studio()} vm={review(analysisOf([a, b]), { decide })} />)
  const approve = card('후보 a').getByRole('button', { name: '승인' })
  approve.focus()
  fireEvent.click(approve)
  expect(decide).toHaveBeenCalledWith(a, 'approve', null, '')
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: '후보 b' })))
  const reject = card('후보 b').getByRole('button', { name: '거절' })
  reject.focus()
  fireEvent.click(reject)
  expect(decide).toHaveBeenLastCalledWith(b, 'reject', null, '')
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: '후보 a' }))) // 뒤에 후보가 없으면 앞 후보
  // 마지막 후보를 처리해 목록이 비면 그 안내가 초점을 받는다
  decide.mockImplementation(async () => { view.rerender(<ReviewBody studio={studio()} vm={review(analysisOf([a], [decision(a, 1, 'approved')]), { decide })} />) })
  const last = card('후보 a').getByRole('button', { name: '승인' })
  last.focus()
  view.rerender(<ReviewBody studio={studio()} vm={review(analysisOf([a]), { decide })} />)
  fireEvent.click(screen.getByRole('button', { name: '승인' }))
  await waitFor(() => expect(document.activeElement).toBe(screen.getByText('검토할 후보를 모두 처리했어요.')))
})

it('보류는 결정 요청을 hold로 보내고 검토 대기에 남으므로 초점은 다음 후보로, 하나뿐이면 그 카드에 간다', async () => {
  const [a, b] = [candidate('a'), candidate('b')]
  const decide = vi.fn(async () => undefined)
  const view = render(<ReviewBody studio={studio()} vm={review(analysisOf([a, b]), { decide })} />)
  const hold = card('후보 a').getByRole('button', { name: '보류' })
  hold.focus()
  fireEvent.click(hold)
  expect(decide).toHaveBeenCalledWith(a, 'hold', null, '')
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: '후보 b' })))
  view.rerender(<ReviewBody studio={studio()} vm={review(analysisOf([a]), { decide })} />)
  const only = card('후보 a').getByRole('button', { name: '보류' })
  only.focus()
  fireEvent.click(only)
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { name: '후보 a' }))) // 보류한 카드는 검토 대기에 그대로 있다
})

it('결정을 저장하는 사이 사용자가 초점을 옮겼으면 그 초점을 뺏지 않는다', async () => {
  const [a, b] = [candidate('a'), candidate('b')]
  const decide = vi.fn(async () => { screen.getByRole('button', { name: '결과 새로 확인' }).focus() })
  render(<ReviewBody studio={studio()} vm={review(analysisOf([a, b]), { decide })} />)
  const approve = card('후보 a').getByRole('button', { name: '승인' })
  approve.focus()
  fireEvent.click(approve)
  await waitFor(() => expect(decide).toHaveBeenCalled())
  await new Promise((resolve) => setTimeout(resolve))
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '결과 새로 확인' }))
})

it('승인한 후보가 있으면 목록 위 고정 바가 승인한 후보 수와 함께 초안에 반영하고, 작성 중 입력이 있거나 반영 완료한 후보는 세지 않는다', () => {
  const [a, b, c] = ['a', 'b', 'c'].map((ref) => candidate(ref))
  const apply = vi.fn(async () => undefined)
  const decisions = [decision(a, 1, 'approved'), decision(b, 1, 'approved')]
  const view = render(<ReviewBody studio={studio()} vm={review(analysisOf([a, b, c], decisions), { apply })} />)
  fireEvent.click(screen.getByRole('button', { name: '승인한 후보 2개 초안에 반영' }))
  expect(apply).toHaveBeenCalledWith(['id-a', 'id-b'])
  view.rerender(<ReviewBody studio={studio({ dirty: true })} vm={review(analysisOf([a, b, c], decisions), { apply })} />)
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '승인한 후보 2개 초안에 반영' }).disabled).toBe(true) // 먼저 저장해야 한다
  const reflected = { id: 'w', version: 3, analysis: null, settings: [{ serverMetadata: { preprocessing: { candidateId: 'id-a' } } }] }
  view.rerender(<ReviewBody studio={studio({ saved: reflected })} vm={review(analysisOf([a, b, c], decisions), { apply })} />)
  expect(screen.getByRole('button', { name: '승인한 후보 1개 초안에 반영' })).toBeTruthy()
  view.rerender(<ReviewBody studio={studio()} vm={review(analysisOf([a, b, c], [decision(b, 1, 'rejected')]), { apply })} />)
  expect(screen.queryByRole('button', { name: /초안에 반영/ })).toBeNull() // 승인한 후보가 없으면 바가 없다
})

it('분석이 없으면 설명 한 줄과 AI 분석 요청만 보이고, 저장한 초안이 없거나 작성 중이거나 요청 중이면 잠그며 저장부터 하라고 알린다', () => {
  const analyze = vi.fn(async () => undefined)
  const view = render(<ReviewBody studio={studio()} vm={review(undefined, { analyze })} />)
  expect(screen.queryByRole('group', { name: '후보 상태' })).toBeNull() // 칩도 다시 요청도 없다
  expect(screen.queryByRole('button', { name: 'AI 분석 다시 요청' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'AI 분석 요청' }))
  expect(analyze).toHaveBeenCalledOnce()
  const request = () => screen.getByRole<HTMLButtonElement>('button', { name: 'AI 분석 요청' })
  view.rerender(<ReviewBody studio={studio({ saved: { id: 'w', version: 0, settings: [], analysis: null } })} vm={review(undefined, { analyze })} />)
  expect(request().disabled).toBe(true)
  expect(screen.getByText('먼저 세계관을 저장하세요.')).toBeTruthy()
  expect(request().getAttribute('aria-describedby')).toBe(screen.getByText('먼저 세계관을 저장하세요.').id)
  view.rerender(<ReviewBody studio={studio({ saved: null })} vm={review(undefined, { analyze })} />)
  expect(request().disabled).toBe(true)
  view.rerender(<ReviewBody studio={studio({ dirty: true })} vm={review(undefined, { analyze })} />)
  expect(request().disabled).toBe(true)
  expect(screen.getByText('작성 중인 입력이 있어요. 먼저 저장해 주세요.')).toBeTruthy()
  view.rerender(<ReviewBody studio={studio()} vm={review(undefined, { analyze, busy: true })} />)
  expect(screen.queryByRole('button', { name: 'AI 분석 요청' })).toBeNull() // 불러오는 중에는 빈 상태를 보이지 않는다
})

it('상단의 AI 분석 다시 요청과 결과 새로 확인은 기존 요청 동작을 부르고, 내용 수정은 폼을 열어 수정본을 작가 수정으로 보낸다', async () => {
  const a = candidate('a')
  const { analyze, refresh, decide } = review(analysisOf([a]))
  render(<ReviewBody studio={studio()} vm={review(analysisOf([a]), { analyze, refresh, decide })} />)
  fireEvent.click(screen.getByRole('button', { name: 'AI 분석 다시 요청' }))
  fireEvent.click(screen.getByRole('button', { name: '결과 새로 확인' }))
  expect([analyze, refresh].map((fn) => vi.mocked(fn).mock.calls.length)).toEqual([1, 1])
  const edit = card('후보 a').getByRole('button', { name: '내용 수정' })
  expect(edit.getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(edit)
  expect(edit.getAttribute('aria-expanded')).toBe('true')
  const form = within(screen.getByRole('form', { name: '후보 내용 수정' }))
  fireEvent.change(form.getByRole('textbox', { name: '후보 내용' }), { target: { value: '고친 내용' } })
  fireEvent.click(form.getByRole('button', { name: '수정본 저장 · 재승인 필요' }))
  await waitFor(() => expect(decide).toHaveBeenCalledWith(a, 'edit', expect.objectContaining({ text: '고친 내용', provenance: 'author_revision', evidence: [] }), ''))
  await waitFor(() => expect(screen.queryByRole('form', { name: '후보 내용 수정' })).toBeNull())
})

it('원본이 바뀌었거나 분석이 끝나지 않았거나 요청 중이면 결정 버튼을 잠그고, 오류·복구 상태는 가짜 성공 없이 그대로 보인다', () => {
  const a = candidate('a')
  const recover = vi.fn(async () => undefined)
  const view = render(<ReviewBody studio={studio()} vm={review(analysisOf([a], [], { freshness: 'stale' }))} />)
  expect(card('후보 a').getByRole<HTMLButtonElement>('button', { name: '승인' }).disabled).toBe(true)
  expect(screen.getByText(/원본이 변경되어 새 검토·반영은 할 수 없어요/)).toBeTruthy()
  view.rerender(<ReviewBody studio={studio()} vm={review(analysisOf([a], [], { executionStatus: 'running' }))} />)
  expect(card('후보 a').getByRole<HTMLButtonElement>('button', { name: '거절' }).disabled).toBe(true)
  view.rerender(<ReviewBody studio={studio()} vm={review(analysisOf([a]), { error: '조회 실패', pending: true, recover })} />)
  expect(screen.getByRole('alert').textContent).toBe('조회 실패')
  expect(card('후보 a').getByRole<HTMLButtonElement>('button', { name: '승인' }).disabled).toBe(true) // 같은 요청 확인 전에는 새 결정을 막는다
  fireEvent.click(screen.getByRole('button', { name: '같은 요청으로 확인·복구' }))
  expect(recover).toHaveBeenCalledOnce()
})

it('목업에서는 실제 분석을 요청할 수 없다고 알리고 저장한 후보를 읽기 전용 카드로만 보인다', () => {
  render(<ReviewBody studio={studio()} vm={review(undefined, { demo: true })} />)
  expect(screen.getByText(/목업 모드는 실제 AI 분석·검토 저장·초안 반영을 지원하지 않아요/)).toBeTruthy()
  expect(screen.getByRole<HTMLButtonElement>('button', { name: /AI 분석 요청/ }).disabled).toBe(true)
  expect(screen.getByText('저장된 AI 후보가 없어요.')).toBeTruthy()
})
