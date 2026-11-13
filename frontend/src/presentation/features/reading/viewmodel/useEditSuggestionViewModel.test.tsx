// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { EditSuggestionUseCase } from '../../../../domain/usecases/EditSuggestionUseCase'
import { useEditSuggestionViewModel } from './useEditSuggestionViewModel'

const toasts: string[] = []
const heard = (e: Event) => { toasts.push((e as CustomEvent<string>).detail) }
beforeEach(() => { toasts.length = 0; window.addEventListener('sf-toast', heard) })
afterEach(() => { window.removeEventListener('sf-toast', heard) })

/** propose만 쓰는 ViewModel이라 그 한 메서드만 대역으로 둔다. */
const useCaseWith = (propose: EditSuggestionUseCase['propose']) => ({ propose }) as EditSuggestionUseCase

describe('useEditSuggestionViewModel · 실패 안내', () => {
  it('시트가 열려 있으면 실패 사유를 시트 안에만 남기고 다음 전송을 시작하면 지운다', async () => {
    const propose = vi.fn<EditSuggestionUseCase['propose']>().mockRejectedValueOnce(new Error('원문에서 고칠 문장을 찾을 수 없어요.')).mockReturnValue(new Promise(() => {}))
    const { result } = renderHook(() => useEditSuggestionViewModel('guunmong', 2, useCaseWith(propose)))
    let ok = true
    await act(async () => { ok = await result.current.propose('전', '후', '') })
    expect(ok).toBe(false)
    expect(result.current.error).toBe('원문에서 고칠 문장을 찾을 수 없어요.')
    expect(result.current.busy).toBe(false)
    expect(toasts).toEqual([])
    act(() => { void result.current.propose('전', '후', '') })
    expect(result.current.error).toBeNull()
    expect(result.current.busy).toBe(true)
  })

  it('시트를 닫은 뒤에 끝난 실패는 토스트로 알린다', async () => {
    let reject!: (reason: Error) => void
    const propose = vi.fn<EditSuggestionUseCase['propose']>(() => new Promise((_, no) => { reject = no }))
    const { result, unmount } = renderHook(() => useEditSuggestionViewModel('guunmong', 2, useCaseWith(propose)))
    let sent!: Promise<boolean>
    act(() => { sent = result.current.propose('전', '후', '') })
    unmount()
    reject(new Error('공개 작품을 찾을 수 없어요.'))
    expect(await sent).toBe(false)
    expect(toasts).toEqual(['공개 작품을 찾을 수 없어요.'])
  })
})
