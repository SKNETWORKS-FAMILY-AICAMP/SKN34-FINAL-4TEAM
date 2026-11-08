/** 운영 회원·관리자 조회(71·73). 회원 정본과 실제 이용 제한은 Core, 업무 권한은 운영 서비스가 소유합니다. */
export type MemberRole = 'MEMBER' | 'ADMIN'
export type MemberItem = { id: string; email: string; nickname: string; role: MemberRole; restricted: boolean; createdAt: string }
export type AdminAccount = MemberItem & { permissions: string[] }
export type MemberQuery = { role: 'ALL' | MemberRole; q: string; sort: 'newest' | 'oldest' }
export type AdminInput = { email: string; nickname: string; password: string; permissions: string[] }
