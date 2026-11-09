// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { asValue } from 'awilix/browser'
import { Provider } from 'react-redux'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { appContainer } from '../../../../app/appContainer'
import { createAppStore } from '../../../../app/store'
import { createFixtureDb } from '../../../../data/mock/fixtureDb'
import { InMemoryWorkRepository } from '../../../../data/mock/InMemoryRepositories'
import { StudioPage } from './StudioPage'

// This file uses its own container; production and other tests keep their repositories.
vi.mock('../../../../app/appContainer', async () => {
  const { createAppContainer } = await import('../../../../app/di/container')
  return { appContainer: createAppContainer() }
})

beforeEach(() => {
  const db = appContainer.resolve('mockDb')
  Object.assign(db, createFixtureDb())
  appContainer.register({ workRepository: asValue(new InMemoryWorkRepository(db)) })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const renderStudio = (path: string) => render(
  <Provider store={createAppStore({ role: 'user' })}>
    <MemoryRouter initialEntries={[path]}><Routes><Route path="/studio/:id" element={<StudioPage />} /></Routes></MemoryRouter>
  </Provider>,
)

describe('데모 집필실 보완 (#36)', () => {
  it('?view=constructor 같은 상속 속성 이름은 원고 화면으로 대체한다', async () => {
    renderStudio('/studio/starlight?view=constructor')
    expect(await screen.findByLabelText('원고 본문')).toBeTruthy()
  })

  it('연결된 공개 세계관을 복사하면 잠겼던 사전 편집 칸이 다시 열린다', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    appContainer.resolve('mockDb').works.find((w) => w.id === 'starlight')!.worldIds = ['shared-world']
    renderStudio('/studio/starlight?view=wiki&cat=place&ct=table')
    expect(((await screen.findByLabelText('시점')) as HTMLSelectElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '안개 항구 복사 후 수정' }))
    await waitFor(() => expect((screen.getByLabelText('시점') as HTMLSelectElement).disabled).toBe(false))
  })
})
