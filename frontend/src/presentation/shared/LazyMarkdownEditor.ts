import { lazy } from 'react'

/**
 * `MarkdownEditor`(Toast UI Editor + ProseMirror 확장 + CSS)는 번들이 커서 처음 쓸 때 늦게 불러온다. 이 파일만 정적으로 가져와 쓰고 쓰는 쪽이 `Suspense`로 감싼다.
 * 편집 화면에서만 쓰므로 공개 화면·다른 화면 번들에는 들어가지 않는다. 테스트는 이 모듈을 대역으로 바꿔 입력을 textarea로 흉내 낸다.
 */
export const LazyMarkdownEditor = lazy(() => import('./MarkdownEditor').then((m) => ({ default: m.MarkdownEditor })))
