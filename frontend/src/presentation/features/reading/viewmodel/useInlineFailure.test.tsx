// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { useInlineFailure } from './useInlineFailure'

const toasts: string[] = []
const heard = (e: Event) => { toasts.push((e as CustomEvent<string>).detail) }
beforeEach(() => { toasts.length = 0; window.addEventListener('sf-toast', heard) })
afterEach(() => { window.removeEventListener('sf-toast', heard) })

describe('useInlineFailure', () => {
  it('화면이 떠 있는 동안의 실패는 그 화면 안에 남기고 토스트로 내보내지 않는다', () => {
    const { result } = renderHook(() => useInlineFailure())
    expect(result.current.error).toBeNull()
    act(() => result.current.fail('내용을 입력해 주세요'))
    expect(result.current.error).toBe('내용을 입력해 주세요')
    expect(toasts).toEqual([])
  })

  it('다음 요청을 시작하며 지우면 이전 사유가 사라진다', () => {
    const { result } = renderHook(() => useInlineFailure())
    act(() => result.current.fail('저장 실패'))
    act(() => result.current.clear())
    expect(result.current.error).toBeNull()
  })

  it('화면을 닫은 뒤에 끝난 실패는 토스트로 알린다', () => {
    const { result, unmount } = renderHook(() => useInlineFailure())
    const { fail } = result.current
    unmount()
    fail('공개 회차를 찾을 수 없어요.')
    expect(toasts).toEqual(['공개 회차를 찾을 수 없어요.'])
  })
})
