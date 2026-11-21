import { useState } from 'react'

import { appContainer } from '../../../../app/appContainer'
import type { MemberItem } from '../../../../domain/entities/member'
import { orNullIfForbidden } from '../../../../domain/entities/operations'
import type { CreditChangeKind } from '../../../../domain/entities/operationsCredit'
import type { MemberUseCase } from '../../../../domain/usecases/MemberUseCase'
import type { OperationsCreditUseCase } from '../../../../domain/usecases/OperationsCreditUseCase'
import { useAsyncData } from '../../../shared/useAsyncData'
import type { AdminMutate } from './useAdminViewModel'

/** 조치 키: 같은 회원의 지급·회수는 한 키로 묶어 동시에 두 요청이 나가지 않게 합니다. */
export const creditKey = (memberId: string) => `credit:${memberId}`

/**
 * 크레딧 탭(DEC-57): 사용자 탭과 같은 회원 검색 API로 회원을 찾고, 고른 회원의 잔액·내역을 읽고, 수동 지급·회수를 요청합니다.
 * 지급·회수는 관리자 화면 공용 실행기(mutate)로 보내 진행·실패·완료 안내와 재조회(고른 회원의 잔액·내역)를 한곳에서 합니다.
 * 검색어와 고른 회원은 이 탭이 열려 있는 동안만 둡니다. 회원 검색에는 `users`, 크레딧에는 `credits` 권한이 필요해 없으면(403) data가 null입니다.
 */
export function useCreditsViewModel(
  mutate: AdminMutate,
  useCase: OperationsCreditUseCase = appContainer.resolve('operationsCreditUseCase'),
  memberUseCase: MemberUseCase = appContainer.resolve('memberUseCase'),
) {
  /** 제출한 검색어. null이면 아직 검색하지 않았습니다(빈 글자는 최신 가입순 전체 검색). */
  const [query, setQuery] = useState<string | null>(null)
  const [member, pick] = useState<MemberItem | null>(null)
  const members = useAsyncData(async () => query === null ? [] : orNullIfForbidden(memberUseCase.listMembers({ role: 'ALL', q: query, sort: 'newest' })), [memberUseCase, query])
  const credits = useAsyncData(async () => member ? useCase.member(member.id) : undefined, [useCase, member?.id])
  return {
    query, member, members, credits, pick,
    search: (text: string) => setQuery(text.trim()),
    change: (kind: CreditChangeKind, amount: number, reason: string) => {
      if (!member) return Promise.resolve(false)
      const done = `${member.nickname} 님${kind === 'grant' ? '에게' : '의'} 크레딧 ${amount.toLocaleString('ko-KR')}만큼 ${kind === 'grant' ? '지급' : '회수'}했어요.`
      return mutate(creditKey(member.id), done, () => useCase[kind](member.id, amount, reason))
    },
  }
}
