// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'

import { createAppStore } from '../../../../app/store'
import { newSetting, type StudioWorld } from '../../../../domain/entities/studioWorld'
import { WorldStudioUseCase } from '../../../../domain/usecases/WorldStudioUseCase'
import { WorldStudioPage } from './WorldStudioPage'

let useCase: WorldStudioUseCase
vi.mock('../viewmodel/useWorldStudioViewModel', async (original) => {
  const actual = await original<typeof import('../viewmodel/useWorldStudioViewModel')>()
  return { useWorldStudioViewModel: () => actual.useWorldStudioViewModel(useCase) }
})
vi.mock('./WorldMapCanvas', () => ({ default: () => null }))

afterEach(() => { cleanup(); document.title = 'STORYFORK' })

async function showWorld() {
  const row = newSetting('people')
  row.item.title = '가람'
  row.item.text = '기존 내용'
  const world: StudioWorld = { id: 'qa', name: '검증 세계', description: '설명', version: 1, settings: [row], analysis: null }
  useCase = new WorldStudioUseCase({
    listStudio: async () => [world],
    read: async () => structuredClone(world),
    create: vi.fn(async (_name: string, _description: string): Promise<StudioWorld> => { throw new Error('unused') }),
    saveStudio: async (next: StudioWorld) => next,
  })
  render(
    <Provider store={createAppStore({ role: 'user' })}>
      <MemoryRouter initialEntries={['/worldstudio/qa']}>
        <Routes><Route path="/worldstudio/:worldId" element={<WorldStudioPage />} /></Routes>
      </MemoryRouter>
    </Provider>,
  )
  await screen.findByRole('heading', { name: '검증 세계', level: 2 })
}

it('세계관 탐색 보기 탭은 현재 보기를 aria-pressed로 알리고 보기를 바꾸면 따라간다', async () => {
  await showWorld()
  fireEvent.click(screen.getByText('세계관 탐색'))
  const tabs = within(screen.getByRole('navigation', { name: '세계관 탐색 보기' }))
  expect(tabs.getByRole('button', { name: '전체 세계관 지도' }).getAttribute('aria-pressed')).toBe('true')
  expect(tabs.getByRole('button', { name: '설정집' }).getAttribute('aria-pressed')).toBe('false')
  fireEvent.click(tabs.getByRole('button', { name: '설정집' }))
  expect(tabs.getByRole('button', { name: '설정집' }).getAttribute('aria-pressed')).toBe('true')
  expect(tabs.getByRole('button', { name: '전체 세계관 지도' }).getAttribute('aria-pressed')).toBe('false')
})

it('세계관 작업실은 h1 하나와 건너뛰기 링크가 닿는 main을 가진다', async () => {
  await showWorld()
  expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual(['세계관 작성'])
  expect(screen.getAllByRole('main')).toHaveLength(1)
  expect(screen.getByRole('main').id).toBe('main')
  expect(screen.getByRole('main').getAttribute('tabindex')).toBe('-1')
})

it('탭 제목에 세계관을 쓴다', async () => {
  await showWorld()
  expect(document.title).toBe('세계관 · STORYFORK')
})
