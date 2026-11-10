import { describe, expect, it } from 'vitest'

import { OperationsError } from '../entities/operations'
import type { Report } from '../entities/report'
import type { ReportRepository } from '../repositories/ReportRepository'
import { ReportUseCase } from '../usecases/ReportUseCase'

const report: Report = {
  id: 'r1', kind: 'RIGHTS', workId: 'w1', workTitle: '별빛', workOwnerId: 'owner', reporterId: 'me', reason: '무단 사용',
  evidence: '', status: 'RECEIVED', contentRestricted: false, createdAt: '2026-11-08T00:00:00Z', updatedAt: '2026-11-08T00:00:00Z',
}

/** 호출 인자만 기록하는 Fake Repository */
function setup() {
  const calls: [string, ...unknown[]][] = []
  const repository: ReportRepository = {
    submit: async (input) => { calls.push(['submit', input]) },
    listMine: async () => { calls.push(['listMine']); return [report] },
    listAll: async (status) => { calls.push(['listAll', status]); return [report] },
    get: async (id) => { calls.push(['get', id]); return { ...report, history: [] } },
    addEvidence: async (id, body) => { calls.push(['addEvidence', id, body]) },
    addExplanation: async (id, body) => { calls.push(['addExplanation', id, body]) },
    review: async (id, decision, note) => { calls.push(['review', id, decision, note]) },
    setContentRestriction: async (id, restricted) => { calls.push(['setContentRestriction', id, restricted]) },
    requestEvidence: async (id, body) => { calls.push(['requestEvidence', id, body]) },
  }
  return { calls, uc: new ReportUseCase(repository) }
}

describe('ReportUseCase', () => {
  it('신고는 사유·증거 앞뒤 공백을 정리해 접수한다', async () => {
    const { uc, calls } = setup()
    await uc.submit({ kind: 'HARMFUL', workId: 'w1', reason: ' 폭력 묘사 ', evidence: ' 3화 ' })
    expect(calls).toEqual([['submit', { kind: 'HARMFUL', workId: 'w1', reason: '폭력 묘사', evidence: '3화' }]])
  })

  it.each([
    [{ reason: '   ' }, '신고 사유는 1~2000자로 입력해 주세요.'],
    [{ reason: 'a'.repeat(2001) }, '신고 사유는 1~2000자로 입력해 주세요.'],
    [{ reason: 'a\u0000b' }, '신고 사유는 1~2000자로 입력해 주세요.'],
    [{ evidence: 'a'.repeat(5001) }, '증거는 5000자 이하로 입력해 주세요.'],
    [{ workId: '' }, '신고할 작품을 확인할 수 없어요.'],
  ])('잘못된 신고 입력 %o는 요청 없이 거절한다', async (patch, message) => {
    const { uc, calls } = setup()
    await expect(uc.submit({ kind: 'RIGHTS', workId: 'w1', reason: '사유', evidence: '', ...patch } as never)).rejects.toThrow(new OperationsError(message))
    expect(calls).toEqual([])
  })

  it('운영 목록은 선택 상태만 전달하고 전체는 null로 조회한다', async () => {
    const { uc, calls } = setup()
    await uc.listAll('ACCEPTED')
    await uc.listAll(null)
    expect(calls).toEqual([['listAll', 'ACCEPTED'], ['listAll', null]])
  })

  it('증거 보완·소명·증빙 요청은 빈 본문을 거절하고 정리한 본문을 보낸다', async () => {
    const { uc, calls } = setup()
    await expect(uc.addEvidence('r1', ' ')).rejects.toBeInstanceOf(OperationsError)
    await expect(uc.addExplanation('r1', '\u0000')).rejects.toBeInstanceOf(OperationsError)
    await expect(uc.requestEvidence('r1', '')).rejects.toBeInstanceOf(OperationsError)
    await uc.addEvidence('r1', ' 원본 링크 ')
    await uc.addExplanation('r1', ' 직접 창작 ')
    await uc.requestEvidence('r1', ' 계약서 제출 ')
    expect(calls).toEqual([['addEvidence', 'r1', '원본 링크'], ['addExplanation', 'r1', '직접 창작'], ['requestEvidence', 'r1', '계약서 제출']])
  })

  it('검토 메모는 1~2000자만 허용하고 정리한 메모와 결과를 전달한다', async () => {
    const { uc, calls } = setup()
    await expect(uc.review('r1', 'ACCEPTED', ' ')).rejects.toThrow('검토 메모는 1~2000자로 입력해 주세요.')
    await uc.review('r1', 'REJECTED', ' 근거 부족 ')
    expect(calls).toEqual([['review', 'r1', 'REJECTED', '근거 부족']])
  })

  it('콘텐츠 제한·해제와 상세 조회를 그대로 위임한다', async () => {
    const { uc, calls } = setup()
    await uc.setContentRestriction('r1', true)
    await uc.setContentRestriction('r1', false)
    expect((await uc.get('r1')).history).toEqual([])
    expect(await uc.listMine()).toEqual([report])
    expect(calls).toEqual([['setContentRestriction', 'r1', true], ['setContentRestriction', 'r1', false], ['get', 'r1'], ['listMine']])
  })
})
