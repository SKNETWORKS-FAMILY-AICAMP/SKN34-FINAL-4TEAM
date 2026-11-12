import Editor, { type PluginContext } from '@toast-ui/editor'
import '@toast-ui/editor/dist/i18n/ko-kr'
import '@toast-ui/editor/dist/theme/toastui-editor-dark.css'
import '@toast-ui/editor/dist/toastui-editor.css'
import { useEffect, useId, useRef, useState } from 'react'

import './MarkdownEditor.css'
import { useTheme } from './shell/useTheme'
import { forToast, loadMarkdown, type PMState, type Transaction, type View } from './toastFixes'
import { escapeWithTab, TAB_ESCAPE_HINT } from './tabEscape'

/** 이미지 업로드·코드 블록 같은 서버 연결이 없는 도구는 뺀다. */
const TOOLBAR = [['heading', 'bold', 'italic', 'strike'], ['ul', 'ol', 'quote'], ['table', 'link']]

type Props = {
  /** 편집기 덩어리의 접근 가능한 이름 */
  label: string
  /** 만들 때만 읽는다. 다른 글로 바꾸려면 `key`를 바꿔 다시 만든다(이전 글의 되돌리기 기록이 섞이지 않는다). */
  initialValue: string
  placeholder?: string
  /** 글이 바뀔 때마다 마크다운 문자열 전체를 준다. */
  onChange: (markdown: string) => void
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
 */
export function MarkdownEditor({ label, initialValue, placeholder, onChange }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const latest = useRef(onChange)
  const [mount] = useState({ label, initialValue, placeholder }) // 만들 때의 값만 쓴다
  const { dark } = useTheme()
  const hint = useId()
  useEffect(() => { latest.current = onChange })
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
      linkAttributes: { target: '_blank', rel: 'noopener noreferrer' }, // 미리보기의 링크가 이 화면(저장 전 글)을 떠나지 않게
      autofocus: false, // 이름 입력의 초점 흐름을 지킨다
      usageStatistics: false, // 기본값은 호스트 이름을 Google Analytics로 보낸다
      // 편집 화면(ProseMirror)을 얻는 플러그인. Toast의 결함 보정(shared/toastFixes)에만 쓰고 문법·HTML은 넓히지 않는다.
      plugins: [(context: PluginContext) => {
        pmState = context.pmState
        return { markdownPlugins: [() => new pmState.Plugin({ view: (editorView) => { view = editorView; return {} } })] }
      }],
    })
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
    return () => {
      el.removeEventListener('keydown', keys, true)
      releaseTab()
      editor.destroy()
    }
  }, [mount, hint])
  // 테마 전환은 편집기를 다시 만들지 않고 어두운 테마 클래스만 바꾼다(처음 만들 때도 같은 규칙).
  useEffect(() => {
    host.current?.querySelector('.toastui-editor-defaultUI')?.classList.toggle('toastui-editor-dark', dark)
  }, [dark])
  return (
    <>
      <div ref={host} role="group" aria-label={label} className="markdown-editor" />
      <p id={hint} className="small muted markdown-editor-hint">{TAB_ESCAPE_HINT}</p>
    </>
  )
}
