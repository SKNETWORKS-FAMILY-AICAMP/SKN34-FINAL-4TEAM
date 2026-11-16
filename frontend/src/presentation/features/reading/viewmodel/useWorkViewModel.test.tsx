// @vitest-environment jsdom
import '../../../../test/fixtureApp'

import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createAppStore } from '../../../../app/store'
import { useWorkViewModel } from './useWorkViewModel'

afterEach(() => { vi.restoreAllMocks() })

const wrap = () => {
  const store = createAppStore({ role: 'user' })
  return ({ children }: { children: ReactNode }) => <Provider store={store}><MemoryRouter>{children}</MemoryRouter></Provider>
}

describe('useWorkViewModel · 회차 목록', () => {
  it('회차마다 공백을 뺀 글자 수를 주고 검색은 회차 번호·제목·본문에서 찾는다', async () => {
    const { result } = renderHook(() => useWorkViewModel('postman'), { wrapper: wrap() })
    await waitFor(() => expect(result.current.detail).toBeTruthy())
    const [first] = result.current.episodes
    expect(first.n).toBe(1)
    expect(first.chars).toBe(first.e.p.join('').replace(/\s/g, '').length)
    act(() => result.current.setQuery('송신탑'))
    expect(result.current.episodes.filter((x) => x.match).map((x) => x.n)).toEqual([1])
    act(() => result.current.setQuery('2화'))
    expect(result.current.episodes.filter((x) => x.match).map((x) => x.n)).toEqual([2])
    act(() => result.current.setQuery('없는 말'))
    expect(result.current.noMatch).toBe(true)
  })

  it('검색어를 바꾸거나 다시 그려도 회차 본문을 다시 이어 붙이지 않는다', async () => {
    const { result, rerender } = renderHook(() => useWorkViewModel('postman'), { wrapper: wrap() })
    await waitFor(() => expect(result.current.detail).toBeTruthy())
    const bodies = new Set(result.current.episodes.map((x) => x.e.p))
    // 전 회차 본문을 이어 붙이는 일(글자 수·검색 대상 글)은 작품을 읽었을 때 한 번만 한다.
    const join = vi.spyOn(Array.prototype, 'join')
    act(() => result.current.setQuery('편지'))
    rerender()
    act(() => result.current.setSort('new'))
    expect(join.mock.contexts.filter((body) => bodies.has(body as string[]))).toEqual([])
    expect(result.current.episodes.map((x) => x.n)).toEqual([...result.current.episodes.map((x) => x.n)].sort((a, b) => b - a))
  })
})
