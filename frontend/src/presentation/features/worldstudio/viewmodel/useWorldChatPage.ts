import { useLocation } from 'react-router'

import { chatPage, type ChatPage } from '../../../../domain/entities/writingChat'
import type { useWorldStudioViewModel } from './useWorldStudioViewModel'

type VM = ReturnType<typeof useWorldStudioViewModel>

/**
 * 세계관 작업실의 AI 채팅이 메시지마다 싣는 화면 정보와 승인 카드 재료(#554).
 * - getPage: 지금 열린 세계관·설정 카드·보기. 카드는 서버에 저장돼 있을 때만 id를 싣는다(서버가 그 세계관의 카드인지 확인하므로 아직 저장하지 않은 새 카드의 id는 거절된다).
 *   저장하지 않은 변경이 있으면 열린 카드의 이름·설명을 저장하지 않은 편집 내용으로 싣는다.
 * - cardOf: 승인 카드가 카드의 수정 전 값을 찾는 함수. unsaved: 작성 중인 변경이 있으면 승인 버튼을 막는다.
 */
export function useWorldChatPage(vm: VM) {
  const { pathname, search } = useLocation()
  const settings = vm.editing?.settings ?? []
  return {
    getPage: (): ChatPage => {
      const card = settings.find((s) => s.item.id === vm.selected)?.item
      const stored = !!card && !!vm.saved?.settings.some((s) => s.item.id === card.id)
      return chatPage({
        path: pathname + search, kind: 'world', worldId: vm.reviewWorldId || undefined, cardId: stored ? card.id : undefined,
        view: new URLSearchParams(search).get('view') ?? undefined,
        unsaved: card && vm.dirty ? { title: card.title, body: card.text } : undefined,
      })
    },
    cardOf: (id: string) => { const item = settings.find((s) => s.item.id === id)?.item; return item && { title: item.title, body: item.text } },
    unsaved: vm.dirty || vm.relationDirty,
    worldDraft: vm.saved && { id: vm.saved.id, revision: vm.saved.version } || undefined,
  }
}
