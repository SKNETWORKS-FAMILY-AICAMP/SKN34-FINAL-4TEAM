import { afterEach, describe, expect, it, vi } from 'vitest'

import { AdminUseCase } from '../../domain/usecases/AdminUseCase'
import { createFixtureDb } from './fixtureDb'
import { InMemoryAdminActivityRepository } from './InMemoryAdminActivityRepository'
import { InMemoryAdminRepository, InMemoryChatRepository, InMemoryCreditRepository, InMemoryFeedbackRepository, InMemoryWorkRepository } from './InMemoryRepositories'

afterEach(() => vi.useRealTimers())

const entry = (at: string, action: string, detail: string, actor = '관리자') => ({ at, actor, action, detail })

describe('InMemoryAdminActivityRepository (서버 없는 시연·테스트용)', () => {
  it('데모 관리자 화면이 남긴 조치를 활동 기록 형태로 보여 주고, 아직 없으면 빈 목록이다', async () => {
    const db = createFixtureDb()
    const demo = new AdminUseCase(new InMemoryAdminRepository(db), new InMemoryWorkRepository(db), new InMemoryFeedbackRepository(db), new InMemoryCreditRepository(db), new InMemoryChatRepository(db))
    const repo = new InMemoryAdminActivityRepository(db)
    expect(await repo.list()).toEqual([])
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-10T01:00:00Z'))
    await demo.runJob('notification-cleanup')
    expect(await repo.list()).toEqual([{
      id: 'demo-1', actorId: 'demo-admin', actorNickname: '관리자', action: '정기 작업 재시도 시연', targetType: '데모', targetId: '',
      detail: '알림 90일 보관기간 정리', createdAt: '2026-11-10T01:00:00.000Z',
    }])
  })

  it('최신순을 유지하고, 새 조치가 쌓여도 기존 행의 id는 같으며, 수행자 이름이 비면 닉네임 없음으로 보인다', async () => {
    const db = createFixtureDb()
    db.admin.audit = [entry('2026-11-10T03:00:00.000Z', '경고 확인', '둘째', ''), entry('2026-11-10T02:00:00.000Z', '댓글 상태 변경', '첫째')]
    const repo = new InMemoryAdminActivityRepository(db)
    expect((await repo.list()).map((row) => [row.id, row.action, row.actorNickname, row.detail])).toEqual([
      ['demo-2', '경고 확인', null, '둘째'], ['demo-1', '댓글 상태 변경', '관리자', '첫째'],
    ])
    db.admin.audit.unshift(entry('2026-11-10T04:00:00.000Z', '캐릭터챗 중지', '셋째'))
    expect((await repo.list()).map((row) => row.id)).toEqual(['demo-3', 'demo-2', 'demo-1'])
  })
})
