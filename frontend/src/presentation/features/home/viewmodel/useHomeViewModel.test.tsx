// @vitest-environment jsdom

import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { Provider } from 'react-redux'
import { describe, expect, it } from 'vitest'

import { createAppStore } from '../../../../app/store'
import { createFixtureDb } from '../../../../data/mock/fixtureDb'
import { InMemoryGenreRepository, InMemoryOperationsGenreRepository } from '../../../../data/mock/InMemoryGenreRepositories'
import { InMemoryReadingRecordRepository, InMemoryReadingRepository, InMemoryWorkRepository } from '../../../../data/mock/InMemoryRepositories'
import { ReadingUseCase } from '../../../../domain/usecases/ReadingUseCase'
import { uiActions } from '../../../shared/ui/uiSlice'
import { useHeroViewModel, useHomeViewModel } from './useHomeViewModel'

function setup() {
  const db = createFixtureDb()
  const store = createAppStore()
  // 홈 칩의 장르는 공개 장르 목록이라 운영과 같은 메모리 목록(홈에 보이는 판타지·SF·고전)을 준다.
  const genres = new InMemoryGenreRepository(new InMemoryOperationsGenreRepository())
  const useCase = new ReadingUseCase(new InMemoryWorkRepository(db), new InMemoryReadingRepository(db), new InMemoryReadingRecordRepository(db), undefined, undefined, genres)
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

  it('칩 줄은 추천 · 홈에 보이는 장르 · 무료 · 포크 많은이고 고른 칩이 더는 없는 칩이면 추천으로 돌아간다', async () => {
    const { result, store } = setup()
    // 칩 줄을 읽기 전·읽지 못했을 때는 장르 칩 없이 세 칩만 보인다.
    expect(result.current.chips).toEqual(['추천', '🆓 무료', '✎ 포크 많은'])
    await waitFor(() => expect(result.current.chips).toEqual(['추천', '✨ 판타지', '🛰 SF', '📜 고전', '🆓 무료', '✎ 포크 많은']))
    act(() => { store.dispatch(uiActions.setChip('🔥 사라진 장르')) })
    await waitFor(() => expect(result.current.chip).toBe('추천'))
    expect(result.current.chipsFailed).toBe(false)
  })

  it('칩 줄(장르 목록)을 읽지 못하면 빈 장르로 숨기지 않고 실패와 다시 불러오기를 알리며 세 칩은 그대로 쓴다', async () => {
    const db = createFixtureDb()
    const down = { list: async () => { throw new Error('genres offline') } }
    const useCase = new ReadingUseCase(new InMemoryWorkRepository(db), new InMemoryReadingRepository(db), new InMemoryReadingRecordRepository(db), undefined, undefined, down)
    const store = createAppStore()
    const { result } = renderHook(() => useHomeViewModel(useCase), { wrapper: ({ children }: { children: ReactNode }) => <Provider store={store}>{children}</Provider> })
    await waitFor(() => expect(result.current.chipsFailed).toBe(true))
    expect(result.current.chips).toEqual(['추천', '🆓 무료', '✎ 포크 많은'])
    expect(typeof result.current.retryChips).toBe('function')
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
    await waitFor(() => expect(result.current.chips).toContain('🛰 SF')) // 칩 줄(장르 목록)까지 읽은 뒤의 렌더 수를 센다
    const before = renders.count
    act(() => { store.dispatch(uiActions.stepHero(1)) })
    act(() => { store.dispatch(uiActions.setLook('night')) })
    act(() => { store.dispatch(uiActions.setSheetScreen('U07')) })
    expect(renders.count).toBe(before)
    // 홈이 쓰는 상태(첫 홈 방문 표시)는 그대로 반영한다.
    act(() => result.current.homeVisited())
    expect(result.current.firstHome).toBe(false)
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
