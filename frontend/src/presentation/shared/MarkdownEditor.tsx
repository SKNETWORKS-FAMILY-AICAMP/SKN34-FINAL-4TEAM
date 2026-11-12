import Editor from '@toast-ui/editor'
import '@toast-ui/editor/dist/i18n/ko-kr'
import '@toast-ui/editor/dist/theme/toastui-editor-dark.css'
import '@toast-ui/editor/dist/toastui-editor.css'
import { useEffect, useRef, useState } from 'react'

import './MarkdownEditor.css'
import { useTheme } from './shell/useTheme'

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
 * `@toast-ui/react-editor`는 React 17까지만 받아 쓰지 않고 직접 만들어 `destroy()`한다. 번들이 커서 부르는 쪽(`LazyMarkdownEditor`)이 `React.lazy`로 늦게 불러온다.
 * 원시 HTML 확장·이미지 업로드는 연결하지 않았다. 미리보기는 Toast 자체 렌더러라 공개 화면(`CardMarkdown`)과 모양이 조금 다를 수 있다.
 */
export function MarkdownEditor({ label, initialValue, placeholder, onChange }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const latest = useRef(onChange)
  const [mount] = useState({ label, initialValue, placeholder }) // 만들 때의 값만 쓴다
  const { dark } = useTheme()
  useEffect(() => { latest.current = onChange })
  useEffect(() => {
    const editor = new Editor({
      el: host.current!,
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
    const input = host.current!.querySelector('.toastui-editor-md-container .ProseMirror')
    input?.setAttribute('role', 'textbox')
    input?.setAttribute('aria-multiline', 'true')
    input?.setAttribute('aria-label', `${mount.label} 입력`)
    return () => editor.destroy()
  }, [mount])
  // 테마 전환은 편집기를 다시 만들지 않고 어두운 테마 클래스만 바꾼다(처음 만들 때도 같은 규칙).
  useEffect(() => {
    host.current?.querySelector('.toastui-editor-defaultUI')?.classList.toggle('toastui-editor-dark', dark)
  }, [dark])
  return <div ref={host} role="group" aria-label={label} className="markdown-editor" />
}
