import { expect, it, vi } from 'vitest'

import type { CardCategory } from '../../domain/entities/cardCategory'
import type { CardCategoryUseCase } from '../../domain/usecases/CardCategoryUseCase'
import { useCardCategories } from './useCardCategories'

// 렌더러 없이 Hook 본문만 실행한다: 조회 결과(useAsyncData)를 정해 주고 이 Hook이 그것을 어떻게 내놓는지만 본다.
const fetched = vi.hoisted(() => ({ state: {} as { data?: readonly unknown[]; isLoading: boolean; isError: boolean; retry: () => void } }))
vi.mock('../../app/appContainer', () => ({ appContainer: { resolve: vi.fn() } }))
vi.mock('./useAsyncData', () => ({ useAsyncData: () => fetched.state }))

const retry = vi.fn()
const useCase = { list: vi.fn() } as unknown as CardCategoryUseCase
const server: CardCategory[] = [
  { code: 'character', name: '인물', icon: null, position: 1, active: false },
  { code: 'category-01', name: '종족', icon: '🧬', position: 2, active: true },
]

it.each([
  ['조회에 실패하면 기본 8종으로 대신하지 않고 실패로 알린다', { data: undefined, isLoading: false, isError: true, retry }, { categories: undefined, isLoading: false, isError: true, retry }],
  ['읽는 동안에는 목록 없이 읽는 중이다', { data: undefined, isLoading: true, isError: false, retry }, { categories: undefined, isLoading: true, isError: false, retry }],
  ['서버 목록은 숨긴 카테고리와 추가한 카테고리 그대로 쓴다', { data: server, isLoading: false, isError: false, retry }, { categories: server, isLoading: false, isError: false, retry }],
  ['다시 읽다 실패해도 앞서 읽은 서버 목록이 있으면 그것을 쓰고 실패로 막지 않는다', { data: server, isLoading: false, isError: true, retry }, { categories: server, isLoading: false, isError: false, retry }],
])('%s', (_name, state, expected) => {
  fetched.state = state
  expect(useCardCategories(useCase)).toEqual(expected)
})
