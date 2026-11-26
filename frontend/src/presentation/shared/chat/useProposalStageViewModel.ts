import { useEffect, useEffectEvent, useState } from 'react'

import { proposalStageView } from './proposalView'
import type { ChatViewModel } from './useWritingChatViewModel'

/**
 * 원고 영역 승인 제안 화면(#909)의 열림 상태. 보일 승인 제안이 새로 오면(새 대화·새 턴, 다시 쓴 결과 포함) 저절로 열린다.
 * 단 autoOpen()이 거짓이면(작가가 편집기에 쓰는 중) 저절로 열지 않고 채팅의 링크로만 연다: 편집기를 가리면 쓰던 입력을 잃는다.
 * 연 턴 안에서는 정한 뒤에도 열어 두어 결과(반영함·실패)를 보이고, 새 턴이나 다른 대화가 시작되면 닫는다.
 * 승인·다시 쓰기·반영 결과·오류는 채팅 ViewModel이 그대로 맡는다. open은 편집기가 지금 연 회차(번호·본문)다.
 */
export function useProposalStageViewModel(chat: ChatViewModel, open: { number: number; body: string } | null, autoOpen: () => boolean = () => true) {
  const view = proposalStageView(chat.waiting, open)
  const turn = `${chat.threadId}:${chat.turns.length}`
  const [shown, setShown] = useState('') // 화면을 연 턴. 지금 턴과 다르면 닫혀 있다
  // 요청이 흐르는 동안은 대기가 없어 키가 비므로, 다시 쓴 제안이 도착하면 닫아 둔 화면도 다시 열린다.
  const arrived = view ? turn : ''
  const arrive = useEffectEvent((key: string) => { if (autoOpen()) setShown(key) }) // 도착한 순간에만 묻는다
  useEffect(() => { if (arrived) arrive(arrived) }, [arrived])
  return { open: shown === turn, show: () => setShown(turn), hide: () => setShown(''), view }
}

export type ProposalStageViewModel = ReturnType<typeof useProposalStageViewModel>
