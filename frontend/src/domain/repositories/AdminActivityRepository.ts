import type { AdminActivity } from '../entities/adminActivity'

/** 관리자 활동 기록 API 계약(72). 관리자 Bearer와 admins 권한으로 호출하며 서버가 최신 100개를 최신순으로 줍니다. */
export interface AdminActivityRepository {
  list(): Promise<AdminActivity[]>
}
