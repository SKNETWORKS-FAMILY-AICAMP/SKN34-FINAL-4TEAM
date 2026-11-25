import { describe, expect, it } from 'vitest'

import type { OperationsFeedbackReport, OperationsFeedbackReportPage } from '../entities/operationsFeedbackReport'
import type { OperationsFeedbackReportRepository } from '../repositories/OperationsFeedbackReportRepository'
import { OperationsFeedbackReportUseCase } from '../usecases/OperationsFeedbackReportUseCase'

const row: OperationsFeedbackReport = {
  id: 'r1', workId: 'w1', workTitle: '별빛 서약의 탑', episodeNumber: 3, kind: 'typo', body: '오탈자가 있어요', quote: null,
  visibility: 'private', status: 'unchecked', reporterName: '연화', withdrawn: false, createdAt: '2026-11-20T01:02:03Z',
}
const page: OperationsFeedbackReportPage = { items: [row], page: 1, size: 20, total: 21 }

/** 호출 인자만 기록하는 Fake Repository */
function setup() {
  const calls: [string, ...unknown[]][] = []
  const repository: OperationsFeedbackReportRepository = {
    list: async (query) => { calls.push(['list', query]); return page },
  }
  return { calls, uc: new OperationsFeedbackReportUseCase(repository) }
}

describe('OperationsFeedbackReportUseCase (#750 운영자의 독자 제보 열람)', () => {
  it('목록은 쪽·상태 조건을 그대로 Repository에 넘기고 그 결과를 돌려준다', async () => {
    const { uc, calls } = setup()
    expect(await uc.list({ page: 1, status: 'checked' })).toBe(page)
    expect(await uc.list({ page: 0, status: null })).toBe(page)
    expect(calls).toEqual([['list', { page: 1, status: 'checked' }], ['list', { page: 0, status: null }]])
  })
})
