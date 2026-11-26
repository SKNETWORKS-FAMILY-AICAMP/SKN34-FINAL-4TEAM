// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'

import { createAppStore } from '../../../../app/store'
import type { ImportWorldBuild } from '../../../../domain/entities/manuscript'

// 시트는 ViewModel이 돌려준 상태만 그린다. 저장·접수 흐름은 useEpisodeBulkImport.test가 맡는다.
const hook = vi.hoisted(() => ({ vm: {} as Record<string, unknown> }))
vi.mock('../viewmodel/useEpisodeBulkImport', () => ({ useEpisodeBulkImport: () => hook.vm }))

import { EpisodeBulkImportSheet } from './EpisodeBulkImportSheet'

const NOTICE = '세계관을 처음 만들 때는 업로드한 원고가 자동 추출을 위해 OpenAI로 전송돼요.'
const started: ImportWorldBuild = { status: 'started', jobId: 'job-1', code: null, message: null }
const rejected: ImportWorldBuild = { status: 'rejected', jobId: null, code: null, message: '1화에 저장한 원고가 없어요. 모든 회차의 원고를 저장한 뒤 다시 시작해 주세요.' }
const show = (extra: Record<string, unknown> = {}, firstUnsavedEpisode: number | null = null) => {
  hook.vm = {
    basis: { lastNumber: 2, workRevision: 5 }, rows: [], start: '3', setStart: vi.fn(), rightsConfirmed: false, setRightsConfirmed: vi.fn(),
    editable: true, busy: false, error: '', stopReason: null, progress: null, results: new Map(), savedCount: 0, failedCount: 0, worldBuild: null,
    canStart: false, canRetry: false, selectFiles: vi.fn(), move: vi.fn(), replaceFailed: vi.fn(), refreshBasis: vi.fn(), submit: vi.fn(), retryFailed: vi.fn(),
    ...extra,
  }
  const store = createAppStore()
  const sheet = () => <Provider store={store}><MemoryRouter><EpisodeBulkImportSheet workId="w" firstUnsavedEpisode={firstUnsavedEpisode} onClose={vi.fn()} /></MemoryRouter></Provider>
  const view = render(sheet())
  return () => view.rerender(sheet())
}
afterEach(cleanup)

it('회차 저장 버튼 곁에 OpenAI 전송 안내 한 줄을 두고 확인 입력은 권리 확인 하나뿐이다', () => {
  show({ canStart: true, rightsConfirmed: true })
  const footer = screen.getByText(NOTICE).closest('footer')!
  expect(within(footer).getByRole('button', { name: '회차 저장' })).toBeTruthy()
  expect(within(footer).getAllByRole('checkbox')).toHaveLength(1)
})

it('세계관 추출이 시작되면 진행을 볼 곳을 상태 문구(role=status)로 알린다', () => {
  show({ editable: false, savedCount: 2, worldBuild: started })
  expect(screen.getByText('세계관 추출을 시작했어요. 작품 관리 > 세계관에서 진행을 볼 수 있어요.').getAttribute('role')).toBe('status')
})

it('회차 저장 집계와 세계관 추출 거절 사유를 함께 표시한다', () => {
  show({ editable: false, progress: { done: 2, total: 2 }, savedCount: 2, worldBuild: rejected })
  expect(screen.getByRole('status').textContent).toContain('저장 2개 · 실패 0개')
  expect(screen.getByRole('alert').textContent).toBe(`세계관 추출을 시작하지 못했어요. ${rejected.message}`)
})

it.each([
  { firstUnsavedEpisode: 1, number: 2, shown: true },
  { firstUnsavedEpisode: 1, number: 1, shown: false },
  { firstUnsavedEpisode: 1, number: 0, shown: false },
  { firstUnsavedEpisode: null, number: 2, shown: false },
])('1화가 미저장일 때 기존 사전 안내를 유지한다 (%j)', ({ firstUnsavedEpisode, number, shown }) => {
  show({
    rows: [{ id: 0, file: new File(['원고'], '첫 파일.txt'), number, title: '첫 파일' }],
    start: String(number), canStart: number > 0,
  }, firstUnsavedEpisode)
  const notice = screen.queryByText(/1화에 저장한 원고가 없어서/)
  expect(!!notice).toBe(shown)
  if (shown) {
    const start = screen.getByRole('spinbutton', { name: '시작 회차' })
    const save = screen.getByRole('button', { name: '회차 저장' }) as HTMLButtonElement
    expect(start.getAttribute('aria-describedby')).toBe(notice!.id)
    expect(save.getAttribute('aria-describedby')).toBe(notice!.id)
    expect(notice!.textContent).toContain('시작 회차를 1로 바꾸거나 집필실에서 1화를 먼저 버전 저장해 주세요.')
    expect(save.disabled).toBe(false)
  }
})

it.each([3, 2])('미저장 3화를 건너뛰면 안내하고 시작 회차를 %i화로 바꾸면 안내를 지운다', (newStart) => {
  const file = new File(['원고'], '첫 파일.txt')
  const row = { id: 0, file, number: 5, title: '첫 파일' }
  const rerender = show({
    basis: { lastNumber: 4, workRevision: 5 }, rows: [row], start: '5', canStart: true,
    setStart: (start: string) => {
      hook.vm.start = start
      hook.vm.rows = [{ ...row, number: Number(start) }]
      rerender()
    },
  }, 3)
  const notice = screen.getByText(/3화에 저장한 원고가 없어서/)
  const start = screen.getByRole('spinbutton', { name: '시작 회차' })
  const save = screen.getByRole<HTMLButtonElement>('button', { name: '회차 저장' })
  expect(notice.textContent).toContain('시작 회차를 3화로 바꾸거나 집필실에서 3화를 먼저 버전 저장해 주세요.')
  expect(start.getAttribute('aria-describedby')).toBe(notice.id)
  expect(save.getAttribute('aria-describedby')).toBe(notice.id)
  expect(save.disabled).toBe(false)

  fireEvent.change(start, { target: { value: String(newStart) } })
  expect(screen.queryByText(/3화에 저장한 원고가 없어서/)).toBeNull()
  expect(start.hasAttribute('aria-describedby')).toBe(false)
  expect(save.hasAttribute('aria-describedby')).toBe(false)
})

it('접수하지 않았으면(null) 세계관 추출 문구를 그리지 않는다', () => {
  show({ editable: false, savedCount: 1, worldBuild: null })
  expect(screen.queryByText(/세계관 추출을 시작/)).toBeNull()
  expect(screen.queryByRole('alert')).toBeNull()
})

it('최초 구축이 끝난 작품은 발행 안내를 상태 메시지로 보여 준다', () => {
  const message = '새 회차를 처음 발행하면 세계관 초안에 반영돼요.'
  show({ editable: false, savedCount: 1, worldBuild: { ...rejected, code: 'WORLD_UPDATE_ON_PUBLISH', message } })
  expect(screen.getByRole('status').textContent).toBe(message)
  expect(screen.queryByText(/세계관 추출을 시작하지 못했어요/)).toBeNull()
  expect(screen.queryByRole('alert')).toBeNull()
  expect(screen.queryByText(NOTICE)).toBeNull()
})
