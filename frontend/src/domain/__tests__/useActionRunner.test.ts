import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useReportsViewModel } from '../../presentation/features/reports/viewmodel/useReportsViewModel'
import { useReportWorkViewModel } from '../../presentation/shared/reports/useReportWorkViewModel'
import { sessionActions } from '../../presentation/shared/session/sessionSlice'
import { useActionRunner } from '../../presentation/shared/useActionRunner'
import { OperationsError } from '../entities/operations'
import type { ReportRepository } from '../repositories/ReportRepository'
import { ReportUseCase } from '../usecases/ReportUseCase'

// 공용 조치 실행기와 이를 쓰는 신고 ViewModel 두 개의 동작을 고정합니다. 렌더러 없이 Hook 본문만 실행하므로
// adminMutationCompletion.test.ts처럼 단위 범위에 둡니다. 같은 호출 순서의 Hook은 같은 슬롯을 쓰고,
// render()를 다시 부르면 setState로 바뀐 값을 읽습니다. 실제 React 렌더 회귀는 CI 통합 테스트가 맡습니다.
const hooks = vi.hoisted(() => {
  const slots: unknown[] = []
  let cursor = 0
  const slot = <T>(initial: () => T) => { const i = cursor++; if (!(i in slots)) slots[i] = initial(); return i }
  return {
    clear: () => { slots.length = 0 },
    render: <T>(hook: () => T) => { cursor = 0; return hook() },
    useRef: <T>(current: T) => slots[slot(() => ({ current }))] as { current: T },
    useState: <T>(initial: T) => {
      const i = slot(() => initial)
      return [slots[i] as T, (next: T | ((prev: T) => T)) => { slots[i] = typeof next === 'function' ? (next as (prev: T) => T)(slots[i] as T) : next }] as const
    },
    useEffect: () => {},
  }
})
const dispatch = vi.hoisted(() => vi.fn())
vi.mock('react', () => ({ useRef: hooks.useRef, useState: hooks.useState, useEffect: hooks.useEffect }))
vi.mock('../../app/appContainer', () => ({ appContainer: { resolve: vi.fn() } }))
vi.mock('../../app/store', () => ({ useAppDispatch: () => dispatch, useAppSelector: (select: (state: unknown) => unknown) => select({ session: { memberId: 'me' } }) }))
vi.mock('../../presentation/shared/useAsyncData', () => ({ useAsyncData: () => ({ data: undefined }) }))

beforeEach(() => {
  vi.clearAllMocks()
  hooks.clear()
})

/** 호출만 기록하는 Fake Repository 위에 실제 UseCase를 얹습니다. */
function setup() {
  const repository: ReportRepository = {
    submit: vi.fn(), listMine: vi.fn(), listAll: vi.fn(), get: vi.fn(), addEvidence: vi.fn(), addExplanation: vi.fn(),
    review: vi.fn(), setContentRestriction: vi.fn(), requestEvidence: vi.fn(),
  }
  return { repository, useCase: new ReportUseCase(repository) }
}
/** 끝내기 전까지 pending인 요청 하나를 만듭니다. */
function deferred() {
  let finish!: () => void
  return { promise: new Promise<void>((done) => { finish = done }), finish }
}

describe('useActionRunner', () => {
  const FALLBACK = '안내 문구'
  const ok = (msg: string) => ({ ok: true, msg })
  const mount = (onError?: (message: string) => void) => () => hooks.render(() => useActionRunner(FALLBACK, onError))

  it('성공 결과는 완료 문구로 보여 주고 true를 돌려준다', async () => {
    const view = mount()
    expect(await view().run('a', async () => ok('저장했어요'))).toBe(true)
    expect(view().actions).toEqual({ a: { pending: false, error: '', message: '저장했어요' } })
  })

  it('ok가 아닌 결과는 그 문구를 오류로 보여 주고 false를 돌려주되 onError는 부르지 않는다', async () => {
    const onError = vi.fn()
    const view = mount(onError)
    expect(await view().run('a', async () => ({ ok: false, msg: '조치할 수 없어요' }))).toBe(false)
    expect(view().actions.a).toEqual({ pending: false, error: '조치할 수 없어요', message: '' })
    expect(onError).not.toHaveBeenCalled()
  })

  it.each([
    ['OperationsError 문구', new OperationsError('충돌했어요'), '충돌했어요'],
    ['내부 내용 없는 fallback 문구', new Error('내부 스택 정보'), FALLBACK],
  ])('예외가 나면 %s를 오류로 보여 주고 onError로 알린다', async (_name, error, message) => {
    const onError = vi.fn()
    const view = mount(onError)
    expect(await view().run('a', () => Promise.reject(error))).toBe(false)
    expect(view().actions.a).toEqual({ pending: false, error: message, message: '' })
    expect(onError).toHaveBeenCalledExactlyOnceWith(message)
  })

  it('onError를 생략해도 예외를 오류로만 보여 준다', async () => {
    const view = mount()
    expect(await view().run('a', () => Promise.reject(new Error('내부')))).toBe(false)
    expect(view().actions.a.error).toBe(FALLBACK)
  })

  it('같은 key가 진행 중이면 실행하지 않고 다른 key는 함께 실행하며, 끝나면 같은 key를 다시 실행할 수 있다', async () => {
    const view = mount()
    const request = deferred()
    const task = vi.fn(async () => { await request.promise; return ok('끝') })
    const first = view().run('a', task)
    expect(view().actions.a).toEqual({ pending: true, error: '', message: '' })
    expect(await view().run('a', task)).toBe(false)
    expect(task).toHaveBeenCalledTimes(1)
    expect(await view().run('b', async () => ok('다른 조치'))).toBe(true)
    request.finish()
    expect(await first).toBe(true)
    expect(await view().run('a', async () => ok('다시'))).toBe(true)
    expect(view().actions).toEqual({
      a: { pending: false, error: '', message: '다시' },
      b: { pending: false, error: '', message: '다른 조치' },
    })
  })

  it('실패한 key도 끝나면 다시 실행할 수 있고, reset은 모든 key의 상태를 지운다', async () => {
    const view = mount()
    expect(await view().run('a', () => Promise.reject(new Error('실패')))).toBe(false)
    expect(await view().run('a', async () => ok('성공'))).toBe(true)
    expect(view().actions.a.message).toBe('성공')
    view().reset()
    expect(view().actions).toEqual({})
  })
})

describe('useReportWorkViewModel', () => {
  const FALLBACK = '접수 여부를 확인하지 못했어요. 내 신고 목록에서 확인한 뒤 다시 시도해 주세요.'
  const mount = (useCase: ReportUseCase) => () => hooks.render(() => useReportWorkViewModel('w1', useCase))

  it('접수에 성공하면 정리한 입력을 서버에 보내고 done으로만 표시한다', async () => {
    const { repository, useCase } = setup()
    const view = mount(useCase)
    expect(view()).toMatchObject({ open: false, pending: false, error: '', done: false })
    expect(await view().submit('HARMFUL', ' 사유 ', ' 3화 ')).toBe(true)
    expect(repository.submit).toHaveBeenCalledWith({ kind: 'HARMFUL', workId: 'w1', reason: '사유', evidence: '3화' })
    expect(view()).toMatchObject({ pending: false, error: '', done: true })
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('접수 중에는 pending이고 같은 신고를 다시 보내지 않으며, 끝나면 다시 보낼 수 있다', async () => {
    const { repository, useCase } = setup()
    const request = deferred()
    vi.mocked(repository.submit).mockReturnValueOnce(request.promise)
    const view = mount(useCase)
    const first = view().submit('RIGHTS', '사유', '')
    expect(view()).toMatchObject({ pending: true, error: '', done: false })
    expect(await view().submit('RIGHTS', '사유', '')).toBe(false)
    expect(repository.submit).toHaveBeenCalledTimes(1)
    request.finish()
    expect(await first).toBe(true)
    expect(view()).toMatchObject({ pending: false, done: true })
    expect(await view().submit('RIGHTS', '사유', '')).toBe(true)
    expect(repository.submit).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['OperationsError 문구', new OperationsError('입력값을 확인해 주세요.'), '입력값을 확인해 주세요.'],
    ['내부 내용 없는 안내 문구', new Error('내부 스택 정보'), FALLBACK],
  ])('접수에 실패하면 %s를 보여 주고 false를 돌려주며 다시 보낼 수 있다', async (_name, error, message) => {
    const { repository, useCase } = setup()
    vi.mocked(repository.submit).mockRejectedValueOnce(error)
    const view = mount(useCase)
    expect(await view().submit('RIGHTS', '사유', '')).toBe(false)
    expect(view()).toMatchObject({ pending: false, error: message, done: false })
    expect(await view().submit('RIGHTS', '사유', '')).toBe(true)
    expect(view()).toMatchObject({ error: '', done: true })
  })

  it('폼을 열고 닫으면 이전 결과를 지운다', async () => {
    const { useCase } = setup()
    const view = mount(useCase)
    view().toggle()
    expect(view().open).toBe(true)
    await view().submit('RIGHTS', '사유', '')
    expect(view().done).toBe(true)
    view().toggle()
    expect(view()).toMatchObject({ open: false, pending: false, error: '', done: false })
  })
})

describe('useReportsViewModel', () => {
  const FALLBACK = '완료 여부를 확인하지 못했어요. 새로고침해 처리 여부를 확인한 뒤 다시 시도해 주세요.'
  const mount = (useCase: ReportUseCase) => () => hooks.render(() => useReportsViewModel(useCase))

  it.each([
    ['증거 보완', '증거를 보완했어요.', 'addEvidence'],
    ['소명 제출', '소명을 제출했어요.', 'addExplanation'],
  ] as const)('%s에 성공하면 정리한 본문을 보내고 완료 문구를 보여 주며 목록을 다시 읽게 한다', async (_name, message, method) => {
    const { repository, useCase } = setup()
    const view = mount(useCase)
    expect(await view()[method]('r1', ' 본문 ')).toBe(true)
    expect(repository[method]).toHaveBeenCalledWith('r1', '본문')
    expect(view().action).toEqual({ pending: false, error: '', message })
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenCalledWith(sessionActions.dataChanged())
  })

  it('처리 중에는 pending이고 어떤 조치든 다시 보내지 않으며, 끝나면 다시 보낼 수 있다', async () => {
    const { repository, useCase } = setup()
    const request = deferred()
    vi.mocked(repository.addEvidence).mockReturnValueOnce(request.promise)
    const view = mount(useCase)
    const first = view().addEvidence('r1', '증거')
    expect(view().action).toEqual({ pending: true, error: '', message: '' })
    expect(await view().addExplanation('r1', '소명')).toBe(false)
    expect(await view().addEvidence('r1', '증거')).toBe(false)
    expect(repository.addExplanation).not.toHaveBeenCalled()
    expect(repository.addEvidence).toHaveBeenCalledTimes(1)
    request.finish()
    expect(await first).toBe(true)
    expect(await view().addExplanation('r1', '소명')).toBe(true)
    expect(dispatch).toHaveBeenCalledTimes(2)
  })

  it.each([
    ['OperationsError 문구', new OperationsError('다른 변경과 충돌했어요.'), '다른 변경과 충돌했어요.'],
    ['내부 내용 없는 안내 문구', new Error('내부 스택 정보'), FALLBACK],
  ])('실패하면 %s를 보여 주고 목록을 다시 읽지 않으며 다시 보낼 수 있다', async (_name, error, message) => {
    const { repository, useCase } = setup()
    vi.mocked(repository.addExplanation).mockRejectedValueOnce(error)
    const view = mount(useCase)
    expect(await view().addExplanation('r1', '소명')).toBe(false)
    expect(view().action).toEqual({ pending: false, error: message, message: '' })
    expect(dispatch).not.toHaveBeenCalled()
    expect(await view().addExplanation('r1', '소명')).toBe(true)
  })

  it('내 신고를 고르면 이전 조치 결과를 지운다', async () => {
    const { useCase } = setup()
    const view = mount(useCase)
    await view().addEvidence('r1', '증거')
    expect(view().action.message).toBe('증거를 보완했어요.')
    view().select('r2')
    expect(view().sel).toBe('r2')
    expect(view().action).toEqual({ pending: false, error: '', message: '' })
  })
})
