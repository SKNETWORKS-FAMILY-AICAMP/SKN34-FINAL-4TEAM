import Editor from '@toast-ui/editor'
import '@toast-ui/editor/dist/i18n/ko-kr'
import '@toast-ui/editor/dist/theme/toastui-editor-dark.css'
import '@toast-ui/editor/dist/toastui-editor.css'
import { useEffect, useId, useRef, useState } from 'react'

import './MarkdownEditor.css'
import { useTheme } from './shell/useTheme'

/** 이미지 업로드·코드 블록 같은 서버 연결이 없는 도구는 뺀다. */
const TOOLBAR = [['heading', 'bold', 'italic', 'strike'], ['ul', 'ol', 'quote'], ['table', 'link']]
/** 다른 키와 함께 누르는 키. 이 키만으로는 'Esc 다음 Tab'의 순서를 끊지 않는다(Shift+Tab의 Shift). */
const MODIFIERS = ['Shift', 'Control', 'Alt', 'Meta']

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
 * `@toast-ui/react-editor`는 React 17까지만 받아 쓰지 않고 직접 만들어 `destroy()`한다. 번들이 커서 부르는 쪽(`LazyMarkdownEditor`)이 `React.lazy`로 늦게 불러온다.
 * 원시 HTML 확장·이미지 업로드는 연결하지 않았다. 미리보기는 Toast 자체 렌더러라 공개 화면(`CardMarkdown`)과 모양이 조금 다를 수 있다.
 *
 * 키보드: Toast의 마크다운 편집 영역은 Tab·Shift+Tab을 늘 들여쓰기로 가로채 키보드만으로는 빠져나갈 수 없고(WCAG 2.1.2), 쓰기·미리보기 탭은 키 처리가 없는 `div`다.
 * 그래서 편집기 덩어리의 캡처 단계에서 (1) Esc를 누른 바로 다음 Tab·Shift+Tab은 편집기에 넘기지 않아 브라우저가 초점을 옮기게 하고(방법은 아래 한 줄로 알리고 입력 영역의 설명으로 잇는다),
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
    const editor = new Editor({
      el,
      initialValue: mount.initialValue,
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
      events: { change: () => latest.current(editor.getMarkdown()) },
    })
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
    let leaving = false // Esc를 방금 눌렀다: 바로 다음 Tab은 편집기 밖으로 나간다
    const keys = (e: KeyboardEvent) => {
      const target = e.target instanceof Element ? e.target : null
      const tab = target?.closest<HTMLElement>('.tab-item')
      if (tab) {
        const all = [...(tab.parentElement?.querySelectorAll<HTMLElement>('.tab-item') ?? [])]
        const at = all.indexOf(tab)
        const next = e.key === 'ArrowRight' ? all[at + 1] ?? all[0] : e.key === 'ArrowLeft' ? all[at - 1] ?? all[all.length - 1] : e.key === 'Enter' || e.key === ' ' ? tab : null
        if (!next) return
        e.preventDefault()
        next.click()
        next.focus()
        return
      }
      if (!target?.closest('.ProseMirror') || MODIFIERS.includes(e.key)) return
      if (e.key === 'Tab' && leaving) e.stopPropagation() // 편집기(ProseMirror)가 받지 못하면 들여쓰기 대신 브라우저의 초점 이동이 일어난다
      leaving = e.key === 'Escape' && !e.isComposing && e.keyCode !== 229 // 한글 조합을 끝내는 Esc는 세지 않는다
    }
    const stay = () => { leaving = false }
    el.addEventListener('keydown', keys, true)
    el.addEventListener('focusout', stay)
    return () => {
      el.removeEventListener('keydown', keys, true)
      el.removeEventListener('focusout', stay)
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
      <p id={hint} className="small muted markdown-editor-hint">Tab은 들여쓰기예요. 편집기 밖으로 나가려면 Esc를 누른 다음 Tab을 누르세요.</p>
    </>
  )
}
