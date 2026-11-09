// @vitest-environment jsdom
// CI integration: 데모(메모리 저장소) 세계관 복원은 실제로 복원됐을 때만 성공 토스트를 띄운다.
import { act, cleanup, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'

import { createAppStore } from '../../../app/store'
import { createFixtureDb } from '../../../data/mock/fixtureDb'
import { InMemoryFeedbackRepository, InMemoryReadingRepository, InMemoryWorkRepository, InMemoryWorldRepository } from '../../../data/mock/InMemoryRepositories'
import { InMemoryWorkInterestRepository } from '../../../data/mock/InMemoryWorkInterestRepository'
import { LibraryUseCase } from '../../../domain/usecases/LibraryUseCase'
import { useNewWorkViewModel } from './viewmodel/useNewWorkViewModel'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

// #33
it('세계관 복원은 없는 버전이면 오류를 알리고 실제로 복원됐을 때만 성공 토스트를 띄운다', async () => {
  const db = createFixtureDb(), store = createAppStore({ role: 'user' })
  const uc = new LibraryUseCase(new InMemoryWorkRepository(db), new InMemoryWorldRepository(db), new InMemoryReadingRepository(db), new InMemoryFeedbackRepository(db), new InMemoryWorkInterestRepository())
  const made = await uc.createWorld({ name: '내 세계', description: '', rules: '규칙' })
  if (!('id' in made)) throw new Error(made.error)
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  const messages: string[] = []
  const listen = (event: Event) => messages.push((event as CustomEvent<string>).detail)
  window.addEventListener('sf-toast', listen)
  try {
    const wrapper = ({ children }: { children: ReactNode }) => <Provider store={store}><MemoryRouter>{children}</MemoryRouter></Provider>
    const { result } = renderHook(() => useNewWorkViewModel(uc), { wrapper })
    await act(async () => {})
    await act(async () => { await result.current.restore(made.id, 9) })
    await act(async () => { await result.current.restore(made.id, 0) })
    expect(messages).toEqual(['복원할 수 있는 세계관 버전이 없어요', '선택한 버전을 복원했어요 (데모)'])
  } finally { window.removeEventListener('sf-toast', listen) }
})
