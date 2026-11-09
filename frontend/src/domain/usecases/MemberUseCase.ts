import { ADMIN_PERMISSIONS } from '../entities/admin'
import { checkPassword, EMAIL } from '../entities/account'
import type { AdminInput, MemberQuery } from '../entities/member'
import { OperationsError } from '../entities/operations'
import type { MemberRepository } from '../repositories/MemberRepository'

/** 운영 회원 조회·이용 제한(73)과 관리자 계정·권한(71). 권한 검사는 운영 서비스가 합니다. */
export class MemberUseCase {
  private readonly repository: MemberRepository
  constructor(repository: MemberRepository) { this.repository = repository }

  listMembers(query: MemberQuery) { return this.repository.list({ ...query, q: query.q.trim() }) }
  setRestriction(id: string, restricted: boolean) { return this.repository.setRestriction(id, restricted) }
  listAdmins() { return this.repository.listAdmins() }

  async createAdmin(input: AdminInput) {
    const email = input.email.trim(), nickname = input.nickname.trim()
    if (!EMAIL.test(email)) throw new OperationsError('이메일 형식을 확인해 주세요.')
    if (!nickname || nickname.length > 80) throw new OperationsError('닉네임은 1~80자로 입력해 주세요.')
    const passwordError = checkPassword(input.password)
    if (passwordError) throw new OperationsError(passwordError)
    const permissions = input.permissions.filter((p) => ADMIN_PERMISSIONS.some(([key]) => key === p))
    if (!permissions.length) throw new OperationsError('한 가지 이상 권한을 선택해 주세요.')
    await this.repository.createAdmin({ email, nickname, password: input.password, permissions })
  }
}
