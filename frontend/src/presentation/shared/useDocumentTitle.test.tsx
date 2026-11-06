// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'

import { documentTitleOf, useDocumentTitle } from './useDocumentTitle'

afterEach(() => { cleanup(); document.title = 'STORYFORK' })

it.each([
  ['검색', '검색 · STORYFORK'],
  ['  랭킹  ', '랭킹 · STORYFORK'],
  ['', 'STORYFORK'],
  ['   ', 'STORYFORK'],
  [null, 'STORYFORK'],
  [undefined, 'STORYFORK'],
])('화면 이름 %j의 탭 제목은 %s이다', (title, expected) => {
  expect(documentTitleOf(title)).toBe(expected)
})

it('제목을 정하고 바뀌면 갱신하며 언마운트하면 기본 제목으로 복구한다', () => {
  const view = renderHook<void, { title: string | null | undefined }>(({ title }) => useDocumentTitle(title), { initialProps: { title: '검색' } })
  expect(document.title).toBe('검색 · STORYFORK')
  view.rerender({ title: '랭킹' })
  expect(document.title).toBe('랭킹 · STORYFORK')
  view.rerender({ title: null })
  expect(document.title).toBe('STORYFORK')
  view.rerender({ title: '태그' })
  view.unmount()
  expect(document.title).toBe('STORYFORK')
})
