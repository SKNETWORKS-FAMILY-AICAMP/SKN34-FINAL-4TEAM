import { describe, expect, it } from 'vitest'

import { seedAdmin, seedWorks, seedWorlds } from '../../data/mock/seed'
import type { Inquiry } from '../entities/account'
import type { DemoCredits } from '../entities/credit'
import type { ReaderReport, ReviewItem } from '../entities/feedback'
import type { Work } from '../entities/work'
import { AGGREGATE_WRITE_UNSUPPORTED } from '../repositories/WorkRepository'
import { AdminUseCase, canToggleWork } from '../usecases/AdminUseCase'

function fakes() {
  let works = seedWorks(0), admin = seedAdmin(), chats = null as null | { id: string; workId: string; character: string; enabled: boolean }[]
  const db = { queue: [] as ReviewItem[], reports: [] as ReaderReport[], inq: [] as Inquiry[], credits: { credits: 100, usage: [], failNext: false, alerts: [] } as DemoCredits }
  const workRepository = { listWorks: async () => structuredClone(works), listWorlds: async () => seedWorlds(), readWorld: async (w: Work) => w, createFork: async () => { throw new Error('not used') }, saveWork: async (w: Work) => { works = works.map((x) => (x.id === w.id ? w : x)) }, getDraft: async () => undefined, listDrafts: async () => ({}), saveDraft: async () => {}, deleteDraft: async () => {} }
  const replace = <T extends { id: string }>(l: T[], x: T) => l.splice(l.findIndex((y) => y.id === x.id), 1, x)
  const feedbackRepository = {
    listComments: async () => [], addComment: async () => {}, countComments: async () => 0, listCommentLikes: async () => ({}), toggleCommentLike: async () => {},
    listReports: async () => structuredClone(db.reports), addReport: async () => {}, saveReport: async (r: ReaderReport) => { replace(db.reports, r) },
    listInbox: async () => [], addInbox: async () => {}, saveInbox: async () => {},
    listReview: async () => structuredClone(db.queue), saveReview: async (q: ReviewItem) => { replace(db.queue, q) }, addReview: async () => {},
  }
  const chatRepository = { listChats: async () => chats, saveChats: async (c: typeof chats) => { chats = c }, getLog: async () => undefined, saveLog: async () => {} }
  const uc = new AdminUseCase(
    { get: async () => structuredClone(admin), save: async (a) => { admin = a }, listComments: async () => [{ id: 'hanji-0', work: '구운몽', workId: 'guunmong', author: '연화봉러', text: '좋아요', likes: 1 }] },
    workRepository, feedbackRepository,
    { list: async () => db.inq, add: async () => {}, save: async (q) => { replace(db.inq, q) } },
    { get: async () => db.credits, save: async (c) => { db.credits = c } },
    chatRepository,
  )
  return { uc, db, works: () => works, admin: () => admin }
}

describe('관리자 신고 처리 (목업 data-qact)', () => {
  it('정기 작업 재시도는 실패한 작업만 기록한다', async () => {
    const { uc } = fakes()
    expect(await uc.runJob('series')).toBeNull()
    expect((await uc.runJob('notification-cleanup'))?.msg).toMatch('수동 재시도')
  })

  it('없는 댓글은 숨기지 않고 로그도 남기지 않는다 (목업 data-comment-action)', async () => {
    const { uc, admin } = fakes()
    expect(await uc.toggleComment('nope', '구운몽 · 누군가')).toBeNull()
    expect(admin().hiddenComments).toEqual([])
    expect(admin().audit).toEqual([])
    expect(await uc.toggleComment('hanji-0', '구운몽 · 연화봉러')).toEqual({ ok: true, msg: '댓글 상태를 변경했어요 (데모)' })
    expect(admin().hiddenComments).toEqual(['hanji-0'])
  })
})

describe('작품 탭 조치 대상 (#197)', () => {
  it('정본 작품은 조치 대상이 아니고 toggleWork도 같은 기준으로 거절해 상태와 로그를 바꾸지 않는다', async () => {
    const { uc, works, admin } = fakes()
    const work = works().find((w) => w.id === 'guunmong')!
    work.canonical = true
    expect(canToggleWork(work)).toBe(false)
    expect(await uc.toggleWork(work.id)).toEqual({ ok: false, msg: AGGREGATE_WRITE_UNSUPPORTED })
    expect(works().find((w) => w.id === work.id)?.hidden).toBeFalsy()
    expect(admin().audit).toEqual([])
  })

  it('메모리 데모 작품은 조치 대상이고 toggleWork가 공개 상태를 바꿔 로그를 남긴다', async () => {
    const { uc, works, admin } = fakes()
    const work = works().find((w) => w.id === 'guunmong')!
    expect(canToggleWork(work)).toBe(true)
    expect(canToggleWork({ canonical: false })).toBe(true)
    expect(await uc.toggleWork(work.id)).toEqual({ ok: true, msg: '작품 공개 상태를 변경했어요 (데모)' })
    expect(works().find((w) => w.id === work.id)?.hidden).toBe(true)
    expect(admin().audit[0]).toMatchObject({ action: '작품 공개 상태 변경', detail: `${work.title} · 운영상 비공개` })
  })
})
