// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { Provider } from 'react-redux'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createAppStore } from '../../../../app/store'
import type { FeedbackReport } from '../../../../domain/entities/feedbackReport'
import type { FeedbackReportRepository } from '../../../../domain/repositories/FeedbackReportRepository'
import { FeedbackReportUseCase } from '../../../../domain/usecases/FeedbackReportUseCase'
import { useMyFeedbackReportsViewModel } from './useMyFeedbackReportsViewModel'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

const report = (extra: Partial<FeedbackReport> = {}): FeedbackReport => ({
  id: 'r1', workId: 'guunmong', workTitle: '구운몽', episodeNumber: 2, publishedVersionId: 'v2', kind: 'typo', body: '오탈자가 있어요', quote: null, visibility: 'public',
  status: 'unchecked', reporterName: '나', mine: true, owner: false, authorChecked: false, withdrawn: false, amendments: [], responses: [],
  createdAt: '2026-11-10T01:00:00Z', updatedAt: '2026-11-10T01:00:00Z', ...extra,
})

function setup(rows: FeedbackReport[]) {
  const done = async () => rows[0]
  const repository = {
    create: vi.fn(done), listEpisode: vi.fn(async () => rows), listInbox: vi.fn(async () => rows), check: vi.fn(done), answer: vi.fn(done), setStatus: vi.fn(done),
    listMine: vi.fn(async () => rows), setVisibility: vi.fn(done), correct: vi.fn(done), withdraw: vi.fn(done),
  } satisfies FeedbackReportRepository
  const store = createAppStore({ role: 'user' })
  const wrapper = ({ children }: { children: ReactNode }) => <Provider store={store}>{children}</Provider>
  const useCase = new FeedbackReportUseCase(repository)
  return { repository, ...renderHook(() => useMyFeedbackReportsViewModel(useCase), { wrapper }) }
}

describe('useMyFeedbackReportsViewModel · 처리 결과', () => {
  it('공개 범위 변경·정정·철회의 결과를 어느 제보의 것인지(제보 id)와 함께 남긴다', async () => {
    const [mine, other] = [report(), report({ id: 'r2', episodeNumber: 3 })]
    const { result, repository } = setup([mine, other])
    await waitFor(() => expect(result.current.reports).toHaveLength(2))
    expect(result.current.notice).toBeNull()

    await act(async () => { expect(await result.current.setVisibility(mine, 'private')).toBe(true) })
    expect(result.current.notice).toEqual({ key: 'r1', ok: true, msg: '비공개 제보로 바꿨어요' })

    repository.correct.mockRejectedValueOnce(new Error('철회한 제보는 정정할 수 없어요.'))
    await act(async () => { expect(await result.current.correct(other, '정정할 내용이에요')).toBe(false) })
    expect(result.current.notice).toEqual({ key: 'r2', ok: false, msg: '철회한 제보는 정정할 수 없어요.' })

    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await act(async () => { expect(await result.current.withdraw(other)).toBe(true) })
    expect(result.current.notice).toEqual({ key: 'r2', ok: true, msg: '제보를 철회했어요' })
  })

  it('입력 거절(빈 정정)도 그 제보의 실패로 남기고, 확인 창에서 취소하면 보내지 않아 이전 결과가 그대로다', async () => {
    const mine = report({ visibility: 'private' })
    const { result, repository } = setup([mine])
    await waitFor(() => expect(result.current.reports).toHaveLength(1))

    await act(async () => { expect(await result.current.correct(mine, '   ')).toBe(false) })
    expect(result.current.notice).toEqual({ key: 'r1', ok: false, msg: '정정 내용을 입력해 주세요.' })
    expect(repository.correct).not.toHaveBeenCalled()

    vi.spyOn(window, 'confirm').mockReturnValue(false)
    await act(async () => { expect(await result.current.setVisibility(mine, 'public')).toBe(false) })
    await act(async () => { expect(await result.current.withdraw(mine)).toBe(false) })
    expect(repository.setVisibility).not.toHaveBeenCalled()
    expect(repository.withdraw).not.toHaveBeenCalled()
    expect(result.current.notice).toEqual({ key: 'r1', ok: false, msg: '정정 내용을 입력해 주세요.' })
  })
})
