import { use } from 'react'

const never = new Promise<never>(() => {})

/**
 * `LazyMarkdownEditor`(Toast UI Editor) 대역. jsdom에서는 ProseMirror 입력을 흉내 낼 수 없어, 같은 값 전달만 하는 textarea로 바꾼다.
 * 이름 '설명'은 설명이 textarea였을 때부터 화면 테스트가 찾던 이름이다. 진짜처럼 `initialValue`만 읽으므로 `key`가 바뀌어야 다른 글로 다시 만들어진다.
 * `LazyMarkdownEditor.suspend = true`로 두면 편집기를 불러오는 중인 모습(끝나지 않는 Suspense)을 만든다. 테스트가 끝나면 꺼야 한다.
 * 사용: `vi.mock('<상대 경로>/presentation/shared/LazyMarkdownEditor', () => import('<상대 경로>/test/markdownEditorFake'))`
 */
export function LazyMarkdownEditor({ label, initialValue, placeholder, onChange }: { label: string; initialValue: string; placeholder?: string; onChange: (markdown: string) => void }) {
  if (LazyMarkdownEditor.suspend) use(never)
  return <textarea aria-label="설명" data-label={label} defaultValue={initialValue} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
}
LazyMarkdownEditor.suspend = false
