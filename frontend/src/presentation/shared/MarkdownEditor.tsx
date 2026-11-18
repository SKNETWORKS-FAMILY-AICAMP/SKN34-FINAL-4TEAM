import Editor, { type CustomHTMLRenderer, type MdNode, type PluginContext } from '@toast-ui/editor'
import '@toast-ui/editor/dist/i18n/ko-kr'
import '@toast-ui/editor/dist/theme/toastui-editor-dark.css'
import '@toast-ui/editor/dist/toastui-editor.css'
import { useEffect, useId, useRef, useState } from 'react'

import { cardLinkMarkdown, cardLinkOf } from '../../domain/entities/cardLinks'
import './MarkdownEditor.css'
import { useTheme } from './shell/useTheme'
import { forToast, loadMarkdown, type PMState, type Transaction, type View } from './toastFixes'
import { escapeWithTab, TAB_ESCAPE_HINT } from './tabEscape'

/** 이미지 업로드·코드 블록 같은 서버 연결이 없는 도구는 뺀다. */
const TOOLBAR = [['heading', 'bold', 'italic', 'strike'], ['ul', 'ol', 'quote'], ['table', 'link']]
/** 설정 링크를 고르는 검색 결과의 최대 개수(더 있으면 검색어를 좁히라고 알린다) */
const RESULT_MAX = 30

/** 설정 링크로 고를 수 있는 카드. `aliases`는 검색에만 쓴다. */
export type CardLinkChoice = { id: string; title: string; type?: string; aliases?: readonly string[] }
/** 설정 링크(DEC-53)를 쓰는 편집기에 주는 값: 같은 세계관의 카드들(편집 중인 카드는 뺀다)과 미리보기의 링크를 눌렀을 때 그 카드를 여는 함수. */
export type CardLinks = { cards: readonly CardLinkChoice[]; open: (cardId: string) => void }

/** 노드 `sourcepos`([[시작 줄, 칸], [끝 줄, 칸]], 1부터 세고 끝 칸을 포함)가 가리키는 원문. 여러 줄에 걸친 노드는 링크 정규식이 줄바꿈을 못 맞추므로 어떤 링크도 아니라 빈 글이다. */
const sourceAt = (markdown: string, [[startLine, startCh], [endLine, endCh]]: NonNullable<MdNode['sourcepos']>) =>
  startLine === endLine ? (markdown.split('\n')[startLine - 1] ?? '').slice(startCh - 1, endCh) : ''

/**
 * 미리보기의 설정 링크: Toast의 sanitizer(DOMPurify)는 알 수 없는 주소(`card:`)의 href를 지워 링크가 글자가 되므로, 같은 화면 안의 해시 주소와 data 속성으로 바꿔 눌렀을 때 읽는다(이동은 편집기 덩어리의 클릭 처리).
 * 파서는 정규식이 링크로 보지 않는 모양(`<card:id>`·제목이 붙은 링크 …)도 `card:` 주소로 읽으므로, 링크로 바꿀지는 그 노드의 원문(`sourcepos`)이 정규식에 맞는지로 정한다(`cardLinkOf`).
 * 새 탭으로 열리지 않게 target·rel은 뺀다. 설정 링크가 아닌 링크는 그대로 둔다. [markdown]은 지금 편집기의 글이다.
 */
const previewLinks = (markdown: () => string): CustomHTMLRenderer => ({
  link(node, context) {
    const token = context.origin!()
    const id = node.sourcepos && cardLinkOf(sourceAt(markdown(), node.sourcepos))
    if (!id || !token || Array.isArray(token) || token.type !== 'openTag') return token
    const attributes: Record<string, unknown> = { ...token.attributes, href: `#card-${id}`, 'data-card-link': id }
    delete attributes.target
    delete attributes.rel
    return { ...token, attributes }
  },
})

type Props = {
  /** 편집기 덩어리의 접근 가능한 이름 */
  label: string
  /** 만들 때만 읽는다. 다른 글로 바꾸려면 `key`를 바꿔 다시 만든다(이전 글의 되돌리기 기록이 섞이지 않는다). */
  initialValue: string
  placeholder?: string
  /** 글이 바뀔 때마다 마크다운 문자열 전체를 준다. */
  onChange: (markdown: string) => void
  /** 있으면 편집기 위에 `설정 링크` 버튼(같은 세계관 카드를 찾아 `[글자](card:<id>)`를 넣는다)과 미리보기의 링크 이동이 생긴다. 만들 때 있었는지만 읽는다. */
  cardLinks?: CardLinks
}

/**
 * 마크다운 본문 편집기(Toast UI Editor 3). 저장값이 늘 마크다운 문자열이도록 위지윅 전환은 숨기고(`hideModeSwitch`) 쓰기·미리보기 탭(`previewStyle: 'tab'`)을 쓴다.
 * Toast의 알려진 결함(열자마자 되돌리기로 글이 지워짐, 일부 글에서 구문 강조 예외, 줄 사이 편집에서 줄바꿈을 잃음)은 `toastFixes`로 막는다.
 * `@toast-ui/react-editor`는 React 17까지만 받아 쓰지 않고 직접 만들어 `destroy()`한다. 번들이 커서 부르는 쪽(`LazyMarkdownEditor`)이 `React.lazy`로 늦게 불러온다.
 * 원시 HTML 확장·이미지 업로드는 연결하지 않았다. 미리보기는 Toast 자체 렌더러라 공개 화면(`CardMarkdown`)과 모양이 조금 다를 수 있다.
 *
 * 키보드: Toast의 마크다운 편집 영역은 Tab·Shift+Tab을 늘 들여쓰기로 가로채 키보드만으로는 빠져나갈 수 없고(WCAG 2.1.2), 쓰기·미리보기 탭은 키 처리가 없는 `div`다.
 * 그래서 편집기 덩어리의 캡처 단계에서 (1) Esc를 누른 바로 다음 Tab·Shift+Tab은 편집기에 넘기지 않아 브라우저가 초점을 옮기게 하고(`tabEscape`, 방법은 아래 한 줄로 알리고 입력 영역의 설명으로 잇는다),
 * (2) 탭에 `role="tab"`을 붙이고 ←→로 옮겨 고르며 Enter·Space로도 고르게 한다. 들여쓰기는 그대로 Tab이다.
 *
 * 설정 링크(`cardLinks`, DEC-53): 편집기 바로 위 줄의 `설정 링크` 버튼이 그 아래에 검색 패널(`CardLinkPicker`)을 열고, 이름·별칭으로 찾은 카드를 고르면 선택한 글자(없으면 그 카드의 제목)로 `[글자](card:<id>)`를 커서 위치에 넣는다.
 * 버튼은 Toast 도구 줄 밖에 둔다: 도구 줄은 좁으면 끝 항목을 `더보기`(숨겨진 목록)로 옮기는데, 도구 줄 안의 버튼은 그때 눌러 쓰기 어렵다.
 * 인라인 `[[` 자동완성은 두지 않는다. 미리보기의 설정 링크를 누르면 `cardLinks.open`으로 그 카드를 연다(고른 카드가 `cards`에 없으면 아무 일도 하지 않는다).
 */
export function MarkdownEditor({ label, initialValue, placeholder, onChange, cardLinks }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const latest = useRef(onChange)
  const links = useRef(cardLinks)
  const [mount] = useState({ label, initialValue, placeholder, linking: cardLinks !== undefined }) // 만들 때의 값만 쓴다
  const { dark } = useTheme()
  const hint = useId()
  const editorRef = useRef<Editor | null>(null)
  const opener = useRef<HTMLButtonElement>(null) // `설정 링크` 버튼: 패널을 닫으면 초점이 돌아온다
  const selection = useRef('') // 패널을 열 때 선택돼 있던 글자: 링크의 글자가 된다
  const [picking, setPicking] = useState(false)
  useEffect(() => { latest.current = onChange; links.current = cardLinks })
  useEffect(() => {
    const el = host.current!
    let view!: View
    let pmState!: PMState
    const editor = new Editor({
      el,
      placeholder: mount.placeholder,
      initialEditType: 'markdown',
      hideModeSwitch: true,
      previewStyle: 'tab',
      height: 'auto',
      minHeight: '320px',
      language: 'ko-KR',
      toolbarItems: TOOLBAR,
      ...(mount.linking && { customHTMLRenderer: previewLinks(() => editorRef.current?.getMarkdown() ?? '') }), // 글을 넣기 전에 편집기를 잡아 둔다: 첫 미리보기도 원문을 본다
      linkAttributes: { target: '_blank', rel: 'noopener noreferrer' }, // 미리보기의 링크가 이 화면(저장 전 글)을 떠나지 않게
      autofocus: false, // 이름 입력의 초점 흐름을 지킨다
      usageStatistics: false, // 기본값은 호스트 이름을 Google Analytics로 보낸다
      // 편집 화면(ProseMirror)을 얻는 플러그인. Toast의 결함 보정(shared/toastFixes)에만 쓰고 문법·HTML은 넓히지 않는다.
      plugins: [(context: PluginContext) => {
        pmState = context.pmState
        return { markdownPlugins: [() => new pmState.Plugin({ view: (editorView) => { view = editorView; return {} } })] }
      }],
    })
    editorRef.current = editor
    // 구문 강조가 실패하는 글도 열리게 하고 처음 글을 넣은 되돌리기 기록을 비운다(열자마자 Ctrl+Z로 글이 지워지지 않게). change는 글을 넣은 뒤에 이어 열기만 해서는 알리지 않는다.
    loadMarkdown(editor, view, mount.initialValue)
    editor.on('change', () => latest.current(editor.getMarkdown()))
    // 줄 사이 위치가 낀 편집(줄 통째로 지운 것을 되돌리기 등)에서 Toast가 줄바꿈을 잃어 화면과 다른 글을 내지 않게 한다.
    const pass = view.props.dispatchTransaction!
    view.setProps({ dispatchTransaction: (tr: Transaction) => pass.call(view, tr.docChanged ? forToast(tr, view.state, pmState) : tr) })
    // 글을 쓰는 곳(contenteditable)은 이름 없는 영역으로 읽히므로 여러 줄 입력으로 알린다.
    const input = el.querySelector('.toastui-editor-md-container .ProseMirror')
    input?.setAttribute('role', 'textbox')
    input?.setAttribute('aria-multiline', 'true')
    input?.setAttribute('aria-label', `${mount.label} 입력`)
    input?.setAttribute('aria-describedby', hint)
    // Toast는 탭에 `aria-role`(없는 속성)을 써서 탭으로 읽히지 않는다. 선택 상태(aria-selected)와 tabindex는 Toast가 맞춰 준다.
    const tabList = el.querySelector('.toastui-editor-md-tab-container .toastui-editor-tabs')
    tabList?.setAttribute('role', 'tablist')
    tabList?.querySelectorAll('.tab-item').forEach((tab) => tab.setAttribute('role', 'tab'))
    const keys = (e: KeyboardEvent) => {
      const tab = e.target instanceof Element ? e.target.closest<HTMLElement>('.tab-item') : null
      if (!tab) return
      const all = [...(tab.parentElement?.querySelectorAll<HTMLElement>('.tab-item') ?? [])]
      const at = all.indexOf(tab)
      const next = e.key === 'ArrowRight' ? all[at + 1] ?? all[0] : e.key === 'ArrowLeft' ? all[at - 1] ?? all[all.length - 1] : e.key === 'Enter' || e.key === ' ' ? tab : null
      if (!next) return
      e.preventDefault()
      next.click()
      next.focus()
    }
    el.addEventListener('keydown', keys, true)
    const releaseTab = escapeWithTab(el)
    // 설정 링크: 미리보기의 링크(previewLinks가 data 속성을 단 것)를 누르면 그 카드를 연다.
    const openCard = (e: MouseEvent) => {
      const link = e.target instanceof Element ? e.target.closest<HTMLElement>('a[data-card-link]') : null
      if (!link) return
      e.preventDefault()
      const id = link.dataset.cardLink
      if (id && links.current?.cards.some((card) => card.id === id)) links.current.open(id)
    }
    el.addEventListener('click', openCard)
    return () => {
      el.removeEventListener('keydown', keys, true)
      el.removeEventListener('click', openCard)
      releaseTab()
      editorRef.current = null
      editor.destroy()
    }
  }, [mount, hint])
  // 테마 전환은 편집기를 다시 만들지 않고 어두운 테마 클래스만 바꾼다(처음 만들 때도 같은 규칙).
  useEffect(() => {
    host.current?.querySelector('.toastui-editor-defaultUI')?.classList.toggle('toastui-editor-dark', dark)
  }, [dark])
  const openPicker = () => {
    selection.current = editorRef.current?.getSelectedText() ?? ''
    setPicking(true)
  }
  const close = () => {
    setPicking(false)
    opener.current?.focus()
  }
  const pick = (card: CardLinkChoice) => {
    const editor = editorRef.current
    if (!editor) return
    editor.replaceSelection(cardLinkMarkdown(card.id, selection.current, card.title))
    setPicking(false)
    editor.focus()
  }
  return (
    <>
      {mount.linking && (
        <div className="card-link-bar">
          <button ref={opener} type="button" className="btn sm" aria-haspopup="dialog" aria-expanded={picking} onClick={openPicker}>설정 링크</button>
        </div>
      )}
      {picking && cardLinks && <CardLinkPicker cards={cardLinks.cards} onPick={pick} onClose={close} />}
      <div ref={host} role="group" aria-label={label} className="markdown-editor" />
      <p id={hint} className="small muted markdown-editor-hint">{TAB_ESCAPE_HINT}</p>
    </>
  )
}

/**
 * 설정 링크를 넣을 카드를 찾는 패널(편집기 바로 위): 이름·별칭으로 거른 목록에서 고르면 `onPick`, Esc·닫기는 `onClose`다.
 * 열리면 검색 칸으로 초점이 가고(`MarkdownEditor`가 닫을 때 버튼으로 돌린다), 한글 조합 중의 Esc는 조합을 취소하는 키라 패널을 닫지 않는다.
 */
function CardLinkPicker({ cards, onPick, onClose }: { cards: readonly CardLinkChoice[]; onPick: (card: CardLinkChoice) => void; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const heading = useId()
  useEffect(() => input.current?.focus(), [])
  const q = query.trim().toLowerCase()
  const found = q ? cards.filter((card) => [card.title, ...(card.aliases ?? [])].some((name) => name.toLowerCase().includes(q))) : cards
  return (
    <section className="card-link-picker" role="dialog" aria-labelledby={heading} onKeyDown={(e) => { if (e.key === 'Escape' && !e.nativeEvent.isComposing) { e.stopPropagation(); onClose() } }}>
      <h4 id={heading}>설정 링크 넣기</h4>
      <label>같은 세계관의 설정 찾기 (이름·별칭)
        <input ref={input} type="search" className="inp" value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      <p role="status" className="small muted">{found.length ? `설정 ${found.length}개${found.length > RESULT_MAX ? ` 중 ${RESULT_MAX}개만 보여요. 검색어를 더 적어 보세요.` : ''}` : '맞는 설정이 없어요.'}</p>
      <ul aria-label="링크할 설정">
        {found.slice(0, RESULT_MAX).map((card) => (
          <li key={card.id}><button type="button" onClick={() => onPick(card)}>{card.title || '이름 없는 설정'}{card.type && <small>{card.type}</small>}</button></li>
        ))}
      </ul>
      <button type="button" className="btn sm" onClick={onClose}>닫기</button>
    </section>
  )
}
