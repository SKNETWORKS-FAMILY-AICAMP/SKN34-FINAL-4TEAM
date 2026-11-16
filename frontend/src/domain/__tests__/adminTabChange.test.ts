import { beforeEach, describe, expect, it, vi } from 'vitest'

import { adminViewSlice } from '../../presentation/features/admin/state/adminViewSlice'
import { useAdminViewModel } from '../../presentation/features/admin/viewmodel/useAdminViewModel'
import type { AdminTab } from '../entities/admin'

// adminMutationCompletion.test.ts처럼 렌더러 없이 Hook 본문만 실행합니다. 탭이 바뀐 뒤의 값을 보려면 상태가 렌더 사이에 이어져야 하므로
// useActionRunner.test.ts처럼 슬롯 방식으로 useState·useRef를 대신하고, render()를 다시 부르면 setState로 바뀐 값을 읽습니다.
// 실제 React 렌더 회귀는 useAdminViewModel.test.tsx(CI 전용)가 맡습니다.
const hooks = vi.hoisted(() => {
  const slots: unknown[] = []
  let cursor = 0
  const slot = <T>(initial: () => T) => { const i = cursor++; if (!(i in slots)) slots[i] = initial(); return i }
  return {
    clear: () => { slots.length = 0 },
    render: <T>(hook: () => T) => { cursor = 0; return hook() },
    useRef: <T>(current: T) => slots[slot(() => ({ current }))] as { current: T },
    useState: <T>(initial: T) => {
      const i = slot(() => initial)
      return [slots[i] as T, (next: T | ((prev: T) => T)) => { slots[i] = typeof next === 'function' ? (next as (prev: T) => T)(slots[i] as T) : next }] as const
    },
    useEffect: () => {},
  }
})
const doubles = vi.hoisted(() => ({
  dispatch: vi.fn(), toast: vi.fn(),
  admin: { chatChoices: vi.fn() },
  work: { setRestriction: vi.fn() },
}))
vi.mock('react', () => ({ useRef: hooks.useRef, useState: hooks.useState, useEffect: hooks.useEffect }))
vi.mock('react-redux', () => ({ useStore: () => ({ getState: () => state }) }))
vi.mock('../../app/appContainer', () => ({ appContainer: { resolve: (name: string) => ({ adminUseCase: doubles.admin, operationsWorkUseCase: doubles.work } as Record<string, unknown>)[name] ?? {} } }))
vi.mock('../../app/store', () => ({ useAppDispatch: () => doubles.dispatch, useAppSelector: (select: (s: typeof state) => unknown) => select(state) }))
vi.mock('../../presentation/shared/session/useLogout', () => ({ useLogout: () => vi.fn() }))
vi.mock('../../presentation/shared/screenIds', () => ({ useScreenId: vi.fn() }))
vi.mock('../../presentation/shared/events', () => ({ toast: doubles.toast }))
vi.mock('../../presentation/shared/useAsyncData', () => ({ useAsyncData: () => ({ isLoading: false, isRefreshing: false, isError: false }) }))

const state = { adminView: adminViewSlice.reducer(undefined, { type: 'init' }), session: { memberId: null, user: { nick: '관리자', email: '', joined: '' } } }

beforeEach(() => {
  vi.clearAllMocks()
  hooks.clear()
})

describe('탭 이동과 조치 결과 문구', () => {
  const RESTRICTION_LIFTED = '작품 운영 제한을 해제했어요.'
  const setup = (tab: AdminTab) => {
    let current = tab
    return { go: (next: AdminTab) => { current = next }, render: () => hooks.render(() => useAdminViewModel(current)) }
  }

  it('탭을 옮기면 이전 탭의 조치 완료 문구를 지워 다른 탭에 남아 두 번 보이지 않게 한다', async () => {
    const t = setup('works')
    t.render()
    expect(await t.render().live.setWorkRestriction('w1', false)).toBe(true)
    const done = t.render()
    expect(done.lastSuccess).toBe(RESTRICTION_LIFTED)
    expect(done.actions['work:w1']).toEqual({ pending: false, error: '', message: RESTRICTION_LIFTED })

    t.go('audit')
    t.render()
    const moved = t.render()
    expect(moved.lastSuccess).toBe('')
    expect(moved.actions).toEqual({})
  })

  it('탭을 옮기면 이전 탭의 조치 실패 문구도 지운다', async () => {
    doubles.work.setRestriction.mockRejectedValueOnce(new Error('내부 스택 정보'))
    const t = setup('works')
    t.render()
    expect(await t.render().live.setWorkRestriction('w1', true)).toBe(false)
    expect(t.render().actions['work:w1']?.error).toContain('완료 여부를 확인하지 못했어요')

    t.go('audit')
    t.render()
    expect(t.render().actions).toEqual({})
  })

  it('같은 탭에서 다시 그려져도 조치 문구는 유지한다', async () => {
    const t = setup('works')
    t.render()
    await t.render().live.setWorkRestriction('w1', false)
    t.render()
    t.render()
    expect(t.render().lastSuccess).toBe(RESTRICTION_LIFTED)
    expect(Object.keys(t.render().actions)).toEqual(['work:w1'])
  })
})
