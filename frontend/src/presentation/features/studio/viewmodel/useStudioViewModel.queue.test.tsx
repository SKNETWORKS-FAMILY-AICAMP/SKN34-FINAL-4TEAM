// @vitest-environment jsdom
import '../../../../test/fixtureApp'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it } from 'vitest'
import { appContainer } from '../../../../app/appContainer'
import { createAppStore } from '../../../../app/store'
import { useStudioViewModel } from './useStudioViewModel'

afterEach(cleanup)

// #10: run(addDocProp)과 queue(setDocText)가 같은 작품을 동시에 읽고 통째로 저장하면 나중 저장이 앞의 변경을 지운다.
it('keeps both edits when a run-path and a queue-path dictionary edit are fired together', async () => {
  const store = createAppStore({ role: 'user' })
  const wrapper = ({ children }: { children: ReactNode }) => <Provider store={store}><MemoryRouter>{children}</MemoryRouter></Provider>
  const { result } = renderHook(() => useStudioViewModel('starlight', undefined, 'ai'), { wrapper })
  await waitFor(() => expect(result.current.docs.length).toBeGreaterThan(0))
  const docId = result.current.docs[0].id
  await act(async () => { await Promise.all([result.current.addDocProp(docId, '새 속성', '값'), result.current.setDocText(docId, 'body', '새 본문')]) })
  const doc = appContainer.resolve('mockDb').works.find((w) => w.id === 'starlight')!.wiki!.docs.find((d) => d.id === docId)!
  expect(doc.props['새 속성']).toBe('값')
  expect(doc.body).toBe('새 본문')
})
