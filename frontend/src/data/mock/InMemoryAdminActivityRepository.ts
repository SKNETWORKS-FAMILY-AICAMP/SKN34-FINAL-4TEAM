import type { AdminActivity } from '../../domain/entities/adminActivity'
import type { AdminActivityRepository } from '../../domain/repositories/AdminActivityRepository'
import type { MockDb } from './InMemoryRepositories'

/**
 * 서버 없는 시연(`--mode mockup`)·렌더 테스트용입니다. 데모 관리자 화면(AdminUseCase)이 쌓은 데모 조치를 활동 기록 형태로 보여 주며
 * 새로 고치면 사라집니다. 데모 조치에는 대상 종류·ID가 없어(대상은 내역 문구에 있음) 종류를 '데모'로 둡니다.
 */
export class InMemoryAdminActivityRepository implements AdminActivityRepository {
  private readonly db: MockDb
  constructor(db: MockDb) { this.db = db }

  /** audit은 최신순이므로 오래된 항목부터 1번을 매겨, 조치가 더 쌓여도 기존 행의 id는 그대로입니다. */
  async list(): Promise<AdminActivity[]> {
    const { audit } = this.db.admin
    return audit.map((x, i) => ({
      id: `demo-${audit.length - i}`, actorId: 'demo-admin', actorNickname: x.actor || null, action: x.action,
      targetType: '데모', targetId: '', detail: x.detail, createdAt: x.at,
    }))
  }
}
