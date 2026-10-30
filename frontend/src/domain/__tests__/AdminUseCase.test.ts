import { describe, expect, it } from 'vitest'

import { seedAdmin, seedWorks, seedWorlds } from '../../data/mock/seed'
import type { Inquiry } from '../entities/account'
import type { DemoCredits } from '../entities/credit'
import type { ReaderReport, ReviewItem } from '../entities/feedback'
import type { Work } from '../entities/work'
import { AdminUseCase } from '../usecases/AdminUseCase'
import { ChatUseCase } from '../usecases/ChatUseCase'

function fakes() {
  let works = seedWorks(0), admin = seedAdmin(), chats = null as null | { id: string; workId: string; character: string; enabled: boolean }[]
  const db = { queue: [] as ReviewItem[], reports: [] as ReaderReport[], inq: [] as Inquiry[], credits: { credits: 100, usage: [], failNext: false, alerts: [] } as DemoCredits }
  const workRepository = { listWorks: async () => structuredClone(works), listWorlds: async () => seedWorlds(), saveWork: async (w: Work) => { works = works.map((x) => (x.id === w.id ? w : x)) }, getDraft: async () => undefined, listDrafts: async () => ({}), saveDraft: async () => {}, deleteDraft: async () => {} }
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
    chatRepository, new ChatUseCase(workRepository, { getProgress: async () => ({ last: {}, read: {}, seen: {}, liked: {} }), markSeen: async () => {}, saveProgress: async () => {} }, chatRepository),
  )
  return { uc, db, works: () => works, admin: () => admin }
}

const item = (id: string, status: string): ReviewItem => ({ id, w: 'starlight', n: null, type: '권리 침해', text: '신고', quote: '', status, who: '독자' })

describe('관리자 신고 처리 (목업 data-qact)', () => {
  it('비공개 조치는 작품을 숨기고 신고자 기록에 결과를 남긴다', async () => {
    const { uc, db, works, admin } = fakes()
    db.queue.push(item('r1', '접수'))
    db.reports.push({ id: 'r1', w: 'starlight', n: null, type: '신고 · 권리 침해', text: '신고', status: '접수됨', reply: '' })
    expect(await uc.review('r1', 'hide')).toBe('처리 결과를 기록하고 신고자에게 알렸어요 (데모)')
    expect(works().find((w) => w.id === 'starlight')!.hidden).toBe(true)
    expect(db.reports[0]).toMatchObject({ status: '조치 완료', reply: '운영팀이 확인하고 해당 소설을 비공개로 전환했어요.' })
    expect(admin().audit[0]).toMatchObject({ action: '신고 처리', detail: '권리 침해 · 비공개 조치' })
  })

  it('다른 제한이 남아 있으면 소명을 인정해도 복원하지 않는다', async () => {
    const { uc, db } = fakes()
    db.queue.push({ ...item('r1', '소명 제출'), beforeHidden: false }, item('r2', '비공개 조치'))
    expect(await uc.review('r1', 'restore')).toBe('다른 제한이 남아 있어 복원할 수 없어요')
    expect(db.queue[0].status).toBe('소명 제출')
  })

  it('정기 작업 재시도는 실패한 작업만 기록한다', async () => {
    const { uc } = fakes()
    expect(await uc.runJob('series')).toBeNull()
    expect(await uc.runJob('notification-cleanup')).toMatch('수동 재시도')
  })

  it('없는 사용자는 바꾸지 않고 로그도 남기지 않는다', async () => {
    const { uc, admin } = fakes()
    expect(await uc.toggleUser('nope')).toBeNull()
    expect(admin().audit).toEqual([])
  })

  it('없는 댓글은 숨기지 않고 로그도 남기지 않는다 (목업 data-comment-action)', async () => {
    const { uc, admin } = fakes()
    expect(await uc.toggleComment('nope', '구운몽 · 누군가')).toBeNull()
    expect(admin().hiddenComments).toEqual([])
    expect(admin().audit).toEqual([])
    expect(await uc.toggleComment('hanji-0', '구운몽 · 연화봉러')).toBe('댓글 상태를 변경했어요 (데모)')
    expect(admin().hiddenComments).toEqual(['hanji-0'])
  })
})
