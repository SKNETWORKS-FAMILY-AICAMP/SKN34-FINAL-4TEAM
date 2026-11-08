import type { AdminAccount, AdminInput, MemberItem, MemberQuery } from '../entities/member'

/** 운영 공개 회원·관리자 API 계약(관리자 Bearer). */
export interface MemberRepository {
  list(query: MemberQuery): Promise<MemberItem[]>
  setRestriction(id: string, restricted: boolean): Promise<void>
  listAdmins(): Promise<AdminAccount[]>
  createAdmin(input: AdminInput): Promise<void>
}
