import { useEffect, useState } from 'react'

import { proposalStageView } from './proposalView'
import type { ChatViewModel } from './useWritingChatViewModel'

/**
 * 원고 영역 승인 제안 화면(#909)의 열림 상태. 보일 승인 제안이 새로 오면(새 대화·새 턴, 다시 쓴 결과 포함) 저절로 열린다.
 * 승인·다시 쓰기·반영 결과·오류는 채팅 ViewModel이 그대로 맡는다. open은 편집기가 지금 연 회차(번호·본문)다.
 */
export function useProposalStageViewModel(chat: ChatViewModel, open: { number: number; body: string } | null) {
  const view = proposalStageView(chat.waiting, open)
  const [shown, setShown] = useState(false)
  // 요청이 흐르는 동안은 대기가 없어 키가 비므로, 다시 쓴 제안이 도착하면 닫아 둔 화면도 다시 열린다.
  const arrived = view ? `${chat.threadId}:${chat.turns.length}` : ''
  useEffect(() => { if (arrived) setShown(true) }, [arrived])
  return { open: shown, show: () => setShown(true), hide: () => setShown(false), view }
}

export type ProposalStageViewModel = ReturnType<typeof useProposalStageViewModel>
