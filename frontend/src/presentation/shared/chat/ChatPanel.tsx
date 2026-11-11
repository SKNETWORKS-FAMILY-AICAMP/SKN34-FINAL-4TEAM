import { useId, useRef, useState } from 'react'
import type { ChatAttachment, ChatMessage } from '../../../domain/entities/chat'
import { MicIcon, PlusIcon, SendIcon, SparkIcon } from '../icons'
import { PopMenu } from '../PopMenu'
import './chat.css'

const who = { user: '나', assistant: 'AI', system: '안내' } as const
const kinds = ['image', 'audio'] as const
const kindLabel = { image: '이미지', audio: '음성' } as const

/**
 * 집필실 AI 채팅과 이후 캐릭터 챗이 함께 쓰는 표시용 채팅이다. 메시지·전송·첨부는 모두 호출하는 화면이 맡고
 * 이 컴포넌트는 API를 부르거나 메시지를 저장하지 않는다.
 * - onSend: true를 돌려줘야 입력창을 비운다(실패하면 false로 돌려주고 사유는 화면이 보여 준다). 던지면 입력을 남기고 일반 실패 안내를 보인다. 없으면 입력과 전송을 잠근다.
 * - onAttach: 없으면 + 버튼 안의 이미지·음성 첨부를 '준비 중'으로 잠근다(가짜 업로드를 만들지 않는다).
 * - disabledReason: 있으면 입력·전송·첨부·추천 칩을 모두 잠그고 이 사유를 입력 카드 아래에 보여 준다.
 * - emptyTitle·emptyText·suggestions: 대화가 없을 때 보이는 제목·안내·추천 칩. 칩을 누르면 입력창에 글만 채운다(보내지 않는다).
 */
export function ChatPanel({ messages, onSend, busy = false, onAttach, disabledReason, emptyTitle, emptyText = '아직 대화가 없어요.', suggestions }: {
  messages: ChatMessage[]
  onSend?: (text: string) => boolean | Promise<boolean>
  busy?: boolean
  onAttach?: (kind: ChatAttachment['kind'], file: File) => void
  disabledReason?: string
  emptyTitle?: string
  emptyText?: string
  suggestions?: string[]
}) {
  const [draft, setDraft] = useState('')
  const box = useRef<HTMLTextAreaElement>(null)
  const files = useRef<Record<ChatAttachment['kind'], HTMLInputElement | null>>({ image: null, audio: null })
  const id = useId()
  const reasonId = `${id}-reason`
  const attachId = `${id}-attach`
  const locked = !!disabledReason || !onSend
  const attachOff = locked || !onAttach
  // busy를 넘기지 않는 화면에서도 응답을 기다리는 동안 같은 입력을 다시 보내지 않는다.
  // ref는 같은 틱의 중복 호출을 막고, pending은 그 사이 전송 버튼을 잠가 보이게 한다.
  const sending = useRef(false)
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)
  const submit = async () => {
    const text = draft.trim()
    if (!text || busy || locked || sending.current) return
    sending.current = true
    setPending(true)
    setFailed(false)
    try {
      // 기다리는 사이 새로 입력한 글은 지우지 않는다.
      if (await onSend(text)) setDraft(d => d.trim() === text ? '' : d)
    } catch {
      // 계약은 실패를 false로 돌려주는 것이다. 그래도 던지면 입력을 남기고 알린다(처리되지 않은 거부로 새지 않게).
      setFailed(true)
    } finally { sending.current = false; setPending(false) }
  }
  return <div className="chat-panel">
    <div className="chat-log" role="log" aria-label="대화 내용" aria-live="polite">
      {messages.length ? <ol>{messages.map(m => <li key={m.id} className={`chat-msg ${m.role}`}>
        {m.role === 'assistant' && <span className="chat-avatar" aria-hidden="true"><SparkIcon size={16} /></span>}
        <div className="chat-bubble">
          <span className="chat-who sr-only">{who[m.role]}</span>
          <p className="chat-text">{m.text}</p>
          {!!m.attachments?.length && <ul className="chat-chips" aria-label="첨부">{m.attachments.map(a => <li key={a.id} className="chip">{kindLabel[a.kind]} · {a.name}</li>)}</ul>}
        </div>
      </li>)}</ol> : <div className="chat-empty">
        <span className="chat-mark" aria-hidden="true"><SparkIcon size={28} /></span>
        {emptyTitle && <h3>{emptyTitle}</h3>}
        <p>{emptyText}</p>
        {!!suggestions?.length && <ul className="chat-suggest" aria-label="추천 질문">{suggestions.map(text => <li key={text}>
          <button type="button" className="chat-suggest-btn" disabled={locked} onClick={() => { setDraft(text); box.current?.focus() }}>{text}</button>
        </li>)}</ul>}
      </div>}
    </div>
    <form className="chat-composer" onSubmit={e => { e.preventDefault(); void submit() }}>
      <div className={`chat-card${locked ? ' locked' : ''}`}>
        <textarea ref={box} aria-label="메시지" rows={2} value={draft} placeholder="AI에게 무엇이든 물어보세요" disabled={locked} aria-describedby={disabledReason ? reasonId : undefined}
          onChange={e => { setDraft(e.target.value); setFailed(false) }}
          onKeyDown={e => {
            // Safari는 조합 확정 Enter를 isComposing=false, keyCode=229로 보낸다
            if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return
            e.preventDefault()
            void submit()
          }} />
        <div className="chat-tools">
          <PopMenu className="chat-attach" label="첨부" icon={<PlusIcon />}>
            {kinds.map(kind => <button key={kind} type="button" role="menuitem" disabled={attachOff} aria-describedby={onAttach ? undefined : attachId} onClick={() => files.current[kind]?.click()}>{kindLabel[kind]} 첨부</button>)}
            {!onAttach && <p id={attachId} className="chat-note">이미지·음성 첨부는 준비 중이에요.</p>}
          </PopMenu>
          <button type="button" className="chat-icon-btn chat-mic" disabled aria-label="음성 입력 (준비 중)" title="음성 입력은 준비 중이에요"><MicIcon /></button>
          <button type="submit" className="chat-send" aria-label="전송" title="전송" disabled={locked || busy || pending || !draft.trim()}><SendIcon /></button>
        </div>
      </div>
      {disabledReason && <p id={reasonId} className="chat-note">{disabledReason}</p>}
      {failed && <p role="alert" className="chat-note">보내지 못했어요. 입력은 그대로 남아 있어요. 다시 시도해 주세요.</p>}
      {/* 파일 선택은 첨부 메뉴가 닫혀도 남아 있어야 고른 파일을 받을 수 있다. */}
      {onAttach && kinds.map(kind => <input key={kind} hidden type="file" accept={`${kind}/*`} ref={el => { files.current[kind] = el }}
        onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) onAttach(kind, file) }} />)}
    </form>
  </div>
}
