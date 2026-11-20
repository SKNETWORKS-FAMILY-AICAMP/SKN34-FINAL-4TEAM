import { use } from 'react'

const never = new Promise<never>(() => {})

/** 설정 링크 전달 값(`MarkdownEditor`의 `cardLinks`와 같은 모양). 대역은 버튼·검색 패널 없이 받은 값만 `cardLinks`에 남긴다. */
type CardLinks = { cards: readonly { id: string; title: string; type?: string; aliases?: readonly string[] }[]; open: (cardId: string) => void }

/**
 * `LazyMarkdownEditor`(Toast UI Editor) 대역. jsdom에서는 ProseMirror 입력을 흉내 낼 수 없어, 같은 값 전달만 하는 textarea로 바꾼다.
 * 이름 '설명'은 설명이 textarea였을 때부터 화면 테스트가 찾던 이름이다. 인물 문서의 편집기(`label`이 `IDENTITY.md`·`memory/03회차.md` 같은 파일 이름)는 그 파일 이름으로 찾는다.
 * 진짜처럼 `initialValue`만 읽으므로 `key`가 바뀌어야 다른 글로 다시 만들어진다.
 * `LazyMarkdownEditor.suspend = true`로 두면 편집기를 불러오는 중인 모습(끝나지 않는 Suspense)을 만든다. 테스트가 끝나면 꺼야 한다.
 * `LazyMarkdownEditor.cardLinks`는 편집기(`label`)마다 마지막으로 받은 설정 링크 값이다(없으면 undefined). 테스트가 대상 카드를 확인하고 `open`으로 미리보기의 링크를 누른 것처럼 부른다.
 * 사용: `vi.mock('<상대 경로>/presentation/shared/LazyMarkdownEditor', () => import('<상대 경로>/test/markdownEditorFake'))`
 */
export function LazyMarkdownEditor({ label, initialValue, placeholder, onChange, cardLinks }: { label: string; initialValue: string; placeholder?: string; onChange: (markdown: string) => void; cardLinks?: CardLinks }) {
  if (LazyMarkdownEditor.suspend) use(never)
  LazyMarkdownEditor.cardLinks.set(label, cardLinks)
  return <textarea aria-label={label.endsWith('.md') ? label : '설명'} data-label={label} defaultValue={initialValue} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
}
LazyMarkdownEditor.suspend = false
LazyMarkdownEditor.cardLinks = new Map<string, CardLinks | undefined>()
