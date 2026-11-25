import { useEffect, useRef, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'

import type { ChatPage, WorldDraftRevision } from '../../../../domain/entities/writingChat'
import { keepFiles } from '../../../shared/chat/keepFiles'
import { WritingChat } from '../../../shared/chat/WritingChat'
import { useLinkedWorkBasis } from '../viewmodel/useLinkedWorkBasis'
import { FoldIcon, SparkIcon } from '../../../shared/icons'
import { Sheet } from '../../../shared/Sheet'

// 빈 상태의 추천 칩. 누르면 입력창에 글만 채운다.
const suggestions = ['인물 카드 아이디어', '이 설정의 모순 찾기', '관계 제안']
/** 설정집 화면의 채팅이 오른쪽 열에서 화면을 덮는 서랍으로 바뀌는 폭. world-studio.css의 `.world-chat` 분기와 같은 값이다. */
const DRAWER = '(max-width: 900px)'

const watchDrawer = (changed: () => void) => {
  const media = window.matchMedia?.(DRAWER)
  media?.addEventListener('change', changed)
  return () => media?.removeEventListener('change', changed)
}
/** 설정집 화면의 채팅이 서랍으로 열리는 폭인지(창 폭이 바뀌면 따라 바뀐다). `matchMedia`가 없는 환경(테스트)은 넓은 화면으로 본다. */
const useDrawer = () => useSyncExternalStore(watchDrawer, () => window.matchMedia?.(DRAWER).matches ?? false)

/**
 * 세계관 작업실 오른쪽의 AI 채팅(집필실과 같은 공용 집필 AI 채팅, 설정집 화면과 편집 화면 모두에 항상 보인다). 세계관에 연결된 소설(linkedWorkId)의 대화·최신 발행 회차(없으면 가장 뒤 회차 초안, #729)를 근거로 쓰고, 연결 소설이나 회차가 없으면 사유와 함께 잠근다(가짜 응답 없음).
 * 설정집 화면에서는 본문(main)의 형제로 놓여 본문 | 채팅 2열을 이룬다(배치는 world-studio.css). 좁은 화면(900px 이하)에서는 화면을 덮는 오른쪽 서랍이라, 뒤 화면을 막는 대화 상자(공용 `Sheet`)로 연다:
 * 초점이 서랍 안에 머물고 Esc·배경 누르기로 닫히며, 뒤에 가려진 화면으로 초점이 넘어가지 않는다.
 * 편집 화면(`variant="writing"`)은 집필실과 같은 클래스(`writing-chat`)로 3단의 오른쪽 열이 되고, 좁은 화면에서는 편집기 아래에 놓이는 영역이라 서랍이 아니다.
 * 채팅의 World 제안이 설정집 초안에 반영되면(`onWorldApplied`) 서버 초안이 바뀐 것이라, 부모가 저장하지 않은 변경이 없을 때만 다시 읽고 있으면 안내만 한다(`aiDraftChanged`).
 * 닫힌 채 서랍 폭(900px 이하)이면 열기 버튼은 화면 오른쪽 아래에 떠 있는 대신 `slot`(사이드바 탭 줄의 오른쪽 끝)으로 옮겨 그린다(떠 있는 버튼이 첫 화면의 `+ 새 설정`·안내를 가렸다). 넓은 화면은 그대로 본문 옆에 뜬다.
 * 접기·열기 버튼은 한 번에 하나만 마운트되므로 ref 하나를 함께 쓰고, 누르면 사라질 버튼 대신 새로 보이는 버튼으로 초점을 옮긴다(처음 렌더링에서는 옮기지 않는다).
 */
export function WorldChat({ open, onOpenChange, slot = null, variant = 'world', linkedWorkId = null, onWorldApplied, getPage, cardOf, unsaved, worldDraft }: {
  open: boolean; onOpenChange: (open: boolean) => void; variant?: 'world' | 'writing'; linkedWorkId?: string | null; onWorldApplied?: () => void
  /** 900px 이하(서랍)에서 닫힌 열기 버튼을 화면 오른쪽 아래에 띄우지 않고 넣을 자리(사이드바 탭 줄 오른쪽 끝). 없으면 늘 떠 있다. */
  slot?: HTMLElement | null
  /** 메시지마다 싣는 화면 정보, 승인 카드의 수정 전 값 찾기, 작성 중인 변경이 있어 승인을 막아야 하는지(#554). */
  getPage?: () => ChatPage | undefined; cardOf?: (id: string) => { title: string; body: string } | undefined; unsaved?: boolean; worldDraft?: WorldDraftRevision
}) {
  const basis = useLinkedWorkBasis(open ? linkedWorkId : null)
  const toggle = useRef<HTMLButtonElement>(null)
  const wasOpen = useRef(open)
  const drawer = useDrawer() && variant === 'world'
  useEffect(() => {
    if (wasOpen.current !== open) toggle.current?.focus()
    wasOpen.current = open
  }, [open])
  if (!open) {
    const button = <button ref={toggle} type="button" className="studio-chat-toggle btn pri" onClick={() => onOpenChange(true)}>AI 채팅 열기</button>
    return drawer && slot ? createPortal(button, slot) : button // 같은 버튼이라 접기·열기 초점 이동도 그대로다
  }
  const close = () => onOpenChange(false)
  const body = (
    <>
      <div className="studio-chat-head" {...keepFiles}>
        <h2><span className="chat-brand" aria-hidden="true"><SparkIcon size={16} /></span>AI 채팅</h2>
        <button ref={toggle} type="button" className="chat-icon-btn" aria-label="접기" title="접기" onClick={close}><FoldIcon /></button>
      </div>
      <WritingChat workId={linkedWorkId} basis={basis} emptyTitle="어떤 세계를 함께 다듬어 볼까요?" emptyText="AI의 제안은 설정 카드에 자동으로 반영되지 않아요." suggestions={suggestions} onWorldApplied={onWorldApplied} getPage={getPage} cardOf={cardOf} unsaved={unsaved} worldDraft={worldDraft} />
    </>
  )
  if (drawer) return <Sheet sid="W01" label="AI 채팅" panelClass="studio-chat world-chat" onClose={close}>{body}</Sheet>
  return <aside className={'studio-chat ' + (variant === 'writing' ? 'writing-chat' : 'world-chat')} aria-label="AI 채팅">{body}</aside>
}
