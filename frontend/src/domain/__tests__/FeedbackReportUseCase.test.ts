import { describe, expect, it, vi } from 'vitest'

import { seedAdmin, seedWorks } from '../../data/mock/seed'
import { FEEDBACK_TYPES, type FeedbackType } from '../entities/feedback'
import { REPORT_KIND_OF, REPORT_STATUS_LABEL, reportStatusChip, SETTABLE_REPORT_STATUSES, type FeedbackReport } from '../entities/feedbackReport'
import type { FeedbackRepository } from '../repositories/FeedbackRepository'
import type { FeedbackReportRepository } from '../repositories/FeedbackReportRepository'
import type { WorkRepository } from '../repositories/WorkRepository'
import { FeedbackReportUseCase } from '../usecases/FeedbackReportUseCase'
import { FeedbackUseCase } from '../usecases/FeedbackUseCase'

const report = (extra: Partial<FeedbackReport> = {}): FeedbackReport => ({
  id: 'r1', workId: 'w1', workTitle: '작품', episodeNumber: 3, publishedVersionId: 'v1', kind: 'typo', body: '본문', quote: null, visibility: 'private',
  status: 'unchecked', reporterName: '독자', mine: true, owner: false, authorChecked: false, withdrawn: false, amendments: [], responses: [],
  createdAt: '2026-11-10T01:00:00Z', updatedAt: '2026-11-10T01:00:00Z', ...extra,
})
const setup = () => {
  const repo = {
    create: vi.fn(async () => report()), listEpisode: vi.fn(async () => [report()]), listMine: vi.fn(async () => [report()]), listInbox: vi.fn(async () => [report()]),
    setVisibility: vi.fn(async () => report()), correct: vi.fn(async () => report()), withdraw: vi.fn(async () => report()),
    check: vi.fn(async () => report()), answer: vi.fn(async () => report()), setStatus: vi.fn(async () => report()),
  } satisfies FeedbackReportRepository
  return { repo, useCase: new FeedbackReportUseCase(repo) }
}
const untouched = (repo: ReturnType<typeof setup>['repo']) => Object.values(repo).forEach((fn) => expect(fn).not.toHaveBeenCalled())

describe('제보 표시 규칙', () => {
  it('문장 시트의 한글 유형 네 가지가 모두 서버 유형에 대응하고 상태 칩 색이 정해진다', () => {
    expect(FEEDBACK_TYPES.map((t) => REPORT_KIND_OF[t])).toEqual(['typo', 'story', 'question', 'suggestion'])
    expect(Object.values(REPORT_STATUS_LABEL)).toEqual(['작가 확인 전', '확인함', '답변함', '처리 완료', '종료'])
    expect((['unchecked', 'checked', 'answered', 'resolved', 'closed'] as const).map(reportStatusChip)).toEqual(['wait', 'wait', 'ok', 'ok', ''])
  })
})

describe('FeedbackReportUseCase', () => {
  it('등록은 앞뒤 공백을 지운 본문과 유형·공개 범위를 보내고 빈 인용은 생략한다', async () => {
    const { repo, useCase } = setup()
    expect(await useCase.register('w1', 3, { kind: 'story', body: '  앞뒤 줄거리가 달라요\n', quote: '', visibility: 'public' })).toEqual(report())
    expect(repo.create).toHaveBeenCalledWith('w1', 3, { kind: 'story', body: '앞뒤 줄거리가 달라요', visibility: 'public' })
    await useCase.register('w1', 3, { kind: 'typo', body: '오탈자', quote: '고른 문장', visibility: 'private' })
    expect(repo.create).toHaveBeenLastCalledWith('w1', 3, { kind: 'typo', body: '오탈자', quote: '고른 문장', visibility: 'private' })
  })

  it('등록 입력이 계약을 어기면 저장소를 부르지 않고 안내 문구로 던진다', async () => {
    const { repo, useCase } = setup()
    await expect(useCase.register('w1', 3, { kind: 'typo', body: '   ', visibility: 'private' })).rejects.toThrow('제보 내용을 입력해 주세요.')
    await expect(useCase.register('w1', 3, { kind: 'typo', body: '가'.repeat(501), visibility: 'private' })).rejects.toThrow('500자까지')
    await expect(useCase.register('w1', 3, { kind: 'typo', body: '본문', quote: '가'.repeat(501), visibility: 'private' })).rejects.toThrow('선택한 문장이 500자를 넘어')
    untouched(repo)
    await useCase.register('w1', 3, { kind: 'typo', body: '가'.repeat(500), quote: '가'.repeat(500), visibility: 'private' })
    expect(repo.create).toHaveBeenCalledTimes(1)
  })

  it('조회는 작품·회차를 저장소에 그대로 넘긴다', async () => {
    const { repo, useCase } = setup()
    expect(await useCase.listEpisode('w1', 3)).toEqual([report()])
    expect(repo.listEpisode).toHaveBeenCalledWith('w1', 3)
    expect(await useCase.listMine()).toEqual([report()])
    expect(await useCase.listInbox()).toEqual([report()])
  })

  it('제보자 동작은 제보의 작품·ID로 보내고 정정은 입력을 검사한 본문을 보낸다', async () => {
    const { repo, useCase } = setup()
    const r = report({ id: 'r9', workId: 'w9' })
    await useCase.setVisibility(r, 'public')
    expect(repo.setVisibility).toHaveBeenCalledWith('w9', 'r9', 'public')
    await useCase.correct(r, '  정정이에요 ')
    expect(repo.correct).toHaveBeenCalledWith('w9', 'r9', '정정이에요')
    await useCase.withdraw(r)
    expect(repo.withdraw).toHaveBeenCalledWith('w9', 'r9')
    const { repo: other, useCase: strict } = setup()
    await expect(strict.correct(r, '  ')).rejects.toThrow('정정 내용을 입력해 주세요.')
    await expect(strict.correct(r, '가'.repeat(501))).rejects.toThrow('500자까지')
    untouched(other)
  })

  it('작가 동작은 확인·답변·상태 변경을 제보의 작품·ID로 보내고 답변·상태는 검사한다', async () => {
    const { repo, useCase } = setup()
    const r = report({ id: 'r9', workId: 'w9', mine: false, owner: true })
    await useCase.check(r)
    expect(repo.check).toHaveBeenCalledWith('w9', 'r9')
    await useCase.answer(r, ' 답변이에요 ', true)
    expect(repo.answer).toHaveBeenCalledWith('w9', 'r9', { body: '답변이에요', isPublic: true })
    await useCase.setStatus(r, 'resolved')
    expect(repo.setStatus).toHaveBeenCalledWith('w9', 'r9', 'resolved')
    const { repo: other, useCase: strict } = setup()
    await expect(strict.answer(r, ' ', false)).rejects.toThrow('답변 내용을 입력해 주세요.')
    await expect(strict.answer(r, '가'.repeat(2001), false)).rejects.toThrow('2000자까지')
    untouched(other)
  })

  it('작가 상태 인자는 타입으로 확인함·답변함·처리 완료·종료만 받는다(확인 전으로 되돌릴 수 없다)', async () => {
    const { repo, useCase } = setup()
    for (const status of SETTABLE_REPORT_STATUSES) {
      await useCase.setStatus(report(), status)
      expect(repo.setStatus).toHaveBeenLastCalledWith('w1', 'r1', status)
    }
    expect(repo.setStatus).toHaveBeenCalledTimes(4)
    // @ts-expect-error 확인 전(unchecked)은 작가가 고를 수 있는 상태가 아니다(계약: 되돌리기는 422). 화면 목록에도 없어 컴파일 단계에서 막는다.
    void useCase.setStatus(report(), 'unchecked')
  })
})

describe('FeedbackUseCase의 정본 작품 분기', () => {
  const noop = async () => {}
  const feedbackRepository = { listComments: async () => [], addComment: noop, countComments: async () => 0, listCommentLikes: async () => ({}), toggleCommentLike: noop,
    listReports: async () => [], addReport: vi.fn(noop), listInbox: async () => [], addInbox: vi.fn(noop), saveInbox: noop, saveReport: noop, listReview: async () => [], saveReview: noop, addReview: noop } satisfies FeedbackRepository
  const admin = { get: async () => seedAdmin(), save: noop, listComments: async () => [] }
  const input = (type: FeedbackType, workId: string, extra: Record<string, unknown> = {}) => ({ workId, n: 2, sentence: { t: '고른 문장', pi: 0 }, type, text: ' 내용이에요 ', verified: false, nick: '독자', canonical: true, ...extra })
  const setupWorks = () => {
    const works = seedWorks(0)
    works.find((w) => w.id === 'starlight')!.canonical = true
    const listWorks = vi.fn(async () => works)
    const workRepository = { listWorks } as unknown as WorkRepository
    return { works, workRepository, listWorks }
  }

  it('정본 작품의 피드백은 데모 저장소가 아니라 제보 API로 등록하고 실제 상태만 안내한다', async () => {
    const { workRepository, listWorks } = setupWorks()
    const { repo, useCase } = setup()
    repo.create.mockResolvedValue(report({ status: 'unchecked', visibility: 'public' }))
    const uc = new FeedbackUseCase(workRepository, feedbackRepository, admin, useCase)

    const result = await uc.sendFeedback(input('단순 오류', 'starlight', { visibility: 'public' }))
    // 정본 여부는 시트가 이미 알고 있어 값으로 넘기므로 작품 목록(HTTP)을 다시 읽지 않는다.
    expect(listWorks).not.toHaveBeenCalled()

    expect(repo.create).toHaveBeenCalledWith('starlight', 2, { kind: 'typo', body: '내용이에요', quote: '고른 문장', visibility: 'public' })
    expect(result.status).toBe('작가 확인 전')
    expect(result.message).toContain('제보를 등록했어요')
    // AI 응답 문구와 데모 접수는 없다.
    expect(result.message).not.toMatch(/AI|데모|수정 제안/)
    expect(feedbackRepository.addReport).not.toHaveBeenCalled()
    expect(feedbackRepository.addInbox).not.toHaveBeenCalled()
  })

  it('공개 범위를 주지 않으면 비공개로 등록하고 안내도 비공개임을 알린다', async () => {
    const { workRepository } = setupWorks()
    const { repo, useCase } = setup()
    const uc = new FeedbackUseCase(workRepository, feedbackRepository, admin, useCase)
    const result = await uc.sendFeedback(input('질문', 'starlight'))
    expect(repo.create).toHaveBeenCalledWith('starlight', 2, expect.objectContaining({ kind: 'question', visibility: 'private' }))
    expect(result.message).toContain('비공개')
  })

  it('입력 오류나 서버 거절은 그대로 던져 접수된 것처럼 보이지 않게 한다', async () => {
    const { workRepository } = setupWorks()
    const { repo, useCase } = setup()
    const uc = new FeedbackUseCase(workRepository, feedbackRepository, admin, useCase)
    await expect(uc.sendFeedback({ ...input('제안', 'starlight'), text: '   ' })).rejects.toThrow('제보 내용을 입력해 주세요.')
    expect(repo.create).not.toHaveBeenCalled()
    repo.create.mockRejectedValue(new Error('공개 작품을 찾을 수 없어요.'))
    await expect(uc.sendFeedback(input('제안', 'starlight'))).rejects.toThrow('공개 작품을 찾을 수 없어요.')
  })

  it('제보 API가 연결되지 않으면 정본 작품은 기존처럼 거절하고 데모 작품은 제보 API를 쓰지 않는다', async () => {
    const { workRepository, works } = setupWorks()
    await expect(new FeedbackUseCase(workRepository, feedbackRepository, admin).sendFeedback(input('질문', 'starlight'))).rejects.toThrow('아직 연결되지')
    const { repo, useCase } = setup()
    const demo = works.find((w) => !w.canonical)!
    const result = await new FeedbackUseCase(workRepository, feedbackRepository, admin, useCase).sendFeedback(input('질문', demo.id, { canonical: false }))
    expect(repo.create).not.toHaveBeenCalled()
    expect(result.status).toBe('응답 완료')
  })
})
