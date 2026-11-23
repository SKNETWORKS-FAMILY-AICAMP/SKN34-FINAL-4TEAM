import { useLocation } from 'react-router'

import { characterDocName, characterDocText, type CharacterDocKey } from '../../../../domain/entities/characterDocs'
import { chatPage, type ChatPage } from '../../../../domain/entities/writingChat'
import type { useWorldStudioViewModel } from './useWorldStudioViewModel'

type VM = ReturnType<typeof useWorldStudioViewModel>

/**
 * 세계관 작업실의 AI 채팅이 메시지마다 싣는 화면 정보와 승인 카드 재료(#554).
 * - getPage: 지금 열린 세계관·설정 카드·보기. 카드는 서버에 저장돼 있을 때만 id를 싣는다(서버가 그 세계관의 카드인지 확인하므로 아직 저장하지 않은 새 카드의 id는 거절된다).
 *   저장하지 않은 변경이 있으면 열린 카드의 이름·설명을 저장하지 않은 편집 내용으로 싣는다. 카드 편집 화면에서 인물 카드의 다른 문서(`doc`: SOUL·GOAL·회차 기억)를 고르고 있으면 카드 설명 대신 그 문서의 글을 싣고,
 *   AI가 그 글을 카드 설명으로 오해하지 않게 제목에 문서 이름을 붙인다(`카엘 · SOUL.md`, #638). 설정집 목록 화면은 `doc` 없이 부른다.
 * - cardOf: 승인 카드가 카드의 수정 전 값을 찾는 함수. unsaved: 작성 중인 변경이 있으면 승인 버튼을 막는다.
 */
export function useWorldChatPage(vm: VM, doc: CharacterDocKey = 'identity') {
  const { pathname, search } = useLocation()
  const settings = vm.editing?.settings ?? []
  return {
    getPage: (): ChatPage => {
      const setting = settings.find((s) => s.item.id === vm.selected)
      const card = setting?.item
      const stored = !!card && !!vm.saved?.settings.some((s) => s.item.id === card.id)
      const name = doc === 'identity' ? '' : characterDocName(doc)
      return chatPage({
        path: pathname + search, kind: 'world', worldId: vm.reviewWorldId || undefined, cardId: stored ? card.id : undefined,
        view: new URLSearchParams(search).get('view') ?? undefined,
        unsaved: setting && vm.dirty ? { title: [setting.item.title, name].filter(Boolean).join(' · '), body: characterDocText(setting, doc) } : undefined,
      })
    },
    cardOf: (id: string) => { const item = settings.find((s) => s.item.id === id)?.item; return item && { title: item.title, body: item.text } },
    unsaved: vm.dirty || vm.relationDirty,
    worldDraft: vm.saved && { id: vm.saved.id, revision: vm.saved.version } || undefined,
  }
}
