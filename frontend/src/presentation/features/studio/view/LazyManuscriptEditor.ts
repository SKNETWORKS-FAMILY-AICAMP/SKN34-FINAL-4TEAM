import { lazy } from 'react'

/**
 * 본문 편집기(`ManuscriptEditor`: Toast UI Editor + ProseMirror + CSS)는 번들이 커서 회차를 열 때 늦게 불러온다. 쓰는 쪽(`WritingStudio`)이 `Suspense`로 감싼다.
 * 원작 기준(읽기 전용) 회차는 편집기 없이 그리므로 이 덩어리를 받지 않는다. 화면 테스트는 이 모듈을 textarea 대역(`test/manuscriptEditorFake`)으로 바꾼다.
 */
export const LazyManuscriptEditor = lazy(() => import('./ManuscriptEditor').then((m) => ({ default: m.ManuscriptEditor })))
