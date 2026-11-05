import { describe, expect, it } from 'vitest'

import { SEED_COMMENTS, seedAdmin, seedWorks, seedWorlds } from '../../data/mock/seed'
import type { Comment, InboxItem, ReaderReport, ReviewItem } from '../entities/feedback'
import { FEEDBACK_TYPES, splitSentences } from '../entities/feedback'
import type { FeedbackRepository } from '../repositories/FeedbackRepository'
import type { WorkRepository } from '../repositories/WorkRepository'
import { FeedbackUseCase } from '../usecases/FeedbackUseCase'

function fakes() {
  const works = seedWorks(0)
  const db = { comments: {} as Record<string, Comment[]>, cmLiked: {} as Record<string, boolean>, reports: [] as ReaderReport[], inbox: [] as InboxItem[], queue: [] as ReviewItem[], hidden: [] as string[] }
  const workRepository: WorkRepository = { listWorks: async () => works, listWorlds: async () => seedWorlds(), saveWork: async () => {}, getDraft: async () => undefined, listDrafts: async () => ({}), saveDraft: async () => {}, deleteDraft: async () => {} }
  const feedbackRepository: FeedbackRepository = {
    listComments: async (theme, key) => [...(SEED_COMMENTS[theme] ?? []), ...(db.comments[key] ?? [])],
    addComment: async (key, c) => { (db.comments[key] ??= []).push(c) },
    countComments: async (prefix) => Object.entries(db.comments).filter(([k]) => k.startsWith(prefix)).reduce((a, [, v]) => a + v.length, 0),
    listCommentLikes: async () => db.cmLiked,
    toggleCommentLike: async (key) => { db.cmLiked[key] = !db.cmLiked[key] },
    listReports: async () => db.reports,
    listInbox: async () => db.inbox,
    addReport: async (r) => { db.reports.unshift(r) },
    addInbox: async (i) => { db.inbox.unshift(i) },
    addReview: async (q) => { db.queue.unshift(q) },
    saveInbox: async () => {},
    saveReport: async () => {},
    listReview: async () => db.queue,
    saveReview: async () => {},
  }
  return { works, db, useCase: new FeedbackUseCase(workRepository, feedbackRepository, { get: async () => ({ ...seedAdmin(), hiddenComments: db.hidden }), save: async () => {}, listComments: async () => [] }) }
}

describe('문장 분리 (목업 reader() body)', () => {
  it('문단별로 문장을 나누고 문단 번호를 남긴다', () => {
    const [p] = splitSentences(['“들여보내 주세요. 스승님의 서한을 가져왔어요.” 리안이 숨을 고르며 말했다.'])
    expect(p.map((s) => s.t)).toEqual(['“들여보내 주세요.', '스승님의 서한을 가져왔어요.”', '리안이 숨을 고르며 말했다.'])
    expect(p.every((s) => s.pi === 0)).toBe(true)
  })
})

describe('FeedbackUseCase (목업 addComment·feedbackSheet·reportSheet)', () => {
  it('댓글은 시드 댓글 뒤에 문장 인용·스포일러 표시와 함께 붙는다', async () => {
    const { works, useCase } = fakes()
    const w = works.find((x) => x.id === 'guunmong')!
    expect(await useCase.addComment('guunmong', 2, '읽는사람', '좋아요', { t: '문장', pi: 0 }, true)).toBe('댓글을 남겼어요')
    const { comments } = await useCase.getComments(w, 2)
    expect(comments).toHaveLength(4)
    expect(comments[3]).toEqual(['읽는사람', '좋아요', 0, { q: '문장', spoiler: true }])
    await useCase.toggleCommentLike('guunmong2c0')
    expect((await useCase.getComments(w, 2)).liked).toEqual({ guunmong2c0: true })
  })

  it('관리자가 숨긴 시드·독자 댓글은 회차 댓글에서 빠진다 (목업 reader() cms)', async () => {
    const { works, db, useCase } = fakes()
    const w = works.find((x) => x.id === 'guunmong')!
    await useCase.addComment('guunmong', 2, '읽는사람', '좋아요', null)
    db.hidden.push('hanji-1', 'runtime-guunmong-2-0')
    const { comments } = await useCase.getComments(w, 2)
    expect(comments.map((c) => c[1])).toEqual([SEED_COMMENTS.hanji[0][1], SEED_COMMENTS.hanji[2][1]])
  })

  it('10화 이상 작품의 1화는 10화대 독자 댓글과 섞지 않고 숨긴 댓글만 뺀다', async () => {
    const { works, db, useCase } = fakes()
    const w = works.find((x) => x.id === 'guunmong')!
    await useCase.addComment('guunmong', 1, '읽는사람', '1화 댓글', null)
    await useCase.addComment('guunmong', 10, '읽는사람', '10화 댓글', null)
    expect((await useCase.getComments(w, 1)).comments).toHaveLength(4)
    db.hidden.push('hanji-0')
    expect((await useCase.getComments(w, 1)).comments.map((c) => c[1])).toEqual([SEED_COMMENTS.hanji[1][1], SEED_COMMENTS.hanji[2][1], '1화 댓글'])
    db.hidden.splice(0, 1, 'runtime-guunmong-1-0')
    expect((await useCase.getComments(w, 1)).comments.map((c) => c[1])).toEqual(SEED_COMMENTS.hanji.map((c) => c[1]))
  })

  it('피드백 유형은 4가지이고 유형마다 목업 상태로 접수한다', async () => {
    expect(FEEDBACK_TYPES).toEqual(['단순 오류', '스토리 오류', '질문', '제안'])
    const { db, useCase } = fakes()
    const base = { workId: 'guunmong', n: 3, nick: '읽는사람', verified: false }
    const typo = await useCase.sendFeedback({ ...base, type: '단순 오류', text: '오타', sentence: { t: '“도량에서 그런 마음을 품으면 않 된다고 했느니라.', pi: 4 } })
    expect(typo.status).toBe('작가 검토 대기')
    expect(typo.message).toContain('“않 된다” 표기를 확인했어요 (→ “안 된다”)')
    const q = await useCase.sendFeedback({ ...base, type: '질문', text: '왜?', sentence: { t: '문장', pi: 0 } })
    expect(q).toEqual({ status: '응답 완료', message: '공개된 3화의 선택 문장을 근거로 답변을 준비했어요 (데모): “문장”' })
    expect((await useCase.sendFeedback({ ...base, type: '제안', text: '제안', sentence: { t: '문장', pi: 0 } })).status).toBe('작가 검토 대기')
    expect(db.reports.map((r) => r.type)).toEqual(['제안', '질문', '단순 오류'])
    // 남의 소설이라 작가 피드백함에는 넣지 않는다
    expect(db.inbox).toHaveLength(0)
  })

  it('내 소설의 스토리 오류는 작가 피드백함에 넣는다', async () => {
    const { db, useCase } = fakes()
    const r = await useCase.sendFeedback({ workId: 'starlight', n: 1, nick: '읽는사람', verified: true, type: '스토리 오류', text: '모순', sentence: { t: '문장', pi: 0 } })
    expect(r.message).toBe('검증 시뮬레이션 동의를 확인했어요. 실제 분석은 연결되지 않아 작가 검토 대상으로 접수했어요.')
    expect(db.inbox[0]).toMatchObject({ w: 'starlight', n: 1, pi: 0, type: '스토리 오류', status: '작가 검토 대기', rid: db.reports[0].id })
  })

  it('소설 신고는 회차 없이 운영 검토 목록과 내 신고 기록에 남는다', async () => {
    const { db, useCase } = fakes()
    expect(await useCase.reportWork({ workId: 'guunmong', type: '유해 콘텐츠', text: '확인 부탁', nick: '읽는사람' })).toContain('신고를 운영팀에 접수했어요.')
    expect(db.queue[0]).toMatchObject({ w: 'guunmong', n: null, type: '유해 콘텐츠', status: '접수' })
    expect(db.reports[0]).toMatchObject({ n: null, type: '신고 · 유해 콘텐츠', status: '접수됨' })
  })
})
