// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { StoryQaPanel } from './StoryQaPanel'

const ask = vi.hoisted(() => vi.fn())
vi.mock('../../../app/appContainer', () => ({ appContainer: { resolve: () => ({ askStoryContext: ask }) } }))
afterEach(() => { cleanup(); ask.mockReset() })

it('requires consent and renders a cited answer and a gap', async () => {
  ask.mockResolvedValue({
    status: 'partial', claims: [{ text: '용이 나타났어요.', kind: 'confirmed', sourceIds: ['a'] }],
    sources: [{ id: 'a', kind: 'manuscript', episode: 2, versionId: 'v2', quote: '용이 나타났다.' }],
    gaps: [{ code: 'INSUFFICIENT_EVIDENCE', detail: '용이 온 이유는 알 수 없어요.' }],
    coverage: { expected: [], withVerifiedExcerpt: [], withoutVerifiedExcerpt: [] },
  })
  render(<StoryQaPanel workId="w" episode={2} versionId="v2" />)
  const details = screen.getByText('작품에 질문하기').closest('details')!
  details.open = true
  fireEvent.change(screen.getByLabelText('질문'), { target: { value: '누가 나타났나요?' } })
  const submit = screen.getByRole('button', { name: '질문 보내기' })
  expect((submit as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(submit)
  expect(ask).toHaveBeenCalledWith('w', { episode: 2, episodeVersionId: 'v2', question: '누가 나타났나요?', consent: true, target: 'manuscript' }, false, expect.any(AbortSignal))
  expect(await screen.findByText('용이 나타났어요.')).toBeTruthy()
  expect(screen.getByText('용이 나타났다.')).toBeTruthy()
  expect(screen.getByText('용이 온 이유는 알 수 없어요.')).toBeTruthy()
})


it('does not carry a relationship answer or selection into a reader context', async () => {
  ask.mockResolvedValue({
    status: 'answered', claims: [{ text: '작가 전용 답변', kind: 'confirmed', sourceIds: [] }],
    sources: [], gaps: [], coverage: { expected: [], withVerifiedExcerpt: [], withoutVerifiedExcerpt: [] },
  })
  const { rerender } = render(<StoryQaPanel workId="w" episode={2} versionId="v2" owner />)
  screen.getByText('작품에 질문하기').closest('details')!.open = true
  fireEvent.change(screen.getByLabelText('질문 대상'), { target: { value: 'relationship' } })
  fireEvent.change(screen.getByLabelText('질문'), { target: { value: '두 사람의 관계는?' } })
  fireEvent.click(screen.getByRole('checkbox'))
  fireEvent.click(screen.getByRole('button', { name: '질문 보내기' }))
  expect(await screen.findByText('작가 전용 답변')).toBeTruthy()

  rerender(<StoryQaPanel workId="w" episode={3} versionId="v3" />)
  expect(screen.queryByText('작가 전용 답변')).toBeNull()
  expect((screen.getByLabelText('질문 대상') as HTMLSelectElement).value).toBe('manuscript')
})
