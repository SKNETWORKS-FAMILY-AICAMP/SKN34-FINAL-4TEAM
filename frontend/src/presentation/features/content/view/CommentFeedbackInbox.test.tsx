// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { Provider } from 'react-redux'
import { expect, it, vi } from 'vitest'
import { appContainer } from '../../../../app/appContainer'
import { createAppStore } from '../../../../app/store'
import { CommentFeedbackInbox } from './CommentFeedbackInbox'

it('회차 순서대로 쌓고 펼친 회차의 피드백만 조회한다', async () => {
  const load = vi.fn(async (_id: string, episode: number) => ({
    total: 1, items: [{ id: String(episode), episodeNumber: episode, body: episode + '화 댓글 원문' }],
  }))
  vi.spyOn(appContainer, 'resolve').mockReturnValue(load)
  try {
    render(<Provider store={createAppStore()}><CommentFeedbackInbox workId="w" episodes={[
      { number: 1, title: '첫 장' }, { number: 2, title: '두 번째 장' },
    ]} /></Provider>)
    const rows = screen.getAllByRole('button', { name: /댓글 피드백 보기/ })
    expect(rows).toHaveLength(2)
    expect(load).not.toHaveBeenCalled()
    fireEvent.click(rows[1])
    await waitFor(() => expect(screen.getByText('2화 댓글 원문')).toBeTruthy())
    expect(load).toHaveBeenCalledWith('w', 2, 0, 20, expect.any(AbortSignal))
    fireEvent.click(rows[1])
    expect(screen.queryByText('2화 댓글 원문')).toBeNull()
  } finally { vi.restoreAllMocks() }
})
