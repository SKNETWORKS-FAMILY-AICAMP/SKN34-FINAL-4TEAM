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
 * 크레딧 탭(DEC-57, 운영자 콘텐츠 관리 F): 탭을 열면 사용자 탭과 같은 회원 목록 API로 전체 회원을 최신 가입순으로 읽고, 행마다 잔액(묶음 잔액 API)을 보입니다.
 * 행에서 회원을 고르면 그 회원의 잔액(지급분별)·내역을 읽고 수동 지급·회수를 요청합니다. 검색은 목록을 좁힐 때만 씁니다.
 * 지급·회수는 관리자 화면 공용 실행기(mutate)로 보내 진행·실패·완료 안내와 재조회(목록의 잔액·고른 회원의 잔액·내역)를 한곳에서 합니다.
 * 검색어와 고른 회원은 이 탭이 열려 있는 동안만 둡니다. 회원 목록에는 `users`, 크레딧에는 `credits` 권한이 필요해 없으면(403) data가 null입니다.
 */
export function useCreditsViewModel(
  mutate: AdminMutate,
  useCase: OperationsCreditUseCase = appContainer.resolve('operationsCreditUseCase'),
  memberUseCase: MemberUseCase = appContainer.resolve('memberUseCase'),
) {
  /** 제출한 검색어. 빈 글자는 최신 가입순 전체 목록이고, 탭을 열면 바로 이 목록을 읽습니다. */
  const [query, setQuery] = useState('')
  const [member, pick] = useState<MemberItem | null>(null)
  const members = useAsyncData(() => orNullIfForbidden(memberUseCase.listMembers({ role: 'ALL', q: query, sort: 'newest' })), [memberUseCase, query])
  // 행별 잔액: 보이는 회원의 id로 한꺼번에 읽습니다. 지급·회수 뒤 다시 읽는 건 useAsyncData가 dataVersion으로 합니다.
  const ids = (members.data ?? []).map((row) => row.id)
  const balances = useAsyncData(() => useCase.balances(ids), [useCase, ids.join(',')])
  const credits = useAsyncData(async () => member ? useCase.member(member.id) : undefined, [useCase, member?.id])
  return {
    query, member, members, balances, credits, pick,
    search: (text: string) => setQuery(text.trim()),
    change: (kind: CreditChangeKind, amount: number, reason: string) => {
      if (!member) return Promise.resolve(false)
      const done = `${member.nickname} 님${kind === 'grant' ? '에게' : '의'} 크레딧 ${amount.toLocaleString('ko-KR')}만큼 ${kind === 'grant' ? '지급' : '회수'}했어요.`
      return mutate(creditKey(member.id), done, () => useCase[kind](member.id, amount, reason))
    },
  }
}
