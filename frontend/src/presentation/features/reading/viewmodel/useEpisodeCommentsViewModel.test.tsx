// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createAppStore } from '../../../../app/store'
import type { EpisodeCommentRepository } from '../../../../domain/repositories/EpisodeCommentRepository'
import { EpisodeCommentUseCase } from '../../../../domain/usecases/EpisodeCommentUseCase'
import { useEpisodeCommentsViewModel } from './useEpisodeCommentsViewModel'

const toasts: string[] = []
const heard = (e: Event) => { toasts.push((e as CustomEvent<string>).detail) }
beforeEach(() => { toasts.length = 0; window.addEventListener('sf-toast', heard) })
afterEach(() => { window.removeEventListener('sf-toast', heard) })

function setup() {
  const repository = {
    list: vi.fn(async () => []), listByWork: vi.fn(), update: vi.fn(), remove: vi.fn(), like: vi.fn(), unlike: vi.fn(),
    create: vi.fn(async () => { throw new Error('공개 회차를 찾을 수 없어요.') }),
  } satisfies EpisodeCommentRepository
  const useCase = new EpisodeCommentUseCase(repository)
  const store = createAppStore({ role: 'user' })
  const wrapper = ({ children }: { children: ReactNode }) => <Provider store={store}><MemoryRouter>{children}</MemoryRouter></Provider>
  return renderHook(() => useEpisodeCommentsViewModel('guunmong', 2, useCase), { wrapper })
}

describe('useEpisodeCommentsViewModel · 댓글 작성 실패 안내', () => {
  it('알릴 곳을 넘기지 않으면(회차 하단 입력) 토스트로 알린다', async () => {
    const { result } = setup()
    await waitFor(() => expect(result.current.comments).toEqual([]))
    let ok = true
    await act(async () => { ok = await result.current.create('감상', null, false) })
    expect(ok).toBe(false)
    expect(toasts).toEqual(['공개 회차를 찾을 수 없어요.'])
  })

  it('알릴 곳을 넘기면(문장 댓글 시트) 서버 거절과 입력 거절 사유를 그리로만 보낸다', async () => {
    const { result } = setup()
    await waitFor(() => expect(result.current.comments).toEqual([]))
    const fail = vi.fn()
    await act(async () => { await result.current.create('감상', '고른 문장', false, fail) })
    await act(async () => { await result.current.create('   ', '고른 문장', false, fail) })
    expect(fail.mock.calls).toEqual([['공개 회차를 찾을 수 없어요.'], ['댓글 내용을 입력해 주세요.']])
    expect(toasts).toEqual([])
  })
})
