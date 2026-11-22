// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import type { SerialBoardRecord, SerialSettings } from '../../../../domain/entities/aiSerial'
import { SerialUseCase } from '../../../../domain/usecases/SerialUseCase'
import { fakeSerialRepo, record, settings } from '../../../../test/serialFixtures'
import { useAiSerialViewModel } from './useAiSerialViewModel'

afterEach(() => { cleanup(); vi.useRealTimers() })

const fakeRepo = (saved?: SerialSettings, rows?: SerialBoardRecord[]) => fakeSerialRepo({ saved, rows })
const setup = (repo = fakeRepo()) => {
  const useCase = new SerialUseCase(repo)
  const hook = renderHook(() => useAiSerialViewModel('w1', useCase))
  return { repo, ...hook }
}
const loaded = async (hook: ReturnType<typeof setup>) => { await waitFor(() => expect(hook.result.current.form).toBeDefined()); await waitFor(() => expect(hook.result.current.boards).toBeDefined()) }

it('설정과 게시판 기록을 읽어 입력 칸을 서버 값으로 채운다', async () => {
  const hook = setup()
  expect(hook.result.current.form).toBeUndefined()
  await loaded(hook)
  expect(hook.result.current.form).toEqual(settings())
  expect(hook.result.current.boards).toEqual([record()])
  expect(hook.result.current.dirty).toBe(false)
  expect(hook.result.current.canSave).toBe(false)
  expect(hook.repo.settings).toHaveBeenCalledWith('w1', expect.any(AbortSignal))
  expect(hook.repo.boards).toHaveBeenCalledWith('w1', expect.any(AbortSignal))
})

it('설정을 읽지 못하면 실패 문구를 보이고 다시 불러오기로 읽는다 (빈 설정으로 채우지 않는다)', async () => {
  const repo = fakeRepo()
  repo.settings.mockRejectedValueOnce(new Error('설정 서버 오류'))
  const hook = setup(repo)
  await waitFor(() => expect(hook.result.current.loadError).toBe('설정 서버 오류'))
  expect(hook.result.current.form).toBeUndefined()
  act(() => hook.result.current.reload())
  await waitFor(() => expect(hook.result.current.form).toEqual(settings()))
  expect(hook.result.current.loadError).toBe('')
})

it('기록만 읽지 못해도 설정은 보이고 기록 실패를 따로 알린다', async () => {
  const repo = fakeRepo()
  repo.boards.mockRejectedValueOnce(new Error('기록 서버 오류'))
  const hook = setup(repo)
  await waitFor(() => expect(hook.result.current.form).toBeDefined())
  await waitFor(() => expect(hook.result.current.boardsError).toBe('기록 서버 오류'))
  expect(hook.result.current.boards).toBeUndefined()
  expect(hook.result.current.loadError).toBe('')
  await act(() => hook.result.current.refreshBoards())
  expect(hook.result.current.boards).toEqual([record()])
  expect(hook.result.current.boardsError).toBe('')
})

it('입력을 바꾸면 저장할 수 있고, 저장하면 저장 완료를 알린 뒤 서버 값을 다시 읽어 기준 설정과 기록을 갱신한다', async () => {
  // AI 자율 집필이 켜져 있는데 요일이 비어 있으면 요일을 골라야 저장할 수 있다(꺼져 있을 때의 빈 요일은 도메인 테스트가 본다).
  const repo = fakeRepo(settings({ days: [] }))
  const hook = setup(repo)
  await loaded(hook)
  expect(hook.result.current.formError).toContain('요일')
  expect(hook.result.current.canSave).toBe(false)
  act(() => { hook.result.current.toggleDay('SAT'); hook.result.current.toggleDay('MON') })
  expect(hook.result.current.form).toEqual({ enabled: true, days: ['SAT', 'MON'], time: '21:00', direction: '밝은 분위기로' })
  expect(hook.result.current.canSave).toBe(true)
  repo.settings.mockResolvedValue(settings({ days: ['MON', 'SAT'] }))
  repo.boards.mockResolvedValue([record({ id: 'b2' }), record()])
  await act(() => hook.result.current.save())
  // 요일·시각·방향만 보낸다(켜짐은 집필 방식이 정하므로 보내지 않는다).
  expect(repo.saveSettings).toHaveBeenCalledWith('w1', { days: ['SAT', 'MON'], time: '21:00', direction: '밝은 분위기로' }, expect.any(AbortSignal))
  // 입력 칸은 보낸 값 그대로 두고(그새 고친 입력을 지우지 않게) 기준 설정만 서버가 저장한 값으로 맞춘다.
  expect(hook.result.current.saved).toEqual(settings({ days: ['MON', 'SAT'] }))
  expect(hook.result.current.form).toEqual({ enabled: true, days: ['SAT', 'MON'], time: '21:00', direction: '밝은 분위기로' })
  expect(hook.result.current.dirty).toBe(false)
  expect(hook.result.current.notice).toEqual({ ok: true, text: '설정을 저장했어요.' })
  expect(hook.result.current.canSave).toBe(false)
  expect(hook.result.current.saving).toBe(false)
  // 저장하면 게시판이 열릴 수 있어 기록도 다시 읽는다.
  expect(hook.result.current.boards).toEqual([record({ id: 'b2' }), record()])
})

it('규칙을 어긴 입력은 저장 버튼이 잠기고 저장 요청도 보내지 않는다', async () => {
  const hook = setup()
  await loaded(hook)
  act(() => hook.result.current.edit({ time: '25:00' }))
  expect(hook.result.current.formError).toContain('시각')
  expect(hook.result.current.canSave).toBe(false)
  await act(() => hook.result.current.save())
  expect(hook.repo.saveSettings).not.toHaveBeenCalled()
  act(() => hook.result.current.edit({ time: '22:30', direction: '가'.repeat(2001) }))
  expect(hook.result.current.formError).toContain('2,000자')
})

it('저장이 실패하면 서버 문구를 알리고 입력은 그대로 두며 다시 저장할 수 있다', async () => {
  const repo = fakeRepo()
  repo.saveSettings.mockRejectedValueOnce(new Error('작품 소유자만 할 수 있어요.'))
  const hook = setup(repo)
  await loaded(hook)
  act(() => hook.result.current.edit({ direction: '새 방향' }))
  await act(() => hook.result.current.save())
  expect(hook.result.current.notice).toEqual({ ok: false, text: '작품 소유자만 할 수 있어요.' })
  expect(hook.result.current.form?.direction).toBe('새 방향')
  expect(hook.result.current.saved?.direction).toBe('밝은 분위기로')
  expect(hook.result.current.saving).toBe(false)
  expect(hook.result.current.canSave).toBe(true)
  repo.settings.mockResolvedValue(settings({ direction: '새 방향' }))
  await act(() => hook.result.current.save())
  expect(hook.result.current.notice?.ok).toBe(true)
})

it('꺼져 있거나 열린 게시판이 없으면 지금 실행을 막고 요청도 보내지 않는다', async () => {
  const off = setup(fakeRepo(settings({ enabled: false })))
  await loaded(off)
  expect(off.result.current.runBlock).toContain('AI 자율 집필을 고르면')
  await act(() => off.result.current.run())
  expect(off.repo.run).not.toHaveBeenCalled()
  const none = setup(fakeRepo(settings(), [record({ status: 'published' })]))
  await loaded(none)
  expect(none.result.current.runBlock).toContain('열린 의견 게시판이 없어요')
})

it('지금 마감·실행은 한 번만 요청하고 202 뒤에 기록을 다시 읽어 실행 대기를 보인다', async () => {
  const repo = fakeRepo()
  let finish = () => {}
  repo.run.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve }))
  const hook = setup(repo)
  await loaded(hook)
  expect(hook.result.current.runBlock).toBeNull()
  let first!: Promise<void>
  act(() => { first = hook.result.current.run(); void hook.result.current.run() })
  expect(hook.result.current.running).toBe(true)
  expect(repo.run).toHaveBeenCalledTimes(1)
  repo.boards.mockResolvedValue([record({ status: 'queued' })])
  await act(async () => { finish(); await first })
  expect(hook.result.current.running).toBe(false)
  expect(hook.result.current.notice?.ok).toBe(true)
  expect(hook.result.current.notice?.text).toContain('실행을 요청')
  expect(hook.result.current.boards).toEqual([record({ status: 'queued' })])
  expect(hook.result.current.runBlock).toContain('이미 실행 중')
})

it('실행 요청이 409로 거절되면 서버 문구를 알리고 기록을 다시 읽는다', async () => {
  const repo = fakeRepo()
  repo.run.mockRejectedValueOnce(new Error('이미 실행 중이에요.'))
  const hook = setup(repo)
  await loaded(hook)
  repo.boards.mockResolvedValue([record({ status: 'running' })])
  await act(() => hook.result.current.run())
  expect(hook.result.current.notice).toEqual({ ok: false, text: '이미 실행 중이에요.' })
  expect(hook.result.current.running).toBe(false)
  expect(hook.result.current.boards).toEqual([record({ status: 'running' })])
})

it('저장(PUT)이 성공했으면 설정을 다시 읽다 실패해도 저장 완료로 알리고, 그 실패는 따로 알리며 기록은 다시 읽는다', async () => {
  const repo = fakeRepo()
  const hook = setup(repo)
  await loaded(hook)
  act(() => hook.result.current.edit({ direction: '새 방향' }))
  repo.settings.mockRejectedValueOnce(new Error('설정 서버 오류')) // 저장 뒤 다시 읽기만 실패한다
  repo.boards.mockResolvedValue([record({ id: 'b2' })])
  await act(() => hook.result.current.save())
  expect(hook.result.current.notice).toEqual({ ok: true, text: '설정을 저장했어요.' })
  // 보낸 값이 기준이 되어 저장 버튼이 다시 열리지 않고, 읽기 실패는 설정 읽기 실패로 따로 알린다.
  expect(hook.result.current.saved?.direction).toBe('새 방향')
  expect(hook.result.current.form?.direction).toBe('새 방향')
  expect(hook.result.current.canSave).toBe(false)
  expect(hook.result.current.loadError).toContain('저장은 됐')
  expect(hook.result.current.loadError).toContain('설정 서버 오류')
  // 설정 다시 읽기 실패가 기록 다시 읽기를 건너뛰게 하지 않는다.
  expect(hook.result.current.boards).toEqual([record({ id: 'b2' })])
})

it('저장(PUT)이 성공했으면 기록을 다시 읽다 실패해도 저장 완료는 그대로 알리고 기록 실패를 따로 알린다', async () => {
  const repo = fakeRepo()
  const hook = setup(repo)
  await loaded(hook)
  act(() => hook.result.current.edit({ direction: '새 방향' }))
  repo.settings.mockResolvedValue(settings({ direction: '새 방향' }))
  repo.boards.mockRejectedValueOnce(new Error('기록 서버 오류'))
  await act(() => hook.result.current.save())
  expect(hook.result.current.notice).toEqual({ ok: true, text: '설정을 저장했어요.' })
  expect(hook.result.current.boardsError).toBe('기록 서버 오류')
  expect(hook.result.current.saved).toEqual(settings({ direction: '새 방향' }))
  expect(hook.result.current.loadError).toBe('')
})

it('기록을 읽지 못한 동안 지금 실행을 잠그는 이유는 불러오는 중이 아니라 읽기 실패다', async () => {
  const repo = fakeRepo()
  repo.boards.mockRejectedValueOnce(new Error('기록 서버 오류'))
  const hook = setup(repo)
  await waitFor(() => expect(hook.result.current.boardsError).toBe('기록 서버 오류'))
  expect(hook.result.current.runBlock).toContain('불러오지 못')
  expect(hook.result.current.runBlock).not.toContain('불러오는 중')
  await act(() => hook.result.current.refreshBoards())
  expect(hook.result.current.runBlock).toBeNull()
})

it('화면을 떠나 실행 요청이 취소되면 기록을 다시 읽지 않는다', async () => {
  const run = vi.fn((...[, signal]: [string, AbortSignal?]) => new Promise<void>((_, reject) => signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))))
  const repo = { ...fakeRepo(), run }
  const useCase = new SerialUseCase(repo) // 콜백 안에서 만들면 렌더마다 새 UseCase라 effect가 계속 다시 돈다
  const hook = renderHook(() => useAiSerialViewModel('w1', useCase))
  await waitFor(() => expect(hook.result.current.boards).toBeDefined())
  const reads = repo.boards.mock.calls.length
  let pending!: Promise<void>
  act(() => { pending = hook.result.current.run() })
  hook.unmount()
  await pending
  expect(repo.boards.mock.calls.length).toBe(reads)
})

it('대기·실행 중인 게시판이 있는 동안만 5초마다 기록을 다시 읽는다', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
  const repo = fakeRepo(settings(), [record({ status: 'running' })])
  const hook = setup(repo)
  await act(async () => { await vi.advanceTimersByTimeAsync(0) })
  expect(hook.result.current.boards).toEqual([record({ status: 'running' })])
  const reads = () => repo.boards.mock.calls.length
  const before = reads()
  await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
  expect(reads()).toBe(before + 1)
  repo.boards.mockResolvedValue([record({ status: 'published', publishedEpisodeNumber: 4, closedAt: '2026-11-22T12:00:00Z' })])
  await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
  expect(hook.result.current.boards?.[0].status).toBe('published')
  const settled = reads()
  await act(async () => { await vi.advanceTimersByTimeAsync(20000) })
  expect(reads()).toBe(settled)
})
