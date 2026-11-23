import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import type { ChatAttachment, ChatMessage } from '../../../domain/entities/chat'
import { attachmentKind, type AttachmentCheck } from '../../../domain/entities/chatAttachment'
import { CardMarkdown } from '../CardMarkdown'
import { MicIcon, PlusIcon, SendIcon, SparkIcon } from '../icons'
import { PopMenu } from '../PopMenu'
import './chat.css'

const who = { user: '나', assistant: 'AI', system: '안내' } as const

const kinds = ['image', 'text'] as const
const kindLabel = { image: '이미지', text: '텍스트' } as const
const menuLabel = { image: '이미지 첨부', text: '텍스트 파일 첨부' } as const
// 파일 선택 창이 거르는 형식(허용 여부는 checkFile이 다시 판정한다). 텍스트는 Windows에서 .md의 type이 비어 있어 확장자도 함께 건다.
const accept = { image: 'image/png,image/jpeg,image/webp', text: '.txt,.md,text/plain,text/markdown' } as const
/** 보내려고 고른 파일. kind는 칩 표시용이다. */
type Picked = { file: File; name: string; kind: ChatAttachment['kind'] }

/**
 * 집필실 AI 채팅과 이후 캐릭터챗이 함께 쓰는 표시용 채팅이다. 메시지·전송·첨부는 모두 호출하는 화면이 맡고
 * 이 컴포넌트는 API를 부르거나 메시지를 저장하지 않는다.
 * - onSend(text, files): 전송을 시작하면 입력창과 고른 첨부를 비운다. false를 돌려주거나 던지면 새로 입력한 글·새로 고른 첨부가 없을 때 요청을 복구한다. 없으면 입력과 전송을 잠근다.
 *   files는 입력창 위 칩으로 보이던 파일이며 없으면 빈 목록이다(읽기·인코딩·20,000자 검사는 호출하는 화면이 한다).
 * - checkFile(file, count): 있으면 첨부를 켠다(+ 메뉴의 이미지·텍스트 항목, 입력 카드에 끌어다 놓기). count는 지금 고른 개수이고 허용이면 { name, mediaType },
 *   거절이면 입력 카드 아래에 role="alert"로 보일 이유 문구를 돌려준다. 없으면 + 버튼 안의 첨부를 '준비 중'으로 잠근다(가짜 업로드를 만들지 않는다).
 * - disabledReason: 있으면 입력·전송·첨부·추천 칩을 모두 잠그고 이 사유를 입력 카드 아래에 보여 준다.
 * - emptyTitle·emptyText·suggestions: 대화가 없을 때 보이는 제목·안내·추천 칩. 칩을 누르면 입력창에 글만 채운다(보내지 않는다).
 * - after: 메시지 뒤에 이어 그릴 것(진행 표시·승인 카드). 있으면 빈 상태 대신 그린다.
 * - renderCard: 메시지 글 바로 아래에 이어 그릴 카드(인물 시뮬레이션 장면 등). 이 카드가 있는 말풍선은 폭을 채운다.
 * - renderActions: 메시지 말풍선 아래의 행동(수정·삭제 등).
 * - streaming: 흐르는 중인 글(없으면 undefined). 바뀌거나 끝날 때(완성된 답·실패 안내) 맨 아래에서 읽던 대화만 따라 내려간다(#618).
 */
export function ChatPanel({ messages, onSend, busy = false, checkFile, disabledReason, inputError, emptyTitle, emptyText = '아직 대화가 없어요.', suggestions, after, streaming, renderCard, renderActions }: {
  messages: ChatMessage[]
  onSend?: (text: string, files: File[]) => boolean | Promise<boolean>
  busy?: boolean
  checkFile?: (file: File, count: number) => AttachmentCheck
  disabledReason?: string
  inputError?: string
  emptyTitle?: string
  emptyText?: string
  suggestions?: string[]
  after?: ReactNode
  streaming?: string
  renderCard?: (message: ChatMessage) => ReactNode
  renderActions?: (message: ChatMessage) => ReactNode
}) {
  const [draft, setDraft] = useState('')
  const draftEdits = useRef(0)
  const changeDraft = (value: string) => { draftEdits.current += 1; setDraft(value); setFailed(false) }
  const box = useRef<HTMLTextAreaElement>(null)
  const log = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  useEffect(() => {
    if (pinned.current && log.current) log.current.scrollTop = log.current.scrollHeight
  }, [streaming])
  const files = useRef<Record<ChatAttachment['kind'], HTMLInputElement | null>>({ image: null, text: null })
  const [picked, setPicked] = useState<Picked[]>([])
  const [rejected, setRejected] = useState<string[]>([])
  const pickEdits = useRef(0)
  const id = useId()
  const errorId = `${id}-error`
  const reasonId = `${id}-reason`
  const attachId = `${id}-attach`
  const locked = !!disabledReason || !onSend
  const attachOff = locked || !checkFile
  // busy를 넘기지 않는 화면에서도 응답을 기다리는 동안 같은 입력을 다시 보내지 않는다.
  // ref는 같은 틱의 중복 호출을 막고, pending은 그 사이 전송 버튼을 잠가 보이게 한다.
  const sending = useRef(false)
  const [pending, setPending] = useState(false)
  const [failed, setFailed] = useState(false)
  // 고른 파일마다 검사한다: 받는 파일은 칩이 되고 거절된 파일은 이유가 이번 시도의 안내가 된다(이전 안내는 덮는다).
  const add = (list: File[]) => {
    const next = [...picked]
    const reasons: string[] = []
    for (const file of list) {
      const checked = checkFile!(file, next.length)
      if (typeof checked === 'string') reasons.push(checked)
      else next.push({ file, name: checked.name, kind: attachmentKind(checked.mediaType) })
    }
    pickEdits.current += 1
    setPicked(next)
    setRejected(reasons)
  }
  const remove = (index: number) => { pickEdits.current += 1; setPicked(picked.filter((_, i) => i !== index)); setRejected([]) }
  const submit = async () => {
    const text = draft.trim()
    if (!text || busy || locked || sending.current) return
    sending.current = true
    pinned.current = true // 보낸 사람은 새 답을 보려는 것이다
    setPending(true)
    setFailed(false)
    const submittedEdits = draftEdits.current
    const submittedPicks = pickEdits.current
    const sentPicked = picked
    setDraft('')
    setPicked([])
    setRejected([])
    let sent = false
    try {
      sent = await onSend(text, sentPicked.map(p => p.file))
    } catch {
      setFailed(true)
    } finally {
      if (!sent && draftEdits.current === submittedEdits) setDraft(draft)
      if (!sent && pickEdits.current === submittedPicks) setPicked(sentPicked)
      sending.current = false
      setPending(false)
    }
  }
  return <div className="chat-panel">
    <div ref={log} className="chat-log" role="log" aria-label="대화 내용" aria-live="polite"
      onScroll={e => { const el = e.currentTarget; pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80 }}>
      {messages.length || after ? <><ol>{messages.map(m => <li key={m.id} className={`chat-msg ${m.role}`} data-failed={m.failed || undefined}>
        {m.role === 'assistant' && <span className="chat-avatar" aria-hidden="true"><SparkIcon size={16} /></span>}
        <div className="chat-bubble">
          <span className="chat-who sr-only">{who[m.role]}</span>
          {m.format === 'markdown' ? <div className="chat-text chat-md"><CardMarkdown text={m.text} /></div> : <p className="chat-text">{m.text}</p>}
          {!!m.attachments?.length && <ul className="chat-chips" aria-label="첨부">{m.attachments.map(a => <li key={a.id} className="chip"><span className="chat-chip-name">{kindLabel[a.kind]} · {a.name}</span></li>)}</ul>}
          {renderCard?.(m)}
          {renderActions?.(m)}
        </div>
      </li>)}</ol>{after}</> : <div className="chat-empty">
        <span className="chat-mark" aria-hidden="true"><SparkIcon size={28} /></span>
        {emptyTitle && <h3>{emptyTitle}</h3>}
        <p>{emptyText}</p>
        {!!suggestions?.length && <ul className="chat-suggest" aria-label="추천 질문">{suggestions.map(text => <li key={text}>
          <button type="button" className="chat-suggest-btn" disabled={locked} onClick={() => { changeDraft(text); box.current?.focus() }}>{text}</button>
        </li>)}</ul>}
      </div>}
    </div>
    <form className="chat-composer" onSubmit={e => { e.preventDefault(); void submit() }}>
      {/* 파일을 놓을 수 있는 곳: 첨부가 켜져 있으면 잠긴 동안에도 기본 동작(브라우저가 파일을 열어 화면을 떠남)을 막고, 첨부는 잠기지 않았을 때만 받는다. */}
      <div className={`chat-card${locked ? ' locked' : ''}`} onDragOver={checkFile ? e => e.preventDefault() : undefined}
        onDrop={checkFile ? e => { e.preventDefault(); if (!attachOff) add([...e.dataTransfer.files]) } : undefined}>
        {!!picked.length && <ul className="chat-chips chat-picked" aria-label="보낼 첨부">{picked.map((p, i) => <li key={`${p.name}-${i}`} className="chip">
          <span className="chat-chip-name">{kindLabel[p.kind]} · {p.name}</span><button type="button" className="chat-chip-x" aria-label={`${p.name} 빼기`} onClick={() => remove(i)}>×</button>
        </li>)}</ul>}
        <textarea ref={box} aria-label="메시지" rows={2} value={draft} placeholder="AI에게 무엇이든 물어보세요" disabled={locked} aria-describedby={disabledReason ? reasonId : inputError ? errorId : undefined}
          onChange={e => changeDraft(e.target.value)}
          onKeyDown={e => {
            // Safari는 조합 확정 Enter를 isComposing=false, keyCode=229로 보낸다
            if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return
            e.preventDefault()
            void submit()
          }} />
        <div className="chat-tools">
          <PopMenu className="chat-attach" label="첨부" icon={<PlusIcon />}>
            {/* 잠긴 항목은 초점을 받지 못한다: 여기 건 사유를 PopMenu가 메뉴 설명으로 이어 메뉴에 들어설 때 읽히게 한다. */}
            {kinds.map(kind => <button key={kind} type="button" role="menuitem" disabled={attachOff} aria-describedby={!checkFile ? attachId : disabledReason ? reasonId : undefined} onClick={() => files.current[kind]?.click()}>{menuLabel[kind]}</button>)}
            {!checkFile && <p id={attachId} className="chat-note">이미지·텍스트 파일 첨부는 준비 중이에요.</p>}
          </PopMenu>
          <button type="button" className="chat-icon-btn chat-mic" disabled aria-label="음성 입력 (준비 중)" title="음성 입력은 준비 중이에요"><MicIcon /></button>
          <button type="submit" className="chat-send" aria-label="전송" title="전송" disabled={locked || busy || pending || !draft.trim()}><SendIcon /></button>
        </div>
      </div>
      {rejected.map((reason, i) => <p key={`${i}-${reason}`} role="alert" className="chat-note">{reason}</p>)}
      {disabledReason && <p id={reasonId} className="chat-note">{disabledReason}</p>}
      {inputError && <p id={errorId} role="alert" className="chat-note">{inputError}</p>}
      {failed && <p role="alert" className="chat-note">메시지를 보내지 못했어요. 다시 시도해 주세요.</p>}
      {/* 파일 선택은 첨부 메뉴가 닫혀도 남아 있어야 고른 파일을 받을 수 있다. */}
      {checkFile && kinds.map(kind => <input key={kind} hidden multiple type="file" accept={accept[kind]} ref={el => { files.current[kind] = el }}
        onChange={e => { const list = [...(e.target.files ?? [])]; e.target.value = ''; if (list.length) add(list) }} />)}
    </form>
  </div>
}
