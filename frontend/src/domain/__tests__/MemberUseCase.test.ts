import { describe, expect, it } from 'vitest'

import type { AdminAccount } from '../entities/member'
import { OperationsError } from '../entities/operations'
import type { MemberRepository } from '../repositories/MemberRepository'
import { MemberUseCase } from '../usecases/MemberUseCase'

const admin: AdminAccount = { id: 'a1', email: 'admin@example.test', nickname: '운영자', role: 'ADMIN', restricted: false, createdAt: '2026-11-08T00:00:00Z', permissions: ['users'] }

function setup() {
  const calls: [string, ...unknown[]][] = []
  const repository: MemberRepository = {
    list: async (query) => { calls.push(['list', query]); return [admin] },
    setRestriction: async (id, restricted) => { calls.push(['setRestriction', id, restricted]) },
    listAdmins: async () => { calls.push(['listAdmins']); return [admin] },
    createAdmin: async (input) => { calls.push(['createAdmin', input]) },
  }
  return { calls, uc: new MemberUseCase(repository) }
}
const input = { email: ' new@example.test ', nickname: ' 새 운영자 ', password: 'StoryforkDev123!', permissions: ['users', 'rights'] }

describe('MemberUseCase', () => {
  it('회원 목록은 검색어 공백을 정리해 역할·정렬과 함께 조회한다', async () => {
    const { uc, calls } = setup()
    await uc.listMembers({ role: 'ADMIN', q: ' 연화 ', sort: 'oldest' })
    expect(calls).toEqual([['list', { role: 'ADMIN', q: '연화', sort: 'oldest' }]])
  })

  it('회원 이용 제한·해제와 관리자 목록을 위임한다', async () => {
    const { uc, calls } = setup()
    await uc.setRestriction('m1', true)
    await uc.setRestriction('m1', false)
    expect(await uc.listAdmins()).toEqual([admin])
    expect(calls).toEqual([['setRestriction', 'm1', true], ['setRestriction', 'm1', false], ['listAdmins']])
  })

  it('관리자 생성은 정리한 이메일·닉네임과 알려진 권한만 보낸다', async () => {
    const { uc, calls } = setup()
    await uc.createAdmin({ ...input, permissions: ['users', 'rights', 'unknown'] })
    expect(calls).toEqual([['createAdmin', { email: 'new@example.test', nickname: '새 운영자', password: 'StoryforkDev123!', permissions: ['users', 'rights'] }]])
  })

  it.each([
    [{ email: 'bad@x' }, '이메일 형식을 확인해 주세요.'],
    [{ nickname: ' ' }, '닉네임은 1~80자로 입력해 주세요.'],
    [{ nickname: 'a'.repeat(81) }, '닉네임은 1~80자로 입력해 주세요.'],
    [{ password: 'short' }, '비밀번호는 8자 이상이에요'],
    [{ permissions: ['unknown'] }, '한 가지 이상 권한을 선택해 주세요.'],
  ])('잘못된 관리자 입력 %o는 요청 없이 거절한다', async (patch, message) => {
    const { uc, calls } = setup()
    await expect(uc.createAdmin({ ...input, ...patch })).rejects.toThrow(new OperationsError(message))
    expect(calls).toEqual([])
  })
})
