// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { Provider } from 'react-redux'
import { describe, expect, it } from 'vitest'

import { createAppStore } from '../../../../app/store'
import { createFixtureDb } from '../../../../data/mock/fixtureDb'
import { InMemoryReadingRecordRepository, InMemoryReadingRepository, InMemoryWorkRepository } from '../../../../data/mock/InMemoryRepositories'
import { ReadingUseCase } from '../../../../domain/usecases/ReadingUseCase'
import { uiActions } from '../../../shared/ui/uiSlice'
import { useHeroViewModel, useHomeViewModel } from './useHomeViewModel'

function setup() {
  const db = createFixtureDb()
  const store = createAppStore()
  const useCase = new ReadingUseCase(new InMemoryWorkRepository(db), new InMemoryReadingRepository(db), new InMemoryReadingRecordRepository(db))
  const wrapper = ({ children }: { children: ReactNode }) => <Provider store={store}>{children}</Provider>
  const renders = { count: 0 }
  return { db, store, wrapper, renders, ...renderHook(() => { renders.count += 1; return useHomeViewModel(useCase) }, { wrapper }) }
}

describe('useHomeViewModel', () => {
  it('칩을 고르면 U02 필터 결과로 바뀌고 추천으로 돌아오면 U01이 된다', async () => {
    const { result, store } = setup()
    await waitFor(() => expect(result.current.home?.filtered).toBeNull())
    expect(store.getState().ui.screen.base).toBe('U01')
    act(() => result.current.selectChip('🛰 SF'))
    await waitFor(() => expect(result.current.home?.filtered?.map((w) => w.id)).toEqual(['postman', 'reply', 'postif']))
    expect(store.getState().ui.screen.base).toBe('U02')
  })

  it('본 포크 링을 기록하면 다시 조회해 seen으로 표시한다', async () => {
    const { result } = setup()
    await waitFor(() => expect(result.current.home).toBeTruthy())
    act(() => result.current.markSeen('gate'))
    await waitFor(() => expect(result.current.home?.seen.gate).toBe(true))
  })

  it('캐러셀 자동 넘김처럼 홈이 쓰지 않는 화면 상태가 바뀌어도 홈 전체를 다시 그리지 않는다', async () => {
    const { result, store, renders } = setup()
    await waitFor(() => expect(result.current.home).toBeTruthy())
    const before = renders.count
    act(() => { store.dispatch(uiActions.stepHero(1)) })
    act(() => { store.dispatch(uiActions.setLook('night')) })
    act(() => { store.dispatch(uiActions.setSheetScreen('U07')) })
    expect(renders.count).toBe(before)
    // 홈이 쓰는 상태(안내 닫기)는 그대로 반영한다.
    act(() => result.current.closeGuide())
    expect(result.current.guide).toBe(false)
    expect(renders.count).toBe(before + 1)
  })
})

describe('useHeroViewModel', () => {
  it('캐러셀 위치만 읽고 이동·범위 보정을 저장소에 전한다', () => {
    const { store, wrapper } = setup()
    const { result } = renderHook(() => useHeroViewModel(), { wrapper })
    expect(result.current.hero).toBe(0)
    act(() => result.current.stepHero(1))
    act(() => result.current.stepHero(1))
    expect(result.current.hero).toBe(2)
    act(() => result.current.setHero(0))
    expect(store.getState().ui.hero).toBe(0)
    // effect가 타이머를 다시 걸지 않도록 이동 함수는 렌더 사이에 같은 함수다.
    const { stepHero, setHero } = result.current
    act(() => result.current.stepHero(1))
    expect([result.current.stepHero, result.current.setHero]).toEqual([stepHero, setHero])
  })
})
