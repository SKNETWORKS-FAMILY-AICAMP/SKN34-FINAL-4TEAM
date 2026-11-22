// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { Provider } from 'react-redux'
import { afterEach, expect, it, vi } from 'vitest'

import { createAppStore } from '../../../../app/store'
import { seedWorks } from '../../../../data/mock/seed'
import { INSUFFICIENT_CREDIT_MESSAGE, type SerialBoardView } from '../../../../domain/entities/aiSerial'
import { SerialUseCase } from '../../../../domain/usecases/SerialUseCase'
import { board, fakeSerialRepo, proposal, serverWork as work } from '../../../../test/serialFixtures'
import { useSerialBoardRead, useSerialBoardViewModel } from './useSerialBoardViewModel'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

const fakeRepo = (view?: SerialBoardView) => fakeSerialRepo({ view })
type Session = Parameters<typeof createAppStore>[0]
const wrap = (session: Session) => {
  const store = createAppStore(session)
  return { store, wrapper: ({ children }: { children: ReactNode }) => <Provider store={store}>{children}</Provider> }
}
const setup = (repo = fakeRepo(), session: Session = { role: 'user', memberId: 'member-2' }) => {
  const { store, wrapper } = wrap(session)
  const useCase = new SerialUseCase(repo)
  return { repo, store, ...renderHook(() => useSerialBoardViewModel(work, useSerialBoardRead(work, useCase), useCase), { wrapper }) }
}
const loaded = (hook: ReturnType<typeof setup>) => waitFor(() => expect(hook.result.current.view).toBeDefined())

it('공개 서버 작품의 다음 회차 게시판(AI 자율 집필 여부·선택지·제안 글)을 읽어 보여 준다', async () => {
  const hook = setup()
  expect(hook.result.current.view).toBeUndefined()
  await loaded(hook)
  expect(hook.result.current.view).toEqual(board())
  expect(hook.repo.board).toHaveBeenCalledWith('postman', expect.any(AbortSignal))
  expect(hook.result.current.isError).toBe(false)
})

it('데모 작품과 비공개 작품은 게시판을 읽지도 않고, 작품이 아직 없어도 읽지 않는다', async () => {
  const repo = fakeRepo()
  const useCase = new SerialUseCase(repo)
  const { wrapper } = wrap({ role: 'user', memberId: 'member-2' })
  const demo = seedWorks(0).find((w) => w.id === 'guunmong')!
  for (const target of [demo, { ...work, private: true }, undefined]) {
    const hook = renderHook(() => useSerialBoardRead(target, useCase), { wrapper })
    await act(async () => {})
    expect(hook.result.current.data).toBeUndefined()
    expect(hook.result.current.isError).toBe(false)
    hook.unmount()
  }
  expect(repo.board).not.toHaveBeenCalled()
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

it('하위 탭은 투표가 처음이고, 탭을 바꾸면 이전 요청의 알림을 지운다', async () => {
  const hook = setup()
  await loaded(hook)
  expect(hook.result.current.sub).toBe('vote')
  await act(async () => { await hook.result.current.vote('c2') })
  expect(hook.result.current.notice?.ok).toBe(true)
  act(() => hook.result.current.setSub('board'))
  expect(hook.result.current.sub).toBe('board')
  expect(hook.result.current.notice).toBeUndefined()
})

it('제안 정렬은 최신순이 처음이고 추천순으로 바꾸면 추천이 많은 글부터(같으면 먼저 쓴 글)이며, 서버가 준 목록은 바꾸지 않는다', async () => {
  // 추천순이 최신순과 다르게 나오도록 둔다: a와 c가 5표로 같고(먼저 쓴 a가 앞), b는 1표다.
  const posts = [
    proposal({ id: 'a', likes: 5, createdAt: '2026-11-22T01:00:00Z' }),
    proposal({ id: 'b', likes: 1, createdAt: '2026-11-22T02:00:00Z' }),
    proposal({ id: 'c', likes: 5, createdAt: '2026-11-22T03:00:00Z' }),
  ]
  const hook = setup(fakeRepo(board({ proposals: posts })))
  await loaded(hook)
  expect(hook.result.current.sort).toBe('new')
  expect(hook.result.current.proposals.map((p) => p.id)).toEqual(['c', 'b', 'a'])
  act(() => hook.result.current.setSort('likes'))
  expect(hook.result.current.proposals.map((p) => p.id)).toEqual(['a', 'c', 'b'])
  act(() => hook.result.current.setSort('new'))
  expect(hook.result.current.view?.proposals.map((p) => p.id)).toEqual(['a', 'b', 'c'])
})

it('제안 글은 하나만 펼치고 같은 글을 다시 누르면 접는다', async () => {
  const hook = setup()
  await loaded(hook)
  expect(hook.result.current.openId).toBeNull()
  act(() => hook.result.current.toggleOpen('p1'))
  expect(hook.result.current.openId).toBe('p1')
  act(() => hook.result.current.toggleOpen('p2'))
  expect(hook.result.current.openId).toBe('p2')
  act(() => hook.result.current.toggleOpen('p2'))
  expect(hook.result.current.openId).toBeNull()
})

it('투표·옮기기·취소는 각각 요청을 보내고 결과 문구를 알린 뒤 서버 값을 다시 읽는다', async () => {
  const hook = setup()
  await loaded(hook)
  // 투표 뒤 서버가 보는 상태(내 투표 = c1)를 다시 읽는다.
  hook.repo.board.mockResolvedValue(board({ myChoiceId: 'c1' }))
  await act(async () => { await hook.result.current.vote('c1') })
  expect(hook.repo.vote).toHaveBeenCalledWith('postman', 'c1', expect.any(AbortSignal))
  expect(hook.result.current.notice).toEqual({ ok: true, text: '투표했어요.' })
  await waitFor(() => expect(hook.result.current.view?.myChoiceId).toBe('c1'))
  await act(async () => { await hook.result.current.vote('c2') })
  expect(hook.repo.vote).toHaveBeenLastCalledWith('postman', 'c2', expect.any(AbortSignal))
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
  act(() => { first = hook.result.current.vote('c1'); second = hook.result.current.vote('c2') })
  expect(hook.result.current.busy).toBe(true)
  expect(repo.vote).toHaveBeenCalledTimes(1)
  await act(async () => { finish(); await first })
  expect(await second).toBe(false)
  expect(hook.result.current.busy).toBe(false)
})

it('추천은 이미 추천한 글이면 추천 취소를, 아니면 추천을 보내고 결과 문구를 알린다', async () => {
  const hook = setup()
  await loaded(hook)
  await act(async () => { await hook.result.current.toggleLike(proposal({ id: 'p1', likedByMe: false })) })
  expect(hook.repo.likeProposal).toHaveBeenCalledWith('postman', 'p1', expect.any(AbortSignal))
  expect(hook.repo.unlikeProposal).not.toHaveBeenCalled()
  expect(hook.result.current.notice).toEqual({ ok: true, text: '추천했어요.' })
  await act(async () => { await hook.result.current.toggleLike(proposal({ id: 'p1', likedByMe: true })) })
  expect(hook.repo.unlikeProposal).toHaveBeenCalledWith('postman', 'p1', expect.any(AbortSignal))
  expect(hook.result.current.notice).toEqual({ ok: true, text: '추천을 취소했어요.' })
})

it('제안 글 숨김은 확인한 뒤에만 요청하고, 취소하면 아무것도 보내지 않는다', async () => {
  const hook = setup(fakeRepo(), { role: 'user', memberId: 'member-1' })
  await loaded(hook)
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
  await act(async () => { expect(await hook.result.current.hide('p1')).toBe(false) })
  expect(hook.repo.hideProposal).not.toHaveBeenCalled()
  confirm.mockReturnValue(true)
  await act(async () => { expect(await hook.result.current.hide('p1')).toBe(true) })
  expect(hook.repo.hideProposal).toHaveBeenCalledWith('postman', 'p1', expect.any(AbortSignal))
  expect(hook.result.current.notice).toEqual({ ok: true, text: '제안 글을 숨겼어요.' })
})

it('일반 제안 글을 올리면 요청을 보내고 성공을 알린 뒤 게시판을 다시 읽어 내 글을 반영한다', async () => {
  const hook = setup()
  await loaded(hook)
  hook.repo.board.mockResolvedValue(board({ proposals: [proposal({ id: 'p9', mine: true }), proposal()] }))
  let ok = false
  await act(async () => { ok = await hook.result.current.submit({ kind: 'general', title: ' 새 제안 ', body: ' 새 내용 ' }) })
  expect(ok).toBe(true)
  expect(hook.repo.submitProposal).toHaveBeenCalledWith('postman', { kind: 'general', title: '새 제안', body: '새 내용' }, expect.any(AbortSignal))
  expect(hook.result.current.notice).toEqual({ ok: true, text: '제안 글을 올렸어요.' })
  await waitFor(() => expect(hook.result.current.view?.proposals.some((p) => p.id === 'p9' && p.mine)).toBe(true))
  expect(hook.result.current.busy).toBe(false)
})

it('시뮬레이션 제안 글은 크레딧 차감을 알리고 계정 크레딧 표시를 다시 읽게 한다', async () => {
  const hook = setup()
  await loaded(hook)
  const before = hook.store.getState().session.dataVersion
  await act(async () => { await hook.result.current.submit({ kind: 'simulation', title: '편지 장면', body: '읽는 장면', premise: '편지를 읽었다면', beats: ['문을 연다', ''] }) })
  expect(hook.repo.submitProposal).toHaveBeenCalledWith('postman', { kind: 'simulation', title: '편지 장면', body: '읽는 장면', simulation: { premise: '편지를 읽었다면', beats: ['문을 연다'] } }, expect.any(AbortSignal))
  expect(hook.result.current.notice?.ok).toBe(true)
  expect(hook.result.current.notice?.text).toContain('크레딧')
  expect(hook.store.getState().session.dataVersion).toBe(before + 1)
})

it('서버가 거절하면(409) 서버가 준 문구를 그대로 알리고 게시판을 다시 읽는다', async () => {
  const repo = fakeRepo()
  repo.submitProposal.mockRejectedValueOnce(new Error('열린 게시판이 없어요.'))
  const hook = setup(repo)
  await loaded(hook)
  repo.board.mockResolvedValue(board({ board: null, choices: [], proposals: [] }))
  let ok = true
  await act(async () => { ok = await hook.result.current.submit({ kind: 'general', title: '제목', body: '내용' }) })
  expect(ok).toBe(false)
  expect(hook.result.current.notice).toEqual({ ok: false, text: '열린 게시판이 없어요.' })
  await waitFor(() => expect(hook.result.current.view?.board).toBeNull())
  expect(hook.store.getState().session.dataVersion).toBe(0)
})

it('크레딧이 부족하면(409) 시뮬레이션 제안을 저장하지 않았다는 문구로 알린다', async () => {
  const repo = fakeRepo()
  repo.submitProposal.mockRejectedValueOnce(new Error(INSUFFICIENT_CREDIT_MESSAGE))
  const hook = setup(repo)
  await loaded(hook)
  await act(async () => { await hook.result.current.submit({ kind: 'simulation', title: '제목', body: '내용', premise: '전제', beats: [] }) })
  expect(hook.result.current.notice).toEqual({ ok: false, text: INSUFFICIENT_CREDIT_MESSAGE })
})

it('규칙을 어긴 제안 글은 요청 없이 안내 문구로 거절한다', async () => {
  const hook = setup()
  await loaded(hook)
  let ok = true
  await act(async () => { ok = await hook.result.current.submit({ kind: 'general', title: '   ', body: '내용' }) })
  expect(ok).toBe(false)
  expect(hook.repo.submitProposal).not.toHaveBeenCalled()
  expect(hook.result.current.notice).toEqual({ ok: false, text: '제목을 입력해 주세요.' })
})

it('제안 폼: 일반은 제목과 내용이 있어야 보낼 수 있고, 규칙을 넘으면 이유와 함께 잠긴다', async () => {
  const hook = setup()
  await loaded(hook)
  // 빈 입력은 보내기만 잠겨 있고 이유는 없다(제목·내용을 모두 쓴 뒤 규칙을 넘었을 때만 이유를 보인다).
  expect(hook.result.current.form).toMatchObject({ kind: 'general', title: '', body: '', canSubmit: false, problem: null })
  act(() => hook.result.current.form.setTitle('반전 제안'))
  expect(hook.result.current.form).toMatchObject({ canSubmit: false, problem: null })
  act(() => hook.result.current.form.setBody('다음엔 반전이 좋겠어요'))
  expect(hook.result.current.form).toMatchObject({ canSubmit: true, problem: null })
  act(() => hook.result.current.form.setBody('가'.repeat(2001)))
  expect(hook.result.current.form.canSubmit).toBe(false)
  expect(hook.result.current.form.problem).toContain('2,000자')
})

it('제안 폼: 시뮬레이션은 전제까지 써야 보낼 수 있고 비트가 5개·200자를 넘으면 이유와 함께 잠긴다', async () => {
  const hook = setup()
  await loaded(hook)
  act(() => { hook.result.current.form.setKind('simulation'); hook.result.current.form.setTitle('편지 장면'); hook.result.current.form.setBody('읽는 장면'); hook.result.current.form.setBeats('하나\n둘\n셋\n넷\n다섯\n여섯') })
  // 전제가 없으면 아직 빈 입력이다(비트가 많아도 이유는 전제를 쓴 뒤에 보인다).
  expect(hook.result.current.form).toMatchObject({ kind: 'simulation', canSubmit: false, problem: null })
  act(() => hook.result.current.form.setPremise('편지를 읽었다면'))
  expect(hook.result.current.form.canSubmit).toBe(false)
  expect(hook.result.current.form.problem).toContain('5개')
  act(() => hook.result.current.form.setBeats('하나\n\n둘'))
  expect(hook.result.current.form).toMatchObject({ canSubmit: true, problem: null })
  act(() => hook.result.current.form.setBeats('가'.repeat(201)))
  expect(hook.result.current.form.problem).toContain('200자')
})

it('제안 폼: 글쓰기를 열고 닫을 수 있고, 보내는 동안은 잠기며, 성공하면 입력을 비우고 폼을 닫고 실패하면 그대로 둔다', async () => {
  const repo = fakeRepo()
  repo.submitProposal.mockRejectedValueOnce(new Error('서버 거절'))
  const hook = setup(repo)
  await loaded(hook)
  expect(hook.result.current.writing).toBe(false)
  act(() => { hook.result.current.setWriting(true); hook.result.current.form.setTitle('내 제안'); hook.result.current.form.setBody('내 내용') })
  await act(async () => { expect(await hook.result.current.form.send()).toBe(false) })
  expect(hook.result.current.writing).toBe(true)
  expect(hook.result.current.form).toMatchObject({ title: '내 제안', body: '내 내용' })
  let finish = () => {}
  repo.submitProposal.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve }))
  let sending!: Promise<boolean>
  act(() => { sending = hook.result.current.form.send() })
  expect(hook.result.current.form.canSubmit).toBe(false)
  await act(async () => { finish(); expect(await sending).toBe(true) })
  expect(repo.submitProposal).toHaveBeenLastCalledWith('postman', { kind: 'general', title: '내 제안', body: '내 내용' }, expect.any(AbortSignal))
  expect(hook.result.current.form).toMatchObject({ title: '', body: '' })
  expect(hook.result.current.writing).toBe(false)
})

it('제안 폼: 시뮬레이션을 보내면 제목·내용·전제·비트 입력을 모두 비우고 일반 유형으로 돌아간다', async () => {
  const hook = setup()
  await loaded(hook)
  act(() => {
    hook.result.current.setWriting(true)
    hook.result.current.form.setKind('simulation'); hook.result.current.form.setTitle('편지 장면'); hook.result.current.form.setBody('읽는 장면')
    hook.result.current.form.setPremise('편지를 읽었다면'); hook.result.current.form.setBeats('문을 연다\n편지를 펼친다')
  })
  await act(async () => { expect(await hook.result.current.form.send()).toBe(true) })
  expect(hook.repo.submitProposal).toHaveBeenCalledWith('postman', { kind: 'simulation', title: '편지 장면', body: '읽는 장면', simulation: { premise: '편지를 읽었다면', beats: ['문을 연다', '편지를 펼친다'] } }, expect.any(AbortSignal))
  expect(hook.result.current.form).toMatchObject({ kind: 'general', title: '', body: '', premise: '', beats: '', canSubmit: false })
})

it('제안 폼: 취소하면 폼을 닫고 입력을 비운다', async () => {
  const hook = setup()
  await loaded(hook)
  act(() => { hook.result.current.setWriting(true); hook.result.current.form.setTitle('쓰다 만 제목'); hook.result.current.form.setBody('쓰다 만 내용') })
  act(() => hook.result.current.form.cancel())
  expect(hook.result.current.writing).toBe(false)
  expect(hook.result.current.form).toMatchObject({ title: '', body: '' })
})
