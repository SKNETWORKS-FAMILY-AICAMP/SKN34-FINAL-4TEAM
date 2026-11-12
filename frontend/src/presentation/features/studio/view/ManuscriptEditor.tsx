import Editor, { type EditorOptions, type PluginContext } from '@toast-ui/editor'
import '@toast-ui/editor/dist/i18n/ko-kr'
import '@toast-ui/editor/dist/theme/toastui-editor-dark.css'
import '@toast-ui/editor/dist/toastui-editor.css'
import { useEffect, useId, useImperativeHandle, useRef, useState, type Ref, type RefObject } from 'react'
import { createPortal } from 'react-dom'

import { BODY_MAX, bodyLength } from '../../../../domain/entities/manuscriptLength'
import { imageReferencePattern } from '../../../../domain/entities/media'
import { ManuscriptBody, StoredImage } from '../../../shared/media/MediaPanel'
import { useTheme } from '../../../shared/shell/useTheme'
import { escapeWithTab, TAB_ESCAPE_HINT } from '../../../shared/tabEscape'
import { forToast, loadMarkdown, type PMState, type State, type Transaction, type View } from '../../../shared/toastFixes'
import './manuscript-editor.css'

type Doc = State['doc']
type Span = { from: number; to: number }
type Cursor = { line: number; focus: boolean }
export type ManuscriptEditorHandle = {
  /** 편집기 커서 위치에 이미지를 올려 넣는다. 성공하면 true. focus=false면 편집기로 초점을 옮기지 않는다(시트 안에서 호출할 때). */
  addImage: (file: File, focus?: boolean) => Promise<boolean>
}

const LIMIT = `${BODY_MAX.toLocaleString('ko-KR')}자를 넘는 입력은 넣을 수 없어요.`
const IMAGE_ROW = '이미지가 있는 줄에는 이 동작을 쓸 수 없어요.'
/**
 * 이미지 표식 한 줄. 계약(원고 기본 서식)대로 줄 전체가 `[[image:<UUID>]]`일 때만 이미지다.
 * 공용 규칙(`imageMarker(id) === 줄`)과 같게 image는 소문자만, UUID는 대소문자를 가리지 않는다.
 */
const IMAGE_LINE = new RegExp(`^${imageReferencePattern.source.replaceAll('a-f', 'a-fA-F')}$`)
const imageFile = (files?: FileList | null) => Array.from(files ?? []).find(file => file.type.startsWith('image/'))

const icon = (name: string) => `${name} toastui-editor-toolbar-icons`
/**
 * 툴바는 여섯 개뿐이다: 굵게 · 기울임 | 소제목 · 인용 · 구분선 | 이미지.
 * Toast 기본 항목(문자열 'heading'·'image')은 제목 1~6단계 팝업과 이미지 주소 입력 팝업을 띄우므로 모두 직접 정한다(이름은 우리말, 아이콘은 Toast 것).
 * 이미지 자리(`image`)에는 편집기 컴포넌트가 파일 선택 버튼을 포털로 그린다.
 */
const toolbar = (image: HTMLElement): NonNullable<EditorOptions['toolbarItems']> => [
  [
    { name: 'bold', tooltip: '굵게', command: 'bold', className: icon('bold'), state: 'strong' },
    { name: 'italic', tooltip: '기울임', command: 'italic', className: icon('italic'), state: 'emph' },
  ],
  [
    { name: 'subheading', tooltip: '소제목', command: 'subheading', className: icon('heading'), state: 'heading' },
    { name: 'quote', tooltip: '인용', command: 'blockQuote', className: icon('quote'), state: 'blockQuote' },
    { name: 'hr', tooltip: '구분선', command: 'hr', className: icon('hrline'), state: 'thematicBreak' },
  ],
  [{ name: 'image', tooltip: '이미지', el: image }],
]

let slotKey = 0
/**
 * Toast 위젯 규칙이 이미지 표식 줄마다 부르는 자리 만들기. 빈 자리만 돌려주고, 편집기 컴포넌트가 화면에 붙은 자리를 찾아 기존 StoredImage를 포털로 그린다.
 * (Toast는 숨은 미리보기용으로도 한 번 더 부르는데 그 자리는 화면에 붙지 않으므로 아무것도 올리지 않는다.)
 */
function imageSlot(marker: string) {
  const slot = document.createElement('span')
  slot.className = 'manuscript-image'
  slot.dataset.imageId = IMAGE_LINE.exec(marker)?.[1] ?? ''
  slot.dataset.key = String(++slotKey)
  return slot
}

// Toast는 위젯(이미지) 노드의 글자를 `$$widget0 표식$$`로 감싸 문서에 둔다. `getMarkdown()`과 같은 방법으로 벗겨, 저장 문자열 기준의 글·길이·위치를 얻는다.
const WRAP = /\$\$widget\d+\s/
const unwrap = (line: string): string => {
  const at = line.search(WRAP)
  return at < 0 ? line : line.slice(0, at) + unwrap(line.slice(at).replace(WRAP, '').replace('$$', ''))
}
const unwrapAll = (text: string) => text.split('\n').map(unwrap).join('\n')
/** 문서의 처음부터 `to`까지를 저장 문자열로 읽는다(문단 하나 = 한 줄, 이미지 = 표식 한 줄). */
const bodyUpTo = (doc: Doc, to = doc.content.size) => unwrapAll(doc.textBetween(0, to, '\n'))
/**
 * 감싼 표기가 위젯 밖의 글자로 새어 나온 개수. Toast의 줄 단위 명령(소제목·인용·줄 옮기기 등)은 줄을 글자로 다시 만들며 위젯을 풀어 `$$widget0 …$$`를 그대로 드러낸다.
 * 이 수를 늘리는 입력을 막으면 편집 영역의 글자와 편집기가 내는 글(`getMarkdown()`)이 늘 같다.
 */
function leaked(doc: Doc) {
  let widgets = 0
  doc.descendants((node) => { if (node.type.name === 'widget') widgets += 1 })
  return doc.textBetween(0, doc.content.size, '\n').split(WRAP).length - 1 - widgets
}

type Props = {
  /** 저장 형식의 본문(글자 + 서식 기호 + 이미지 표식). 편집기가 낸 값과 다르게 바뀌면 새 문서로 보고 편집기를 다시 만든다. */
  value: string
  /** 편집 영역의 글자 그대로(`getMarkdown()`)를 준다. 열기만 하고 고치지 않으면 부르지 않는다. */
  onChange: (body: string) => void
  /** false면 잠깐 잠근다(사용자가 누른 저장·공개 등이 끝날 때까지): 편집기는 그대로 두고 입력·툴바만 막는다. 원작 기준(읽기 전용) 회차는 부르는 쪽이 편집기 대신 읽기 전용 본문을 그린다. */
  editable: boolean
  /** 진행 중인 요청이 있으면 툴바의 이미지 버튼을 잠근다. */
  busy?: boolean
  workId: string
  number: number
  /** 올린 이미지를 본문 [start, end)에 넣는 기존 업로드 경로(vm.addImage). 성공하면 true를 돌려주고 value가 바뀐다. */
  onImage: (file: File, start: number, end: number) => Promise<boolean>
  ref?: Ref<ManuscriptEditorHandle>
}

/**
 * 원고 편집기(Toast UI Editor 3, 마크다운 쓰기 모드). 저장 글은 편집 영역의 글자 그대로이고(왕복 무손실), 서식 기호는 그릴 때만 해석한다(계약: 원고 기본 서식, DEC-48).
 * 편집기 밖에서 본문이 바뀌면(회차 전환·다시 불러오기·복원·삭제·이미지 삽입) 새 편집기로 바꿔,
 * 되돌리기 기록이 다른 문서의 글을 되살리거나 삭제한 초안을 자동저장으로 되돌리지 못하게 한다.
 * 번들이 커서 부르는 쪽은 `LazyManuscriptEditor`로 늦게 불러온다.
 */
export function ManuscriptEditor({ value, onChange, ...rest }: Props) {
  const [seen, setSeen] = useState({ value, epoch: 0 })
  if (value !== seen.value) setSeen({ value, epoch: seen.epoch + 1 })
  // 이미지가 들어간 뒤 새 편집기가 커서를 둘 줄: 삽입 줄 + 빈 줄·표식·빈 줄(vm.addImage가 `\n\n표식\n\n`을 넣는다) 다음 줄이다.
  const cursor = useRef<Cursor | null>(null)
  // 작품·회차가 바뀌어도 새 편집기로 만든다(같은 글이어도 되돌리기 기록과 이미지 대상 회차를 이어 쓰지 않는다).
  return <Prose key={`${rest.workId}:${rest.number}:${seen.epoch}`} {...rest} value={value} cursor={cursor} onChange={body => { setSeen(s => ({ ...s, value: body })); onChange(body) }} />
}

function Prose({ value, onChange, editable, busy = false, workId, number, onImage, cursor, ref }: Props & { cursor: RefObject<Cursor | null> }) {
  const host = useRef<HTMLDivElement>(null)
  const file = useRef<HTMLInputElement>(null)
  // 지금 떠 있는 편집기: ProseMirror 화면과, 커서 자리에 이미지를 올리는 함수
  const pm = useRef<{ view: View; add: (file: File, focus: boolean) => Promise<boolean> } | null>(null)
  // 편집기로 초점을 돌려줄 일이 남았다(이미지 삽입으로 다시 만들어짐·올리기 실패). 잠긴 동안에는 초점을 받지 못하므로 풀릴 때 돌려준다.
  const wantFocus = useRef(false)
  // 편집기는 한 번만 만들므로 최신 값은 ref로 읽는다.
  const live = useRef({ editable, onChange, onImage })
  // 만들 때의 글만 쓴다. 이미지 삽입으로 다시 만들어진 편집기라면 커서를 둘 줄도 이때 한 번만 넘겨받는다.
  const [mount] = useState(() => { const at = cursor.current; cursor.current = null; return { value, at } })
  // Toast 툴바 안에서 이미지 버튼을 그릴 자리
  const [tool] = useState(() => { const el = document.createElement('span'); el.className = 'manuscript-tool'; return el })
  const [slots, setSlots] = useState<HTMLElement[]>([])
  const [notice, setNotice] = useState('')
  const [preview, setPreview] = useState(false)
  const { dark } = useTheme()
  const hint = useId()

  useEffect(() => { live.current = { editable, onChange, onImage } })

  useEffect(() => {
    const el = host.current!
    let view!: View
    let pmState!: PMState
    const upload = async (picked: File, at: Span, focus: boolean) => {
      if (!live.current.editable) return false
      const before = bodyUpTo(view.state.doc, at.from)
      cursor.current = { line: before.split('\n').length - 1 + 4, focus }
      const ok = await live.current.onImage(picked, before.length, bodyUpTo(view.state.doc, at.to).length)
      if (!ok) {
        cursor.current = null
        if (focus && pm.current?.view === view) { if (live.current.editable) view.focus(); else wantFocus.current = true }
      }
      return ok
    }
    // 화면에 붙은 이미지 위젯 자리를 원고 순서대로 다시 찾는다. 편집 상태가 바뀔 때마다 부른다(글을 고치지 않아도 ProseMirror가 줄을 다시 그리면 자리가 새로 만들어진다).
    let found: HTMLElement[] = []
    const findSlots = () => {
      const next = Array.from(view.dom.querySelectorAll<HTMLElement>('.manuscript-image'))
      if (next.length === found.length && next.every((slot, i) => slot === found[i])) return
      found = next
      setSlots(next)
    }
    const editor = new Editor({
      el,
      placeholder: '이야기를 이어 써 보세요',
      initialEditType: 'markdown',
      hideModeSwitch: true,
      previewStyle: 'tab',
      previewHighlight: false,
      height: 'auto',
      language: 'ko-KR',
      autofocus: false, // 회차를 열 때 초점을 가져가지 않는다
      usageStatistics: false, // 기본값은 호스트 이름을 Google Analytics로 보낸다
      toolbarItems: toolbar(tool),
      // Toast는 위젯 규칙을 모듈 전역에 두고 편집기를 만들 때마다 덮어쓴다. 규칙 없이 만드는 카드 편집기(세계관 작업실)와는 화면이 달라 번갈아 뜰 뿐이고,
      // 각자 만들 때 자기 규칙으로 덮어쓰므로 서로의 글·표시를 깨지 않는다. 두 편집기를 한 화면에 함께 띄우면 나중에 만든 쪽의 규칙이 둘 다에 적용된다.
      widgetRules: [{ rule: IMAGE_LINE, toDOM: imageSlot }],
      plugins: [(context: PluginContext) => {
        pmState = context.pmState
        return {
          markdownPlugins: [() => new pmState.Plugin({
            view: (editorView) => { view = editorView; return { update: findSlots } },
            props: {
              // 직접 붙여넣기(메뉴·모바일): 글자는 서식 없이 줄·빈 줄 그대로 넣고(기본 처리는 연속 줄바꿈을 합치고 HTML을 해석한다), 글자 없이 이미지뿐이면 업로드 경로로 올린다.
              // 문서 프로그램에서 복사한 글은 글자와 함께 그 모습의 이미지도 실려 오므로 글자가 있으면 글자가 먼저다.
              // Ctrl+V는 Toast가 자기 붙여넣기 칸(textarea)으로 받아 글자만 넣으며, 이미지는 아래 addImageBlobHook으로 온다.
              handlePaste: (_view, event) => {
                const text = event.clipboardData?.getData('text/plain')
                if (text) { editor.insertText(text); return true }
                const picked = imageFile(event.clipboardData?.files)
                if (!picked) return false
                void upload(picked, view.state.selection, true)
                return true
              },
              handleDOMEvents: {
                // 파일을 놓으면 이미지는 놓은 자리에 올리고, 그 밖의 파일은 브라우저가 열며 화면을 떠나지 않게 막는다.
                drop: (_view, event) => {
                  if (!event.dataTransfer?.files.length) return false
                  event.preventDefault()
                  const picked = imageFile(event.dataTransfer.files)
                  if (picked && live.current.editable) {
                    const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? view.state.selection.from
                    void upload(picked, { from: pos, to: pos }, true)
                  }
                  return true
                },
              },
            },
          })],
          // 소제목: 그 줄을 `## `(제목 2)로 바꾼다.
          markdownCommands: { subheading: () => { editor.exec('heading', { level: 2 }); return true } },
        }
      }],
      // Toast 기본 처리는 이미지를 data: 주소의 마크다운으로 본문에 넣는다. 서버는 올린 이미지만 받으므로 업로드 경로로 보낸다.
      hooks: { addImageBlobHook: (blob) => { if (blob instanceof File) void upload(blob, view.state.selection, true) } },
    })
    // Toast의 미리보기는 표준 마크다운이라 쓰지 않는다(우리 미리보기는 ManuscriptBody). 숨은 미리보기를 처음에도, 입력마다도 그리지 않게 갱신을 끊는다.
    editor.off('updatePreview')
    // 구문 강조가 실패하는 글도 열리게 하고, 처음 글을 넣은 되돌리기 기록을 비운다(shared/toastFixes).
    loadMarkdown(editor, view, mount.value)
    // 글을 넣은 뒤에 잇는다: 열기만 해서는 onChange를 부르지 않는다.
    editor.on('change', () => { setNotice(''); live.current.onChange(editor.getMarkdown()) })
    el.querySelector('.toastui-editor-md-tab-container')?.setAttribute('inert', '') // Toast의 자체 쓰기·미리보기 탭(CSS로도 감춘다)
    el.querySelector('.toastui-editor-toolbar-icons.more')?.setAttribute('aria-label', '더 보기') // 좁은 화면에서 넘친 항목을 여는 버튼
    // 글을 쓰는 곳(contenteditable)은 이름 없는 영역으로 읽히므로 여러 줄 입력으로 알린다.
    const input = view.dom
    input.setAttribute('role', 'textbox')
    input.setAttribute('aria-multiline', 'true')
    input.setAttribute('aria-label', '원고 본문')
    input.setAttribute('aria-describedby', hint)
    // Toast는 복사·잘라내기에 위젯의 내부 표기($$widget0 …$$)를 그대로 싣는다. 다른 곳에 붙여넣어도 표식 글자 그대로이게 벗긴다.
    const plain = (event: ClipboardEvent) => {
      const text = event.clipboardData?.getData('text/plain')
      if (text) event.clipboardData?.setData('text/plain', unwrapAll(text))
    }
    input.addEventListener('copy', plain)
    input.addEventListener('cut', plain)
    // 입력을 Toast에 넘기기 전에 거른다. ProseMirror의 filterTransaction으로는 막을 수 없다: Toast는 거르기 전에 자기 글(toastMark)부터 고쳐,
    // 거절된 입력이 getMarkdown()과 change 이벤트에 남는다. 그래서 Toast의 dispatchTransaction 앞에서 버린다.
    const pass = view.props.dispatchTransaction!
    const refuse = (why: string) => {
      if (why) setNotice(why)
      view.updateState(view.state) // 입력기(IME)가 화면에 먼저 써 둔 글자를 문서 상태로 되돌린다
    }
    view.setProps({
      // 커서를 따라 스크롤할 때 화면에 붙어 있는 툴바(위 46px)와 하단 바(아래 약 60px) 밑에 커서가 깔리지 않게 한다.
      scrollThreshold: { top: 56, right: 0, bottom: 72, left: 0 },
      scrollMargin: { top: 72, right: 0, bottom: 96, left: 0 },
      // 계약에 없는 서식을 넣는 Toast 단축키는 받지 않는다: 취소선(Ctrl+S)·목록(Ctrl+U·O)·코드(Ctrl+Shift+C·P). 저장하려고 누른 Ctrl+S가 원고에 `~~`를 넣지 않게 한다.
      // 화면의 속성이 Toast의 단축키 플러그인보다 먼저 불리고, 받았다고 답하면 브라우저의 기본 동작(페이지 저장 창 등)도 막힌다. 한글 입력 중에는 key가 자모로 오므로 자판 자리(code)로 가린다.
      handleKeyDown: (_view: View, event: KeyboardEvent) => (event.ctrlKey || event.metaKey) && !event.altKey
        && (['KeyS', 'KeyU', 'KeyO'].includes(event.code) || (event.shiftKey && ['KeyC', 'KeyP'].includes(event.code))),
      dispatchTransaction: (tr: Transaction) => {
        if (!tr.docChanged) return pass.call(view, tr)
        const before = view.state.doc
        // 잠긴 동안에는 툴바·붙여넣기를 포함한 모든 입력을 받지 않는다(inert를 모르는 환경에서도).
        if (!live.current.editable) return refuse('')
        if (leaked(tr.doc) > leaked(before)) return refuse(IMAGE_ROW)
        // 저장 문자열이 40,000자를 넘기는 입력은 막는다. 줄이는 입력은 늘 허용한다.
        const size = bodyLength(bodyUpTo(tr.doc))
        if (size > BODY_MAX && size > bodyLength(bodyUpTo(before))) return refuse(LIMIT)
        pass.call(view, forToast(tr, view.state, pmState))
      },
    })
    if (mount.at) {
      const line = Math.min(mount.at.line + 1, view.state.doc.childCount)
      editor.setSelection([line, 1], [line, 1])
      wantFocus.current = mount.at.focus
    }
    pm.current = { view, add: (picked, focus) => upload(picked, view.state.selection, focus) }
    const releaseTab = escapeWithTab(el)
    return () => {
      releaseTab()
      pm.current = null
      editor.destroy()
    }
  }, [mount, tool, hint, cursor])

  // live를 먼저 갱신해야 잠금 상태가 맞는다(효과는 정의한 순서대로 돈다).
  useEffect(() => {
    const view = pm.current?.view
    if (!view) return
    view.dom.setAttribute('aria-readonly', String(!editable))
    if (!editable || !wantFocus.current) return
    wantFocus.current = false
    view.focus()
    view.dispatch(view.state.tr.scrollIntoView())
  }, [editable])

  // 테마 전환은 편집기를 다시 만들지 않고 어두운 테마 클래스만 바꾼다(처음 만들 때도 같은 규칙).
  useEffect(() => {
    host.current?.querySelector('.toastui-editor-defaultUI')?.classList.toggle('toastui-editor-dark', dark)
  }, [dark])

  useImperativeHandle(ref, () => ({ addImage: (picked, focus = true) => pm.current?.add(picked, focus) ?? Promise.resolve(false) }), [])

  return (
    <div className="manuscript-editor">
      {/* Toast의 자체 탭·미리보기(표준 마크다운) 대신 우리 전환을 둔다. 미리보기는 독자 화면과 같은 공용 렌더러가 그린다. */}
      <div className="svw manuscript-modes" role="group" aria-label="원고 보기">
        <button type="button" className={preview ? undefined : 'on'} aria-pressed={!preview} onClick={() => setPreview(false)}>쓰기</button>
        <button type="button" className={preview ? 'on' : undefined} aria-pressed={preview} onClick={() => setPreview(true)}>미리보기</button>
      </div>
      {/* Toast가 툴바와 편집 영역을 이 안에 그린다. 미리보기 동안에는 함께 감춰 툴바를 쓸 수 없고, 편집기는 남겨 되돌리기 기록과 커서를 지킨다. */}
      <div ref={host} className="writing-body" hidden={preview} inert={!editable} />
      {preview && <div className="writing-body manuscript-preview" role="region" aria-label="원고 미리보기">
        {value ? <ManuscriptBody workId={workId} number={number} body={value} /> : <p className="small muted">아직 쓴 글이 없어요.</p>}
      </div>}
      <p id={hint} className="small muted manuscript-hint" hidden={preview}>{TAB_ESCAPE_HINT}</p>
      <p role="status" className="small writing-limit">{notice}</p>
      <input ref={file} hidden type="file" accept=".png,.jpg,.jpeg" onChange={(e) => { const picked = e.target.files?.[0]; e.target.value = ''; if (picked) void pm.current?.add(picked, true) }} />
      {createPortal(<button type="button" className={icon('image')} aria-label="이미지" disabled={busy} onClick={() => file.current?.click()} />, tool)}
      {/* 이미지 위젯: 편집기와 같은 React 트리에 포털로 올리므로 편집기를 없애거나 줄을 지우면 함께 정리된다. */}
      {slots.map((slot, i) => createPortal(<StoredImage target={{ kind: 'episode', workId, number }} id={slot.dataset.imageId ?? ''} alt={`본문 이미지 ${i + 1}`} />, slot, slot.dataset.key))}
    </div>
  )
}
