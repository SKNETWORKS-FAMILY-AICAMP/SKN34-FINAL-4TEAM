import { useEffect, useRef } from 'react'

import { ChatPanel } from '../../../shared/chat/ChatPanel'
import { FoldIcon, SparkIcon } from '../../../shared/icons'

// 빈 상태의 추천 칩. 누르면 입력창에 글만 채운다(전송을 연결하기 전에는 입력과 함께 잠겨 있다).
const suggestions = ['인물 카드 아이디어', '이 설정의 모순 찾기', '관계 제안']

/**
 * 세계관 작업실 오른쪽의 AI 채팅(집필실과 같은 공용 ChatPanel 레일, 설정집 화면과 편집 화면 모두에 항상 보인다). 전송은 아직 연결하지 않아 입력·전송·첨부·추천 칩을 잠그고 사유를 보여 준다(가짜 응답 없음).
 * 설정집 화면에서는 본문(main)의 형제로 놓여 본문 | 채팅 2열을 이루고 좁은 화면에서는 기본이 닫힘이며 열면 오른쪽 서랍이다(배치는 world-studio.css).
 * 편집 화면(`variant="writing"`)은 집필실과 같은 클래스(`writing-chat`)로 3단의 오른쪽 열이 된다.
 * 접기·열기 버튼은 한 번에 하나만 마운트되므로 ref 하나를 함께 쓰고, 누르면 사라질 버튼 대신 새로 보이는 버튼으로 초점을 옮긴다(처음 렌더링에서는 옮기지 않는다).
 */
export function WorldChat({ open, onOpenChange, variant = 'world' }: { open: boolean; onOpenChange: (open: boolean) => void; variant?: 'world' | 'writing' }) {
  const toggle = useRef<HTMLButtonElement>(null)
  const wasOpen = useRef(open)
  useEffect(() => {
    if (wasOpen.current !== open) toggle.current?.focus()
    wasOpen.current = open
  }, [open])
  return open
    ? (
      <aside className={'studio-chat ' + (variant === 'writing' ? 'writing-chat' : 'world-chat')} aria-label="AI 채팅">
        <div className="studio-chat-head">
          <h2><span className="chat-brand" aria-hidden="true"><SparkIcon size={16} /></span>AI 채팅</h2>
          <button ref={toggle} type="button" className="chat-icon-btn" aria-label="접기" title="접기" onClick={() => onOpenChange(false)}><FoldIcon /></button>
        </div>
        <ChatPanel messages={[]} emptyTitle="어떤 세계를 함께 다듬어 볼까요?" emptyText="AI의 제안은 설정 카드에 자동으로 반영되지 않아요." suggestions={suggestions} disabledReason="준비 중 · AI 연결 후 이곳에서 보낼 수 있어요." />
      </aside>
    )
    : <button ref={toggle} type="button" className="studio-chat-toggle btn pri" onClick={() => onOpenChange(true)}>AI 채팅 열기</button>
}
