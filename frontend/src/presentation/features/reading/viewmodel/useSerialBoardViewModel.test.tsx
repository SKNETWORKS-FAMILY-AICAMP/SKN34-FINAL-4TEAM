// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { Provider } from 'react-redux'
import { afterEach, expect, it, vi } from 'vitest'

import { createAppStore } from '../../../../app/store'
import { SERIAL_ERROR_MESSAGES, type SerialBoardView } from '../../../../domain/entities/aiSerial'
import { SerialUseCase } from '../../../../domain/usecases/SerialUseCase'
import { board, fakeSerialRepo, serverWork as work } from '../../../../test/serialFixtures'
import { useSerialBoardViewModel } from './useSerialBoardViewModel'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

const fakeRepo = (view?: SerialBoardView) => fakeSerialRepo({ view })
const setup = (repo = fakeRepo(), session: Parameters<typeof createAppStore>[0] = { role: 'user', memberId: 'member-2' }) => {
  const store = createAppStore(session)
  const useCase = new SerialUseCase(repo)
  const wrapper = ({ children }: { children: ReactNode }) => <Provider store={store}>{children}</Provider>
  return { repo, store, ...renderHook(() => useSerialBoardViewModel(work, useCase), { wrapper }) }
}
const loaded = (hook: ReturnType<typeof setup>) => waitFor(() => expect(hook.result.current.view).toBeDefined())

it('작품의 열린 게시판을 읽어 보여 준다', async () => {
  const hook = setup()
  expect(hook.result.current.view).toBeUndefined()
  await loaded(hook)
  expect(hook.result.current.view).toEqual(board())
  expect(hook.repo.board).toHaveBeenCalledWith('postman', expect.any(AbortSignal))
  expect(hook.result.current.isError).toBe(false)
})

it('읽지 못하면 실패로 알리고 다시 불러오기로 읽는다 (빈 게시판으로 숨기지 않는다)', async () => {
  const repo = fakeRepo()
  repo.board.mockRejectedValueOnce(new Error('서버 오류'))
  const hook = setup(repo)
  await waitFor(() => expect(hook.result.current.isError).toBe(true))
  expect(hook.result.current.view).toBeUndefined()
  act(() => hook.result.current.retry())
  await loaded(hook)
  expect(hook.result.current.isError).toBe(false)
})

it('로그인 여부와 소유자 여부를 가른다 (숨기기는 소유자만)', async () => {
  const anonymous = setup(fakeRepo(), { role: null, memberId: null })
  await loaded(anonymous)
  expect([anonymous.result.current.loggedIn, anonymous.result.current.canHide]).toEqual([false, false])
  const reader = setup()
  await loaded(reader)
  expect([reader.result.current.loggedIn, reader.result.current.canHide]).toEqual([true, false])
  const owner = setup(fakeRepo(), { role: 'user', memberId: 'member-1' })
  await loaded(owner)
  expect([owner.result.current.loggedIn, owner.result.current.canHide]).toEqual([true, true])
})

it('비로그인이 로그인 안내를 누르면 로그인 뒤 이 작품으로 돌아오게 남긴다', async () => {
  const hook = setup(fakeRepo(), { role: null, memberId: null })
  await loaded(hook)
  act(() => hook.result.current.requireLogin())
  expect(hook.store.getState().session.next).toBe('/work/postman')
  expect(hook.store.getState().session.loginMsg).toContain('로그인')
})

it('일반 의견을 내면 요청을 보내고 성공을 알린 뒤 게시판을 다시 읽어 내 의견을 반영한다', async () => {
  const hook = setup()
  await loaded(hook)
  hook.repo.board.mockResolvedValue(board({ myOpinionId: 'o9' }))
  let ok = false
  await act(async () => { ok = await hook.result.current.submit({ kind: 'general', body: ' 새 의견 ' }) })
  expect(ok).toBe(true)
  expect(hook.repo.submitOpinion).toHaveBeenCalledWith('postman', { kind: 'general', body: '새 의견' }, expect.any(AbortSignal))
  expect(hook.result.current.notice).toEqual({ ok: true, text: '의견을 냈어요.' })
  await waitFor(() => expect(hook.result.current.view?.myOpinionId).toBe('o9'))
  expect(hook.result.current.busy).toBe(false)
})

it('시뮬레이션 의견은 크레딧 차감을 알리고 계정 크레딧 표시를 다시 읽게 한다', async () => {
  const hook = setup()
  await loaded(hook)
  const before = hook.store.getState().session.dataVersion
  await act(async () => { await hook.result.current.submit({ kind: 'simulation', premise: '편지를 읽었다면', beats: ['문을 연다', ''] }) })
  expect(hook.repo.submitOpinion).toHaveBeenCalledWith('postman', { kind: 'simulation', body: '', simulation: { premise: '편지를 읽었다면', beats: ['문을 연다'] } }, expect.any(AbortSignal))
  expect(hook.result.current.notice?.ok).toBe(true)
  expect(hook.result.current.notice?.text).toContain('크레딧')
  expect(hook.store.getState().session.dataVersion).toBe(before + 1)
})

it('이미 낸 의견(409)은 코드별 문구로 알리고 게시판을 다시 읽어 입력 폼이 사라지게 한다', async () => {
  const repo = fakeRepo()
  repo.submitOpinion.mockRejectedValueOnce(new Error(SERIAL_ERROR_MESSAGES.OPINION_EXISTS))
  const hook = setup(repo)
  await loaded(hook)
  repo.board.mockResolvedValue(board({ myOpinionId: 'o7' }))
  let ok = true
  await act(async () => { ok = await hook.result.current.submit({ kind: 'general', body: '다시 냄' }) })
  expect(ok).toBe(false)
  expect(hook.result.current.notice).toEqual({ ok: false, text: SERIAL_ERROR_MESSAGES.OPINION_EXISTS })
  await waitFor(() => expect(hook.result.current.view?.myOpinionId).toBe('o7'))
  expect(hook.store.getState().session.dataVersion).toBe(0)
})

it('크레딧이 부족하면(409) 시뮬레이션 의견을 저장하지 않았다는 문구로 알린다', async () => {
  const repo = fakeRepo()
  repo.submitOpinion.mockRejectedValueOnce(new Error(SERIAL_ERROR_MESSAGES.INSUFFICIENT_CREDIT))
  const hook = setup(repo)
  await loaded(hook)
  await act(async () => { await hook.result.current.submit({ kind: 'simulation', premise: '전제', beats: [] }) })
  expect(hook.result.current.notice).toEqual({ ok: false, text: SERIAL_ERROR_MESSAGES.INSUFFICIENT_CREDIT })
})

it('규칙을 어긴 의견은 요청 없이 안내 문구로 거절한다', async () => {
  const hook = setup()
  await loaded(hook)
  let ok = true
  await act(async () => { ok = await hook.result.current.submit({ kind: 'general', body: '   ' }) })
  expect(ok).toBe(false)
  expect(hook.repo.submitOpinion).not.toHaveBeenCalled()
  expect(hook.result.current.notice).toEqual({ ok: false, text: '의견을 입력해 주세요.' })
})

it('투표·옮기기·취소는 각각 요청을 보내고 결과 문구를 알린다', async () => {
  const hook = setup()
  await loaded(hook)
  // 투표 뒤 서버가 보는 상태(내 투표 = o1)를 다시 읽는다.
  hook.repo.board.mockResolvedValue(board({ myVoteOpinionId: 'o1' }))
  await act(async () => { await hook.result.current.vote('o1') })
  expect(hook.repo.vote).toHaveBeenCalledWith('postman', 'o1', expect.any(AbortSignal))
  expect(hook.result.current.notice).toEqual({ ok: true, text: '투표했어요.' })
  await waitFor(() => expect(hook.result.current.view?.myVoteOpinionId).toBe('o1'))
  await act(async () => { await hook.result.current.vote('o2') })
  expect(hook.repo.vote).toHaveBeenLastCalledWith('postman', 'o2', expect.any(AbortSignal))
  expect(hook.result.current.notice).toEqual({ ok: true, text: '투표를 옮겼어요.' })
  await act(async () => { await hook.result.current.cancelVote() })
  expect(hook.repo.cancelVote).toHaveBeenCalledWith('postman', expect.any(AbortSignal))
  expect(hook.result.current.notice).toEqual({ ok: true, text: '투표를 취소했어요.' })
})

it('요청을 처리하는 동안 다른 요청은 보내지 않는다', async () => {
  const repo = fakeRepo()
  let finish = () => {}
  repo.vote.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve }))
  const hook = setup(repo)
  await loaded(hook)
  let first!: Promise<boolean>
  let second!: Promise<boolean>
  act(() => { first = hook.result.current.vote('o1'); second = hook.result.current.vote('o2') })
  expect(hook.result.current.busy).toBe(true)
  expect(repo.vote).toHaveBeenCalledTimes(1)
  await act(async () => { finish(); await first })
  expect(await second).toBe(false)
  expect(hook.result.current.busy).toBe(false)
})

it('의견 숨김은 확인한 뒤에만 요청하고, 취소하면 아무것도 보내지 않는다', async () => {
  const hook = setup(fakeRepo(), { role: 'user', memberId: 'member-1' })
  await loaded(hook)
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  await act(async () => { expect(await hook.result.current.hide('o1')).toBe(false) })
  expect(hook.repo.hideOpinion).not.toHaveBeenCalled()
  confirm.mockReturnValue(true)
  await act(async () => { expect(await hook.result.current.hide('o1')).toBe(true) })
  expect(hook.repo.hideOpinion).toHaveBeenCalledWith('postman', 'o1', expect.any(AbortSignal))
  expect(hook.result.current.notice).toEqual({ ok: true, text: '의견을 숨겼어요.' })
})
