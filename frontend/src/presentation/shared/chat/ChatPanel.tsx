import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react'
import type { ChatAttachment, ChatMessage } from '../../../domain/entities/chat'
import { attachmentKind, type AttachmentCheck } from '../../../domain/entities/chatAttachment'
import { CardMarkdown } from '../CardMarkdown'
import { MicIcon, PlusIcon, SendIcon, SparkIcon } from '../icons'
import { PopMenu } from '../PopMenu'
import { isFileDrag, keepFiles } from './keepFiles'
import './chat.css'

const who = { user: '나', assistant: 'AI', system: '안내' } as const

// 첨부 종류별 칩 글자·+ 메뉴 항목·파일 선택 창이 거르는 형식(허용 여부는 checkFile이 다시 판정한다). 텍스트는 Windows에서 .md의 type이 비어 있어 확장자도 함께 건다.
const kinds = {
  image: { label: '이미지', menu: '이미지 첨부', accept: 'image/png,image/jpeg,image/webp' },
  text: { label: '텍스트', menu: '텍스트 파일 첨부', accept: '.txt,.md,text/plain,text/markdown' },
} as const
/** 보내려고 고른 파일. kind는 칩 표시용이다. */
type Picked = { file: File; kind: ChatAttachment['kind'] }

/**
 * 집필실 AI 채팅과 이후 캐릭터챗이 함께 쓰는 표시용 채팅이다. 메시지·전송·첨부는 모두 호출하는 화면이 맡고
 * 이 컴포넌트는 API를 부르거나 메시지를 저장하지 않는다.
 * - onSend(text, files): 전송을 시작하면 입력창과 고른 첨부를 비운다. false를 돌려주거나 던지면 새로 입력한 글·새로 고른 첨부가 없을 때 요청을 복구한다. 없으면 입력과 전송을 잠근다.
 *   files는 입력창 위 칩으로 보이던 파일이며 없으면 빈 목록이다(읽기·인코딩·20,000자 검사는 호출하는 화면이 한다).
 * - checkFile(file, count): 있으면 첨부를 켠다(+ 메뉴의 이미지·텍스트 항목, 입력 카드에 끌어다 놓기). count는 지금 고른 개수이고 허용이면 { name, mediaType },
 *   거절이면 입력 카드 아래에 role="alert"로 보일 이유 문구를 돌려준다. 없으면 + 버튼 안의 첨부를 '준비 중'으로 잠근다(가짜 업로드를 만들지 않는다).
 * - disabledReason: 있으면 입력·전송·첨부·추천 칩을 모두 잠그고 이 사유를 입력 카드 아래에 보여 준다.
 * - inputError: 보내기 전에 막힌 이유를 입력 카드 아래에 role="alert"로 보인다. '파일 이름: 이유' 모양(첨부 읽기 오류)이면 그 칩을 뺄 때 감추고 다음 전송이 같은 안내를 다시 내면 보인다.
 * - emptyTitle·emptyText·suggestions: 대화가 없을 때 보이는 제목·안내·추천 칩. 칩을 누르면 입력창에 글만 채운다(보내지 않는다).
 * - after: 메시지 뒤에 이어 그릴 것(진행 표시·승인 카드). 있으면 빈 상태 대신 그린다.
 * - renderCard: 메시지 글 바로 아래에 이어 그릴 카드(인물 시뮬레이션 장면 등). 이 카드가 있는 말풍선은 폭을 채운다.
 * - renderActions: 메시지 말풍선 아래의 행동(수정·삭제 등).
 * - inputRef: 메시지 입력창. 바깥에서 초점을 옮길 때(예: 되묻기 선택지를 누른 뒤) 넘긴다.
 * - sendNote: 다음 메시지에 함께 보내지는 것(선택한 글 등)을 입력 카드 위에 알린다. 잠긴 동안에는 보내지 않으므로 보이지 않는다.
 * - streaming: 흐르는 중인 글(없으면 undefined). 바뀌거나 끝날 때(완성된 답·실패 안내) 맨 아래에서 읽던 대화만 따라 내려간다(#618).
 */
export function ChatPanel({ messages, onSend, busy = false, checkFile, disabledReason, inputError, sendNote, emptyTitle, emptyText = '아직 대화가 없어요.', suggestions, after, streaming, renderCard, renderActions, inputRef }: {
  messages: ChatMessage[]
  onSend?: (text: string, files: File[]) => boolean | Promise<boolean>
  busy?: boolean
  checkFile?: (file: File, count: number) => AttachmentCheck
  disabledReason?: string
  inputError?: string
  sendNote?: string
  emptyTitle?: string
  emptyText?: string
  suggestions?: string[]
  after?: ReactNode
  streaming?: string
  renderCard?: (message: ChatMessage) => ReactNode
  renderActions?: (message: ChatMessage) => ReactNode
  inputRef?: RefObject<HTMLTextAreaElement | null>
}) {
  const [draft, setDraft] = useState('')
  const draftEdits = useRef(0)
  const changeDraft = (value: string) => { draftEdits.current += 1; setDraft(value); setFailed(false) }
  const own = useRef<HTMLTextAreaElement>(null)
  const box = inputRef ?? own
  const log = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)
  useEffect(() => {
    if (pinned.current && log.current) log.current.scrollTop = log.current.scrollHeight
  }, [streaming])
  // 선택 안내 같은 줄이 생기면 대화 영역이 줄어든다. 줄기 전에 맨 아래를 읽던 중이면 따라 내려가 승인 버튼을 가리지 않는다.
  // pinned로는 알 수 없다: 이력을 막 불러온 대화는 맨 위를 보이는데 스크롤한 적이 없어 true로 남는다.
  useEffect(() => {
    const el = log.current
    if (!el || typeof ResizeObserver !== 'function') return
    let height = el.clientHeight
    const watch = new ResizeObserver(() => {
      if (el.clientHeight === height) return
      if (el.scrollHeight - el.scrollTop - height < 80) el.scrollTop = el.scrollHeight
      height = el.clientHeight
    })
    watch.observe(el)
    return () => watch.disconnect()
  }, [])
  const files = useRef<Record<string, HTMLInputElement | null>>({})
  const [picked, setPicked] = useState<Picked[]>([])
  const [rejected, setRejected] = useState<string[]>([])
  const pickEdits = useRef(0)
  const id = useId()
  const errorId = `${id}-error`
  const reasonId = `${id}-reason`
  const noteId = `${id}-note`
  const attachId = `${id}-attach`
  // 보낼 때 읽지 못한 첨부의 안내(inputError)는 '파일 이름: 이유'다. 그 칩을 빼면 안내할 대상이 없으니 감추고, 다음 전송이 같은 안내를 다시 내면 새로 보인다.
  const [dismissed, setDismissed] = useState('')
  const shownError = inputError && inputError !== dismissed ? inputError : undefined
  const locked = !!disabledReason || !onSend
  const attachOff = locked || !checkFile
  const note = locked ? '' : sendNote
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
      else next.push({ file, kind: attachmentKind(checked.mediaType) })
    }
    pickEdits.current += 1
    setPicked(next)
    setRejected(reasons)
  }
  const remove = (index: number) => {
    pickEdits.current += 1
    if (inputError?.startsWith(`${picked[index].file.name}: `)) setDismissed(inputError)
    setPicked(picked.filter((_, i) => i !== index))
    setRejected([])
  }
  const submit = async () => {
    const text = draft.trim()
    if (!text || busy || locked || sending.current) return
    sending.current = true
    pinned.current = true // 보낸 사람은 새 답을 보려는 것이다
    setPending(true)
    setFailed(false)
    setDismissed('')
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
  // 파일 끌어다 놓기: 첨부가 켜져 있으면 패널 어디에 놓아도(대화 영역 포함, 잠긴 동안에도) 기본 동작을 막는다. 글자 끌기는 막지 않는다(#706).
  // 첨부로 받는 곳은 입력 카드뿐이고 잠기지 않았을 때만 받는다.
  return <div className="chat-panel" {...(checkFile && keepFiles)}>
    <div ref={log} className="chat-log" role="log" aria-label="대화 내용" aria-live="polite"
      onScroll={e => { const el = e.currentTarget; pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80 }}>
      {messages.length || after ? <><ol>{messages.map(m => <li key={m.id} className={`chat-msg ${m.role}`} data-failed={m.failed || undefined}>
        {m.role === 'assistant' && <span className="chat-avatar" aria-hidden="true"><SparkIcon size={16} /></span>}
        <div className="chat-bubble">
          <span className="chat-who sr-only">{who[m.role]}</span>
          {m.failed && <span className="sr-only">실패한 답변</span>}
          {m.format === 'markdown' ? <div className="chat-text chat-md"><CardMarkdown text={m.text} /></div> : <p className="chat-text">{m.text}</p>}
          {!!m.attachments?.length && <ul className="chat-chips" aria-label="첨부">{m.attachments.map(a => <li key={a.id} className="chip"><span className="chat-chip-name">{kinds[a.kind].label} · {a.name}</span></li>)}</ul>}
          {renderCard?.(m)}
          {renderActions?.(m)}
        </div>
      </li>)}</ol>{after}</> : <div className="chat-empty">
        <span className="chat-mark" aria-hidden="true"><SparkIcon size={28} /></span>
        {emptyTitle && <h3>{emptyTitle}</h3>}
        <p>{emptyText}</p>
        {!!suggestions?.length && <ul className="chat-suggest" aria-label="추천 질문" data-tour="chat-suggest">{suggestions.map(text => <li key={text}>
          <button type="button" className="chat-suggest-btn" disabled={locked} onClick={() => { changeDraft(text); box.current?.focus() }}>{text}</button>
        </li>)}</ul>}
      </div>}
    </div>
    <form className="chat-composer" data-tour="chat-composer" onSubmit={e => { e.preventDefault(); void submit() }}>
      {note && <p id={noteId} className="chat-note">{note}</p>}
      <div className={`chat-card${locked ? ' locked' : ''}`} onDrop={attachOff ? undefined : e => { if (isFileDrag(e)) add([...e.dataTransfer.files]) }}>
        {!!picked.length && <ul className="chat-chips chat-picked" aria-label="보낼 첨부">{picked.map((p, i) => <li key={`${p.file.name}-${i}`} className="chip">
          <span className="chat-chip-name">{kinds[p.kind].label} · {p.file.name}</span><button type="button" className="chat-chip-x" aria-label={`${p.file.name} 빼기`} onClick={() => remove(i)}>×</button>
        </li>)}</ul>}
        <textarea ref={box} aria-label="메시지" rows={2} value={draft} placeholder="AI에게 무엇이든 물어보세요" disabled={locked} aria-describedby={[disabledReason && reasonId, shownError && errorId, note && noteId].filter(Boolean).join(' ') || undefined}
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
            {Object.entries(kinds).map(([kind, k]) => <button key={kind} type="button" role="menuitem" disabled={attachOff} aria-describedby={!checkFile ? attachId : disabledReason ? reasonId : undefined} onClick={() => files.current[kind]?.click()}>{k.menu}</button>)}
            {!checkFile && <p id={attachId} className="chat-note">이미지·텍스트 파일 첨부는 준비 중이에요.</p>}
          </PopMenu>
          <button type="button" className="chat-icon-btn chat-mic" disabled aria-label="음성 입력 (준비 중)" title="음성 입력은 준비 중이에요"><MicIcon /></button>
          <button type="submit" className="chat-send" aria-label="전송" title="전송" disabled={locked || busy || pending || !draft.trim()}><SendIcon /></button>
        </div>
      </div>
      {rejected.map((reason, i) => <p key={`${i}-${reason}`} role="alert" className="chat-note">{reason}</p>)}
      {disabledReason && <p id={reasonId} className="chat-note">{disabledReason}</p>}
      {shownError && <p id={errorId} role="alert" className="chat-note">{shownError}</p>}
      {failed && <p role="alert" className="chat-note">메시지를 보내지 못했어요. 다시 시도해 주세요.</p>}
      {/* 파일 선택은 첨부 메뉴가 닫혀도 남아 있어야 고른 파일을 받을 수 있다. */}
      {checkFile && Object.entries(kinds).map(([kind, k]) => <input key={kind} hidden multiple type="file" accept={k.accept} ref={el => { files.current[kind] = el }}
        onChange={e => { const list = [...(e.target.files ?? [])]; e.target.value = ''; if (list.length) add(list) }} />)}
    </form>
  </div>
}
