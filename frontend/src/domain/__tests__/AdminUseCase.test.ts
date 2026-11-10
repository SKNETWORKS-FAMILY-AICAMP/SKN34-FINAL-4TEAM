import { describe, expect, it, vi } from 'vitest'

import { seedAdmin, seedWorks, seedWorlds } from '../../data/mock/seed'
import type { DemoCredits } from '../entities/credit'
import type { ReaderReport, ReviewItem } from '../entities/feedback'
import type { Work } from '../entities/work'
import { AdminUseCase } from '../usecases/AdminUseCase'

function fakes() {
  let works = seedWorks(0), admin = seedAdmin(), chats = null as null | { id: string; workId: string; character: string; enabled: boolean }[]
  const db = { queue: [] as ReviewItem[], reports: [] as ReaderReport[], credits: { credits: 100, usage: [], failNext: false, alerts: [] } as DemoCredits }
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
    { get: async () => db.credits, save: async (c) => { db.credits = c } },
    chatRepository,
  )
  return { uc, db, admin: () => admin }
}

describe('관리자 데모 조치 기록', () => {
  it('조치 시각은 활동 기록 화면이 한국시간으로 바꿀 수 있는 ISO 시각이다', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-10T01:00:00Z'))
    try {
      const { uc, admin } = fakes()
      // 데모 댓글 숨김은 운영 댓글 API(75)로 옮겨져 남은 데모 조치인 정기 작업 재시도로 확인한다.
      await uc.runJob('notification-cleanup')
      expect(admin().audit).toEqual([{ at: '2026-11-10T01:00:00.000Z', actor: '관리자', action: '정기 작업 재시도 시연', detail: '알림 90일 보관기간 정리' }])
    } finally { vi.useRealTimers() }
  })
})

describe('관리자 신고 처리 (목업 data-qact)', () => {
  it('정기 작업 재시도는 실패한 작업만 기록한다', async () => {
    const { uc } = fakes()
    expect(await uc.runJob('series')).toBeNull()
    expect((await uc.runJob('notification-cleanup'))?.msg).toMatch('수동 재시도')
  })
})
