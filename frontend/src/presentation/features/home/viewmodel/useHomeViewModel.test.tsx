// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { Provider } from 'react-redux'
import { describe, expect, it } from 'vitest'

import { createAppStore } from '../../../../app/store'
import { createMockDb, InMemoryReadingRepository, InMemoryWorkRepository } from '../../../../data/mock/InMemoryRepositories'
import { ReadingUseCase } from '../../../../domain/usecases/ReadingUseCase'
import { useHomeViewModel } from './useHomeViewModel'

function setup() {
  const db = createMockDb()
  const store = createAppStore()
  const useCase = new ReadingUseCase(new InMemoryWorkRepository(db), new InMemoryReadingRepository(db))
  const wrapper = ({ children }: { children: ReactNode }) => <Provider store={store}>{children}</Provider>
  return { db, store, ...renderHook(() => useHomeViewModel(useCase), { wrapper }) }
}

describe('useHomeViewModel', () => {
  it('칩을 고르면 U02 필터 결과로 바뀌고 추천으로 돌아오면 U01이 된다', async () => {
    const { result, store } = setup()
    await waitFor(() => expect(result.current.home?.filtered).toBeNull())
    expect(store.getState().session.screen.base).toBe('U01')
    act(() => result.current.selectChip('🛰 SF'))
    await waitFor(() => expect(result.current.home?.filtered?.map((w) => w.id)).toEqual(['postman', 'reply', 'postif']))
    expect(store.getState().session.screen.base).toBe('U02')
  })

  it('본 포크 링을 기록하면 다시 조회해 seen으로 표시한다', async () => {
    const { result } = setup()
    await waitFor(() => expect(result.current.home).toBeTruthy())
    act(() => result.current.markSeen('gate'))
    await waitFor(() => expect(result.current.home?.seen.gate).toBe(true))
  })
})
