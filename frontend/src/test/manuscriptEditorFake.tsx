import { use, useImperativeHandle, useRef } from 'react'

import type { ManuscriptEditor } from '../presentation/features/studio/view/ManuscriptEditor'

const never = new Promise<never>(() => {})

/**
 * `LazyManuscriptEditor`(Toast UI Editor) 대역. jsdom에서는 ProseMirror 입력을 흉내 낼 수 없어, 같은 값 전달만 하는 textarea로 바꾼다.
 * 이름 '원고 본문'은 진짜 편집 영역과 같다. 잠금(`editable=false`)은 `readOnly`, 진행 중(`busy`)은 `data-busy`로 드러내고,
 * 핸들의 `addImage`는 진짜처럼 커서 위치(textarea의 선택 범위)를 `onImage`에 넘긴다.
 * 실제 Toast 동작(무손실·툴바·이미지 위젯·한도·붙여넣기·미리보기)은 `ManuscriptEditor.test.tsx`가 실제 편집기로 검증한다.
 * `LazyManuscriptEditor.suspend = true`로 두면 편집기를 불러오는 중인 모습(끝나지 않는 Suspense)을 만든다. 테스트가 끝나면 꺼야 한다.
 * 사용: `vi.mock('./LazyManuscriptEditor', () => import('<상대 경로>/test/manuscriptEditorFake'))`
 */
export function LazyManuscriptEditor({ value, onChange, editable, busy, onImage, ref }: Parameters<typeof ManuscriptEditor>[0]) {
  if (LazyManuscriptEditor.suspend) use(never)
  const area = useRef<HTMLTextAreaElement>(null)
  useImperativeHandle(ref, () => ({ addImage: (file) => onImage(file, area.current!.selectionStart, area.current!.selectionEnd) }), [onImage])
  return <textarea ref={area} aria-label="원고 본문" value={value} readOnly={!editable} data-busy={busy ? 'true' : undefined} onChange={(e) => onChange(e.target.value)} />
}
LazyManuscriptEditor.suspend = false
