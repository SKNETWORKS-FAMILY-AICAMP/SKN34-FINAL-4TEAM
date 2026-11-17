// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'

import { createAppStore } from '../../../../app/store'
import { newSetting, type StudioSetting, type StudioWorld, type WorldRevision, type WorldRevisionSummary } from '../../../../domain/entities/studioWorld'
import { WorldStudioUseCase } from '../../../../domain/usecases/WorldStudioUseCase'
import { WorldStudioPage } from './WorldStudioPage'

/**
 * 확정 버전 시트에서 `이 버전으로 초안 되돌리기`를 누르는 흐름을 실제 훅(useWorldRevisions)과 ViewModel로 끝까지 본다. 서버는 UseCase 대역이다.
 * 되돌리면 서버가 초안의 카드를 바꾸고, 화면은 그 초안을 다시 읽어 설정집에 보이며 '저장하지 않은 변경'으로 남기지 않는다.
 */
let useCase: WorldStudioUseCase
vi.mock('../viewmodel/useWorldStudioViewModel', async (original) => {
  const actual = await original<typeof import('../viewmodel/useWorldStudioViewModel')>()
  return { useWorldStudioViewModel: () => actual.useWorldStudioViewModel(useCase, null) }
})
vi.mock('../viewmodel/useWorldRevisions', async (original) => {
  const actual = await original<typeof import('../viewmodel/useWorldRevisions')>()
  return { useWorldRevisions: (...args: Parameters<typeof actual.useWorldRevisions>) => actual.useWorldRevisions(args[0], args[1], args[2], args[3], args[4], args[5], useCase, null) }
})
vi.mock('../../../shared/LazyMarkdownEditor', () => import('../../../../test/markdownEditorFake'))
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const card = (id: string, title: string, text: string): StudioSetting => {
  const row = newSetting('people')
  row.item.id = id
  row.item.title = title
  row.item.text = text
  return row
}

function serve(restoreFails?: Error) {
  // 서버의 현재 초안(버전 3): a는 확정 뒤에 고쳤고 c는 확정 버전에 없던 카드다.
  let world: StudioWorld = { id: 'qa', name: '검증 세계', description: '설명', version: 3, currentRevisionId: 'r1', settings: [card('a', '가람 수정', '수정한 내용'), card('c', '다온', '새 카드')], analysis: null }
  const confirmed = [card('a', '가람 확정', '확정 당시 내용')]
  const summary: WorldRevisionSummary = { worldId: 'qa', revisionId: 'r1', revisionNo: 1, name: '확정 세계', createdAt: '2026-11-17T00:00:00Z' }
  const detail: WorldRevision = {
    worldId: 'qa', revisionId: 'r1', revisionNo: 1, name: '확정 세계', description: '확정 소개', parentRevisionId: null, restoredFromRevisionId: null, relationshipStatus: 'not_recorded', relationships: null,
    cards: confirmed.map((s) => ({ versionId: 'v-' + s.item.id, versionNo: 1, restoredFromVersionId: null, card: { id: s.item.id, title: s.item.title, body: s.item.text, cardType: 'character', areaCode: 'basic', classification: '', aliases: [], tags: [], semanticMetadata: {}, visibility: 'private', lifecycle: 'active' } })),
  }
  const read = vi.fn(async () => structuredClone(world))
  const restoreRevision = vi.fn(async (_id: string, _revision: string, expected: number) => {
    if (restoreFails) throw restoreFails
    if (expected !== world.version) throw new Error('다른 변경이 저장되어 있습니다.')
    world = { ...world, version: world.version + 1, settings: structuredClone(confirmed) }
    return structuredClone(world)
  })
  useCase = new WorldStudioUseCase({
    listStudio: async () => [world], read, create: vi.fn(), saveStudio: vi.fn(), setPublication: vi.fn(),
    confirm: vi.fn(), revisions: async () => [summary], revision: async () => detail, restoreRevision,
  })
  render(
    <Provider store={createAppStore({ role: 'user', memberId: 'owner' })}>
      <MemoryRouter initialEntries={['/worldstudio/qa']}>
        <Routes><Route path="/worldstudio/:worldId?" element={<WorldStudioPage />} /></Routes>
      </MemoryRouter>
    </Provider>,
  )
  return { read, restoreRevision }
}
/** 설정집 화면의 `확정 버전 남기기`로 시트를 열고 확정 버전 1을 펼친다. */
async function openVersion() {
  await screen.findByRole('heading', { name: '검증 세계', level: 1 })
  fireEvent.click(screen.getByRole('button', { name: '확정 버전 남기기' }))
  const sheet = within(await screen.findByRole('dialog', { name: '확정 버전' }))
  fireEvent.click(await sheet.findByRole('button', { name: /확정 버전 1 · 확정 세계/ }))
  return sheet
}

it('확정 버전 시트에서 되돌리면 서버가 바꾼 초안을 다시 읽어 설정집에 보이고 저장하지 않은 변경으로 남기지 않는다', async () => {
  const { read, restoreRevision } = serve()
  const sheet = await openVersion()
  expect(screen.getByRole('button', { name: /가람 수정/, hidden: true })).toBeTruthy() // 되돌리기 전 설정집
  const ask = vi.spyOn(window, 'confirm').mockReturnValue(true)
  fireEvent.click(await sheet.findByRole('button', { name: '이 버전으로 초안 되돌리기' }))
  expect(String(ask.mock.calls[0][0])).toContain('사라지는 설정 카드 1개') // 다온
  await waitFor(() => expect(restoreRevision).toHaveBeenCalledExactlyOnceWith('qa', 'r1', 3, expect.any(AbortSignal)))
  expect(await sheet.findByText(/확정 버전 1의 카드로 초안을 되돌렸어요/)).toBeTruthy()
  await waitFor(() => expect(document.activeElement).toBe(sheet.getByRole('button', { name: '이 버전으로 초안 되돌리기' })))
  expect(read.mock.calls.length).toBeGreaterThanOrEqual(2) // 처음 읽기 + 되돌린 뒤 다시 읽기
  fireEvent.click(sheet.getByRole('button', { name: '닫기' }))
  expect(await screen.findByRole('button', { name: /가람 확정/ })).toBeTruthy()
  expect(screen.queryByRole('button', { name: /가람 수정/ })).toBeNull()
  expect(screen.queryByRole('button', { name: /다온/ })).toBeNull()
  const bar = within(screen.getByRole('group', { name: '저장 상태' }))
  expect(bar.getByText('저장됨')).toBeTruthy() // 서버 초안이 바뀐 상태이지 저장하지 않은 변경이 아니다
  expect(bar.getByRole<HTMLButtonElement>('button', { name: '세계관 저장' }).disabled).toBe(true)
})

it('서버가 되돌리기를 거절하면 그 이유를 그대로 알리고 설정집은 그대로다', async () => {
  const reason = '이 버전으로 되돌리면 사라지는 설정에 이어진 관계가 있어요: 다온. 관계를 먼저 지운 뒤 다시 시도하세요.'
  const { restoreRevision } = serve(new Error(reason))
  const sheet = await openVersion()
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  fireEvent.click(await sheet.findByRole('button', { name: '이 버전으로 초안 되돌리기' }))
  expect((await sheet.findByText(reason)).getAttribute('role')).toBe('alert')
  expect(restoreRevision).toHaveBeenCalledOnce()
  expect(sheet.queryByText(/초안을 되돌렸어요/)).toBeNull()
  fireEvent.click(sheet.getByRole('button', { name: '닫기' }))
  expect(screen.getByRole('button', { name: /가람 수정/ })).toBeTruthy()
  expect(screen.getByRole('button', { name: /다온/ })).toBeTruthy()
})
