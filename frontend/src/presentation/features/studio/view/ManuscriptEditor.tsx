import { useEffect, useImperativeHandle, useRef, useState, type Ref, type RefObject } from 'react'
import { Extension, Node, type Editor } from '@tiptap/core'
import Document from '@tiptap/extension-document'
import Paragraph from '@tiptap/extension-paragraph'
import Text from '@tiptap/extension-text'
import { Dropcursor, Placeholder, UndoRedo } from '@tiptap/extensions'
import { Fragment, Slice, type Node as PMNode, type Schema } from '@tiptap/pm/model'
import { NodeSelection, Plugin, Selection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { EditorContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor, type NodeViewProps } from '@tiptap/react'

import { bodyToDoc, docToBody } from '../../../../domain/entities/manuscriptDoc'
import { BODY_MAX, bodyLength } from '../../../../domain/entities/manuscriptLength'
import { imageMarker } from '../../../../domain/entities/media'
import { StoredImage } from '../../../shared/media/MediaPanel'

type ImageOptions = { workId: string; number: number }
type Cursor = { line: number; focus: boolean }
type Span = { from: number; to: number }
export type ManuscriptEditorHandle = {
  /** 편집기 커서 위치에 이미지를 올려 넣는다. 성공하면 true. focus=false면 편집기로 초점을 옮기지 않는다(시트 안에서 호출할 때). */
  addImage: (file: File, focus?: boolean) => Promise<boolean>
}

// 저장 문자열의 이미지 표식 자리. 본문 안 위치와 길이는 이 규칙(문단 사이 \n, 이미지 = 표식 한 줄)으로 센다.
const leaf = (node: PMNode) => imageMarker(String(node.attrs.imageId))
const offsetAt = (doc: PMNode, pos: number) => doc.textBetween(0, pos, '\n', leaf).length
// 붙여넣은 일반 텍스트도 저장과 같은 규칙(줄바꿈 = 문단, 빈 줄 = 빈 문단)으로 읽어 빈 줄이 합쳐지지 않게 한다.
const textSlice = (schema: Schema, text: string) => new Slice(Fragment.fromJSON(schema, bodyToDoc(text).content), 1, 1)
const imageFile = (files?: FileList | null) => Array.from(files ?? []).find(file => file.type.startsWith('image/'))

function ImageView({ node, extension, editor, getPos }: NodeViewProps) {
  const { workId, number }: ImageOptions = extension.options
  // 여러 장을 구분할 수 있게 원고 안 순서를 대체 텍스트에 붙인다(저장 버전 미리보기의 '본문 이미지 n'과 같은 번호).
  // 앞의 이미지를 지우면 이 블록이 다시 그려질 때까지 옛 번호가 남지만 서로 겹치지는 않는다.
  const at = getPos()
  let order = 1
  if (at !== undefined) editor.state.doc.forEach((block, offset) => { if (offset < at && block.type.name === 'episodeImage') order++ })
  return <NodeViewWrapper className="manuscript-image"><StoredImage target={{ kind: 'episode', workId, number }} id={String(node.attrs.imageId)} alt={`본문 이미지 ${order}`} /></NodeViewWrapper>
}

/** 원고 안 이미지 한 장(블록). 저장 형식은 `[[image:<id>]]` 한 줄이라 id만 갖고, 화면에는 기존 StoredImage로 실제 이미지를 그린다. */
const EpisodeImage = Node.create<ImageOptions>({
  name: 'episodeImage',
  group: 'block',
  atom: true,
  addOptions: () => ({ workId: '', number: 0 }),
  addAttributes: () => ({ imageId: { default: '', parseHTML: el => el.getAttribute('data-episode-image'), renderHTML: attrs => ({ 'data-episode-image': attrs.imageId }) } }),
  // 붙여넣은 외부 HTML의 아무 값이나 이미지 조회 주소로 쓰지 않도록, 서버 이미지 id(UUID)만 이미지 블록으로 받는다.
  parseHTML: () => [{ tag: 'div[data-episode-image]', getAttrs: el => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(el.getAttribute('data-episode-image') ?? '') ? null : false }],
  renderHTML: ({ HTMLAttributes }) => ['div', HTMLAttributes],
  addNodeView: () => ReactNodeViewRenderer(ImageView),
})

/** 저장 문자열이 40,000자를 넘기는 입력은 막는다(textarea의 maxLength와 같다). 줄이는 입력은 늘 허용한다. */
const MaxLength = Extension.create<{ onLimit: () => void }>({
  name: 'maxLength',
  addOptions: () => ({ onLimit: () => {} }),
  addProseMirrorPlugins() {
    const { onLimit } = this.options
    return [new Plugin({
      filterTransaction: (tr, state) => {
        if (!tr.docChanged) return true
        const next = bodyLength(docToBody(tr.doc.toJSON()))
        if (next <= BODY_MAX || next <= bodyLength(docToBody(state.doc.toJSON()))) return true
        onLimit()
        return false
      },
    })]
  },
})

type Props = {
  /** 저장 형식의 본문(일반 텍스트 + 이미지 표식). 편집기가 낸 값과 다르게 바뀌면 새 문서로 보고 편집기를 다시 만든다. */
  value: string
  onChange: (body: string) => void
  editable: boolean
  workId: string
  number: number
  /** 올린 이미지를 본문 [start, end)에 넣는 기존 업로드 경로(vm.addImage). 성공하면 true를 돌려주고 value가 바뀐다. */
  onImage: (file: File, start: number, end: number) => Promise<boolean>
  ref?: Ref<ManuscriptEditorHandle>
}

/**
 * 서식 없는 원고 편집기(Tiptap): 문단과 이미지 블록만 있다.
 * 편집기 밖에서 본문이 바뀌면(회차 전환·다시 불러오기·복원·삭제·이미지 삽입) 새 편집기로 바꿔,
 * 되돌리기 기록이 다른 문서의 글을 되살리거나 삭제한 초안을 자동저장으로 되돌리지 못하게 한다.
 */
export function ManuscriptEditor({ value, onChange, ...rest }: Props) {
  const [seen, setSeen] = useState({ value, epoch: 0 })
  if (value !== seen.value) setSeen({ value, epoch: seen.epoch + 1 })
  // 이미지가 들어간 뒤 새 편집기가 커서를 둘 줄: 삽입 줄 + 빈 줄·표식·빈 줄(vm.addImage가 `\n\n표식\n\n`을 넣는다) 다음 줄이다.
  const cursor = useRef<Cursor | null>(null)
  // 작품·회차가 바뀌어도 새 편집기로 만든다(같은 글이어도 되돌리기 기록과 이미지 대상 회차를 이어 쓰지 않는다).
  return <Prose key={`${rest.workId}:${rest.number}:${seen.epoch}`} {...rest} value={value} cursor={cursor} onChange={body => { setSeen(s => ({ ...s, value: body })); onChange(body) }} />
}

async function putImage(view: EditorView, file: File, at: Span, focus: boolean, onImage: Props['onImage'], cursor: RefObject<Cursor | null>) {
  const start = offsetAt(view.state.doc, at.from)
  const end = offsetAt(view.state.doc, at.to)
  cursor.current = { line: docToBody(view.state.doc.toJSON()).slice(0, start).split('\n').length - 1 + 4, focus }
  const ok = await onImage(file, start, end)
  if (!ok) { cursor.current = null; if (focus && !view.isDestroyed) view.focus() }
  return ok
}

function Prose({ value, onChange, editable, workId, number, onImage, cursor, ref }: Props & { cursor: RefObject<Cursor | null> }) {
  const [limited, setLimited] = useState(false)
  // 편집기 옵션은 한 번만 만들므로 최신 값은 ref로 읽는다.
  const live = useRef({ editable, onChange, onImage })
  // 옵션은 이 편집기의 수명 동안 한 번만 만든다(렌더마다 새 객체를 넘기면 useEditor가 매번 옵션을 다시 적용한다).
  const [options] = useState(() => ({
    extensions: [
      Document, Paragraph, Text, UndoRedo,
      Dropcursor.configure({ color: false, width: 2, class: 'manuscript-dropcursor' }),
      Placeholder.configure({ placeholder: '이야기를 이어 써 보세요' }),
      EpisodeImage.configure({ workId, number }),
      MaxLength.configure({ onLimit: () => setLimited(true) }),
    ],
    content: bodyToDoc(value),
    editable,
    editorProps: {
      attributes: () => ({ role: 'textbox', 'aria-multiline': 'true', 'aria-label': '원고 본문', 'aria-readonly': String(!live.current.editable) }),
      clipboardTextParser: (text: string, _context: unknown, _plain: boolean, view: EditorView) => textSlice(view.state.schema, text),
      clipboardTextSerializer: (slice: Slice) => slice.content.textBetween(0, slice.content.size, '\n', leaf),
      scrollMargin: { top: 24, right: 0, bottom: 96, left: 0 },
      // 이미지 파일을 붙여넣거나 끌어다 놓으면 기존 업로드 경로로 올린다. 편집할 수 없을 때(저장 중·읽기 전용)는 ProseMirror가 이 핸들러를 부르지 않는다.
      handlePaste: (view: EditorView, event: ClipboardEvent) => {
        const file = imageFile(event.clipboardData?.files)
        if (!file) return false
        event.preventDefault()
        void putImage(view, file, view.state.selection, true, live.current.onImage, cursor)
        return true
      },
      handleDrop: (view: EditorView, event: DragEvent, _slice: Slice, moved: boolean) => {
        const file = moved ? undefined : imageFile(event.dataTransfer?.files)
        if (!file) return false
        event.preventDefault()
        const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? view.state.selection.from
        void putImage(view, file, { from: pos, to: pos }, true, live.current.onImage, cursor)
        return true
      },
    },
    onUpdate: ({ editor: e }: { editor: Editor }) => { setLimited(false); live.current.onChange(docToBody(e.getJSON())) },
  }))
  const editor = useEditor(options)

  useEffect(() => { live.current = { editable, onChange, onImage } })
  // live를 먼저 갱신해야 aria-readonly가 새 값을 읽는다(효과는 정의한 순서대로 돈다).
  useEffect(() => { editor.setEditable(editable, false) }, [editor, editable])

  // 이미지 삽입으로 다시 만들어진 편집기라면 이미지 다음 줄에 커서를 두고, 편집기에서 시작한 동작이면 초점도 돌려준다.
  useEffect(() => {
    const at = cursor.current
    if (!at) return
    cursor.current = null
    const { doc } = editor.state
    let pos = 0
    for (let i = 0; i < at.line && i < doc.childCount; i++) pos += doc.child(i).nodeSize
    editor.view.dispatch(editor.state.tr.setSelection(Selection.near(doc.resolve(pos), 1)).scrollIntoView())
    if (at.focus) editor.view.focus()
  }, [editor, cursor])

  useImperativeHandle(ref, () => ({
    addImage: (file, focus = true) => {
      const { selection } = editor.state
      // 이미지 블록이 선택돼 있으면 그 이미지를 바꾸지 않고 바로 뒤에 넣는다.
      const at = selection instanceof NodeSelection ? { from: selection.to, to: selection.to } : selection
      return putImage(editor.view, file, at, focus, live.current.onImage, cursor)
    },
  }), [editor, cursor])

  return <>
    <EditorContent editor={editor} className="writing-body" />
    <p role="status" className="small writing-limit">{limited ? `${BODY_MAX.toLocaleString('ko-KR')}자를 넘는 입력은 넣을 수 없어요.` : ''}</p>
  </>
}
