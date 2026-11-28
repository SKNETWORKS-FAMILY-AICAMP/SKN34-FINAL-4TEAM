// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { ChatReply } from '../../../domain/entities/writingChat'
import { useProposalStageViewModel } from './useProposalStageViewModel'
import type { ChatViewModel } from './useWritingChatViewModel'

const waiting: ChatReply = { status: 'waiting', missingInputs: [], awaitingApproval: 'writing_editing', approvalEpisode: 3,
  steps: [{ feature: 'writing_editing', task: 'draft', status: 'completed', result: { text: '새 장면' } }] }
const chat = (turns: number, reply: ChatReply | null, threadId = 't1') =>
  ({ threadId, turns: Array.from({ length: turns }, () => ({ request: '요청' })), waiting: reply }) as unknown as ChatViewModel
const draft = { number: 3, body: '원고' }

describe('useProposalStageViewModel', () => {
  it('보일 승인 제안이 오면 저절로 열린다', () => {
    const { result } = renderHook(() => useProposalStageViewModel(chat(1, waiting), draft))
    expect(result.current.open).toBe(true)
  })

  it('작가가 편집기에 쓰는 중이면 저절로 열지 않는다(편집기를 가려 입력을 잃지 않게). 링크로는 열 수 있다', () => {
    const { result } = renderHook(() => useProposalStageViewModel(chat(1, waiting), draft, () => false))
    expect(result.current.open).toBe(false)
    act(() => result.current.show())
    expect(result.current.open).toBe(true)
  })

  it('정한 뒤에도 같은 턴이면 결과를 보이도록 열어 두고, 새 턴·다른 대화가 시작되면 닫는다', () => {
    const { result, rerender } = renderHook(({ c }) => useProposalStageViewModel(c, draft), { initialProps: { c: chat(1, waiting) } })
    rerender({ c: chat(1, null) })
    expect(result.current.open).toBe(true)
    rerender({ c: chat(2, null) })
    expect(result.current.open).toBe(false)
    rerender({ c: chat(2, waiting, 't2') })
    expect(result.current.open).toBe(true)
    rerender({ c: chat(2, null, 't3') })
    expect(result.current.open).toBe(false)
  })
})
