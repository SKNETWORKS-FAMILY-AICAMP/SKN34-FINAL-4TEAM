import type { WorkNotice, WorkNoticeInput } from '../../domain/entities/workNotice'
import type { WorkNoticeRepository } from '../../domain/repositories/WorkNoticeRepository'

/** 처음 여는 작품에 보이는 데모 소식(최신이 앞). 한국시간 자정 기준이다. */
const seed = (workId: string): WorkNotice[] => [
  { id: `${workId}:3`, workId, category: 'info', title: '연재 일정 안내', body: '안녕하세요.\n\n이 작품은 연재 일정에 맞춰 새 회차가 올라와요. 연재 요일은 정보 탭에서 확인해 주세요.\n\n많은 응원 부탁드립니다.', pinned: true, createdAt: '2026-11-01T00:00:00+09:00', updatedAt: '2026-11-01T00:00:00+09:00' },
  { id: `${workId}:2`, workId, category: 'hiatus', title: '이번 주 휴재 안내', body: '작가 사정으로 이번 주 금요일 회차는 쉬어 갑니다. 양해 부탁드려요.', pinned: false, createdAt: '2026-10-27T00:00:00+09:00', updatedAt: '2026-10-27T00:00:00+09:00' },
  { id: `${workId}:1`, workId, category: 'info', title: '연재를 시작합니다', body: '읽어 주셔서 감사합니다. 댓글과 피드백은 모두 읽고 있어요.', pinned: false, createdAt: '2026-10-20T00:00:00+09:00', updatedAt: '2026-10-20T00:00:00+09:00' },
]

/**
 * 서버 없는 시연(`--mode mockup`)·메모리 데모 작품용 작품 소식 저장소. 작품별로 이 객체 안에만 두므로(탭·화면을 옮겨도 유지)
 * 새로 고치면 시드로 돌아가고 서버에 저장되지 않는다. 목록은 서버와 같이 고정 소식을 먼저, 그 안에서 최신 등록을 먼저 보인다.
 */
export class InMemoryWorkNoticeRepository implements WorkNoticeRepository {
  /** 작품별 소식. 등록 순서대로 최신이 앞이라, 고정 여부만 안정 정렬하면 서버의 정렬(고정, 최신 등록)과 같다. */
  private readonly byWork = new Map<string, WorkNotice[]>()
  private seq = 3
  private rows(workId: string) {
    const rows = this.byWork.get(workId) ?? seed(workId)
    this.byWork.set(workId, rows)
    return rows
  }
  private find(workId: string, noticeId: string) {
    const found = this.rows(workId).find((n) => n.id === noticeId)
    if (!found) throw new Error('소식을 찾을 수 없어요.')
    return found
  }

  async list(workId: string) { return this.rows(workId).map((n) => ({ ...n })).sort((a, b) => Number(b.pinned) - Number(a.pinned)) }
  async create(workId: string, input: WorkNoticeInput) {
    const at = new Date().toISOString()
    const made: WorkNotice = { ...input, id: `${workId}:${++this.seq}`, workId, createdAt: at, updatedAt: at }
    this.rows(workId).unshift(made)
    return { ...made }
  }
  async update(workId: string, noticeId: string, input: WorkNoticeInput) {
    const found = this.find(workId, noticeId)
    Object.assign(found, input, { updatedAt: new Date().toISOString() })
    return { ...found }
  }
  async remove(workId: string, noticeId: string) {
    const rows = this.rows(workId)
    rows.splice(rows.indexOf(this.find(workId, noticeId)), 1)
  }
}
