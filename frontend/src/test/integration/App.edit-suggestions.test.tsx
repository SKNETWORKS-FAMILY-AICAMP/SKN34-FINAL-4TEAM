// @vitest-environment jsdom
import '../fixtureApp'

import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { asValue } from 'awilix/browser'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { appContainer } from '../../app/appContainer'
import { createAppStore } from '../../app/store'
import type { EditSuggestion } from '../../domain/entities/editSuggestion'
import type { EditSuggestionRepository } from '../../domain/repositories/EditSuggestionRepository'
import type { EpisodeCommentRepository } from '../../domain/repositories/EpisodeCommentRepository'
import { EditSuggestionUseCase } from '../../domain/usecases/EditSuggestionUseCase'
import { EpisodeCommentUseCase } from '../../domain/usecases/EpisodeCommentUseCase'
import { renderApp } from '../renderApp'

const user = () => createAppStore({ role: 'user' })
const toastText = () => document.getElementById('toast')!.textContent

const suggestion = (extra: Partial<EditSuggestion> = {}): EditSuggestion => ({
  id: 's1', workId: 'w1', workTitle: '별빛 서약', episodeNumber: 3, publishedVersionId: 'v1', source: 'reader', proposerName: '독자A',
  beforeText: '않 된다고', afterText: '안 된다고', editedText: null, reason: null, status: 'pending', decisionReason: null,
  applyResult: null, applyFailure: null, appliedVersionId: null, scope: 'auto', scopeReasons: ['단어마다 한 글자 오탈자 수준만 바뀌어요.'],
  mine: false, owner: true, createdAt: '2026-11-10T01:00:00Z', updatedAt: '2026-11-10T01:00:00Z', ...extra,
})

/** 서버 대신 메모리로 답하는 수정 제안 저장소: 승인·거절·보류를 서버처럼 상태에 반영하고 호출은 vi.fn에 남긴다. */
function memorySuggestions(seed: EditSuggestion[]) {
  const rows = seed.map((s) => ({ ...s }))
  const patch = (id: string, change: Partial<EditSuggestion>): EditSuggestion => Object.assign(rows.find((r) => r.id === id)!, change)
  return {
    create: vi.fn(async (workId: string, n: number, input: { beforeText: string; afterText: string; reason?: string }) =>
      suggestion({ id: 'new', workId, episodeNumber: n, mine: true, owner: false, reason: input.reason ?? null, beforeText: input.beforeText, afterText: input.afterText })),
    mine: vi.fn(async () => rows.map((r) => ({ ...r }))),
    inbox: vi.fn(async () => rows.map((r) => ({ ...r }))),
    saveEditedText: vi.fn(async (_workId: string, id: string, editedText: string) => patch(id, { editedText })),
    approve: vi.fn(async (_workId: string, id: string) => patch(id, { status: 'approved', applyResult: 'applied', appliedVersionId: 'v-new' })),
    reject: vi.fn(async (_workId: string, id: string, reason?: string) => patch(id, { status: 'rejected', decisionReason: reason ?? null })),
    hold: vi.fn(async (_workId: string, id: string) => patch(id, { status: 'held' })),
  } satisfies EditSuggestionRepository
}
type MemorySuggestions = ReturnType<typeof memorySuggestions>

/** 정본 작품 열람 화면의 댓글은 이 파일의 관심사가 아니라 빈 목록을 주는 대역으로 둔다. */
const noComments = () => ({
  list: vi.fn(async () => []), listByWork: vi.fn(async () => []), create: vi.fn(async () => { throw new Error('unused') }), update: vi.fn(async () => { throw new Error('unused') }),
  remove: vi.fn(async () => {}), like: vi.fn(async () => {}), unlike: vi.fn(async () => {}),
}) satisfies EpisodeCommentRepository

const originalSuggestions = appContainer.resolve('editSuggestionUseCase')
const originalComments = appContainer.resolve('episodeCommentUseCase')
const serve = (seed: EditSuggestion[], tweak: (repo: MemorySuggestions) => void = () => {}) => {
  const repo = memorySuggestions(seed)
  tweak(repo)
  appContainer.register({ editSuggestionUseCase: asValue(new EditSuggestionUseCase(repo)) })
  return repo
}
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  appContainer.register({ editSuggestionUseCase: asValue(originalSuggestions), episodeCommentUseCase: asValue(originalComments) })
})

describe('회차 열람의 수정 제안 시트 (기능 24)', () => {
  const works = appContainer.resolve('mockDb').works
  beforeEach(() => { for (const work of works) work.canonical = true })
  afterEach(() => { for (const work of works) delete work.canonical })

  const openSheet = async (tweak: (repo: MemorySuggestions) => void = () => {}) => {
    const repo = serve([], tweak)
    appContainer.register({ episodeCommentUseCase: asValue(new EpisodeCommentUseCase(noComments())) })
    renderApp('/read/guunmong/2', user())
    await screen.findByRole('heading', { name: '돌다리 위의 팔선녀' })
    const first = document.querySelector<HTMLElement>('#text [data-s]')!
    fireEvent.click(first)
    fireEvent.click(within(screen.getByRole('dialog', { name: '문장 작업' })).getByRole('button', { name: '✎ 수정 제안' }))
    const dialog = screen.getByRole('dialog', { name: '문장 수정 제안' })
    return { repo, dialog, text: first.textContent! }
  }

  it('고른 문장을 변경 전으로 채운 시트에서 고친 문장과 사유를 보내면 서버에 등록하고 시트를 닫는다', async () => {
    const { repo, dialog, text } = await openSheet()
    expect(dialog.querySelector('.quote')!.textContent).toBe(text)
    const box = within(dialog).getByLabelText<HTMLTextAreaElement>('고친 문장')
    expect(box.value).toBe(text)
    expect(document.activeElement).toBe(box)
    fireEvent.change(box, { target: { value: ` ${text} (고침) ` } })
    fireEvent.change(within(dialog).getByLabelText('사유 (선택)'), { target: { value: ' 맞춤법 ' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '수정 제안 보내기' }))
    await waitFor(() => expect(repo.create).toHaveBeenCalledWith('guunmong', 2, { beforeText: text, afterText: `${text} (고침)`, reason: '맞춤법' }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '문장 수정 제안' })).toBeNull())
    expect(toastText()).toContain('수정 제안을 보냈어요')
    expect(toastText()).toContain('작가가 승인해야 원고에 반영되고')
  })

  it('서버가 거절하면 시트 안에서만 알리고 시트와 입력을 그대로 둔다', async () => {
    const { repo, dialog, text } = await openSheet((r) => r.create.mockRejectedValueOnce(new Error('원문에서 고칠 문장을 찾을 수 없어요.')))
    fireEvent.change(within(dialog).getByLabelText('고친 문장'), { target: { value: `${text} (고침)` } })
    fireEvent.click(within(dialog).getByRole('button', { name: '수정 제안 보내기' }))
    expect((await within(dialog).findByRole('alert')).textContent).toBe('원문에서 고칠 문장을 찾을 수 없어요.')
    expect(repo.create).toHaveBeenCalledTimes(1)
    // 시트 안 안내가 있으니 같은 말을 토스트로 또 띄우지 않는다.
    expect(toastText()).not.toContain('원문에서 고칠 문장을 찾을 수 없어요.')
    expect(within(screen.getByRole('dialog', { name: '문장 수정 제안' })).getByLabelText<HTMLTextAreaElement>('고친 문장').value).toBe(`${text} (고침)`)
    expect(within(dialog).getByRole('button', { name: '수정 제안 보내기' }).hasAttribute('disabled')).toBe(false)
  })

  it('전송 중에 시트를 닫은 뒤 실패하면 알릴 시트가 없으니 토스트로 알린다', async () => {
    let fail!: (error: Error) => void
    const { repo, dialog, text } = await openSheet((r) => r.create.mockImplementationOnce(() => new Promise<EditSuggestion>((_resolve, reject) => { fail = reject })))
    fireEvent.change(within(dialog).getByLabelText('고친 문장'), { target: { value: `${text} (고침)` } })
    fireEvent.click(within(dialog).getByRole('button', { name: '수정 제안 보내기' }))
    await waitFor(() => expect(repo.create).toHaveBeenCalledTimes(1))
    fireEvent.click(within(dialog).getByRole('button', { name: '취소' }))
    expect(screen.queryByRole('dialog', { name: '문장 수정 제안' })).toBeNull()
    await act(async () => { fail(new Error('서버가 잠시 응답하지 않아요.')) })
    await waitFor(() => expect(toastText()).toBe('서버가 잠시 응답하지 않아요.'))
  })

  it('고친 문장이 원문과 같거나 비어 있으면 보내기 버튼을 잠그고 이유를 알리며, 고치면 연다', async () => {
    const { repo, dialog, text } = await openSheet()
    const send = () => within(dialog).getByRole<HTMLButtonElement>('button', { name: '수정 제안 보내기' })
    const hint = () => within(dialog).queryByText('원래 문장과 달라야 보낼 수 있어요.')
    const box = within(dialog).getByLabelText('고친 문장')
    expect(send().disabled).toBe(true)
    // 잠긴 이유는 버튼의 설명(aria-describedby)으로 이어진다.
    expect(hint()).not.toBeNull()
    expect(document.getElementById(send().getAttribute('aria-describedby')!)).toBe(hint())
    fireEvent.change(box, { target: { value: ` ${text} ` } })
    expect(send().disabled).toBe(true)
    expect(hint()).not.toBeNull()
    fireEvent.change(box, { target: { value: '   ' } })
    expect(send().disabled).toBe(true)
    expect(hint()).not.toBeNull()
    fireEvent.change(box, { target: { value: `${text} (고침)` } })
    expect(send().disabled).toBe(false)
    expect(hint()).toBeNull()
    expect(send().getAttribute('aria-describedby')).toBeNull()
    expect(repo.create).not.toHaveBeenCalled()
  })

  it('취소하면 서버를 부르지 않고 닫는다', async () => {
    const { repo, dialog } = await openSheet()
    fireEvent.click(within(dialog).getByRole('button', { name: '취소' }))
    expect(screen.queryByRole('dialog', { name: '문장 수정 제안' })).toBeNull()
    expect(repo.create).not.toHaveBeenCalled()
  })
})

describe('데모 작품은 기존 문장 메뉴를 유지한다', () => {
  it('정본이 아닌 작품의 문장 메뉴에는 수정 제안이 없고 데모 동작만 있다', async () => {
    serve([])
    renderApp('/read/guunmong/2', user())
    await screen.findByRole('heading', { name: '돌다리 위의 팔선녀' })
    fireEvent.click(document.querySelector<HTMLElement>('#text [data-s]')!)
    expect(within(screen.getByRole('dialog', { name: '문장 작업' })).getAllByRole('button').map((b) => b.textContent)).toEqual(['💬 댓글 달기', '✉ 피드백 보내기', '⧉ 문장 공유'])
  })
})

describe('작가 피드백함의 수정 제안 (기능 24)', () => {
  const open = async (seed: EditSuggestion[], tweak: (repo: MemorySuggestions) => void = () => {}) => {
    const repo = serve(seed, tweak)
    renderApp('/inbox', user())
    await screen.findByRole('heading', { name: '독자 수정 제안' })
    return repo
  }
  const card = (name = '별빛 서약 3화 수정 제안') => screen.findByRole('article', { name })

  it('변경 전·후 비교, 범위 검사와 사유, 제안자·사유를 보여 준다', async () => {
    await open([suggestion({ reason: '맞춤법', scope: 'review', scopeReasons: ['단어가 다른 말로 바뀌어요.'] })])
    // 부제는 서버 작품 여부가 아니라 누가 보낸 제안인지를 알린다.
    screen.getByText('독자가 보낸 문장 수정 제안')
    expect(screen.queryByText('내 서버 작품의 문장 수정 제안')).toBeNull()
    const c = await card()
    expect(c.querySelector('del')!.textContent).toBe('않 된다고')
    expect(c.querySelector('ins')!.textContent).toBe('안 된다고')
    within(c).getByText('검토 대기')
    within(c).getByText('내용 변경 포함')
    within(c).getByText(/단어가 다른 말로 바뀌어요\./)
    within(c).getByText(/독자A · 사유: 맞춤법/)
    within(c).getByText(/검사는 표시만 해요/)
  })

  it('범위 검사 칩은 표기 교정 수준과 내용 변경 포함으로 보이고 카드와 카드 목록에 간격을 둔다', async () => {
    await open([
      suggestion({ id: 'a', workTitle: '가 작품', scope: 'auto' }),
      suggestion({ id: 'b', workTitle: '나 작품', scope: 'review', scopeReasons: ['단어가 다른 말로 바뀌어요.'] }),
    ])
    const a = await card('가 작품 3화 수정 제안')
    const b = await card('나 작품 3화 수정 제안')
    within(a).getByText('표기 교정 수준')
    within(b).getByText('내용 변경 포함')
    expect(within(a).queryByText('내용 변경 포함')).toBeNull()
    for (const c of [a, b]) {
      expect([c.style.display, c.style.gap]).toEqual(['grid', '12px'])
      within(c).getByText(/검사는 표시만 해요/)
    }
    expect(a.parentElement).toBe(b.parentElement)
    expect([a.parentElement!.style.display, a.parentElement!.style.gap]).toEqual(['grid', '12px'])
  })

  it('저장하지 않은 편집안이 있으면 승인을 잠그고 먼저 저장하라고 안내하며 저장하면 다시 연다', async () => {
    const repo = await open([suggestion()])
    const c = await card()
    const approve = () => within(c).getByRole<HTMLButtonElement>('button', { name: '승인하고 초안에 반영' })
    expect(approve().disabled).toBe(false)
    expect(within(c).queryByText(/편집안을 먼저 저장해 주세요/)).toBeNull()
    // 앞뒤 공백만 다른 입력은 저장될 내용이 같아 잠그지 않는다.
    fireEvent.change(within(c).getByLabelText('편집안'), { target: { value: ' 안 된다고 ' } })
    expect(approve().disabled).toBe(false)
    fireEvent.change(within(c).getByLabelText('편집안'), { target: { value: '안 된다고요' } })
    expect(approve().disabled).toBe(true)
    within(c).getByText(/편집안을 먼저 저장해 주세요/)
    expect(approve().getAttribute('aria-describedby')).not.toBeNull()
    fireEvent.click(approve())
    expect(repo.approve).not.toHaveBeenCalled()
    fireEvent.click(within(c).getByRole('button', { name: '편집안 저장' }))
    await waitFor(() => expect(approve().disabled).toBe(false))
    expect(within(c).queryByText(/편집안을 먼저 저장해 주세요/)).toBeNull()
    fireEvent.click(approve())
    await waitFor(() => expect(repo.approve).toHaveBeenCalledWith('w1', 's1'))
  })

  it('편집안을 저장하면 원래 제안은 보존한 채 비교가 편집안으로 바뀐다', async () => {
    const repo = await open([suggestion()])
    const c = await card()
    expect(within(c).getByLabelText<HTMLTextAreaElement>('편집안').value).toBe('안 된다고')
    fireEvent.change(within(c).getByLabelText('편집안'), { target: { value: ' 안 된다고요 ' } })
    fireEvent.click(within(c).getByRole('button', { name: '편집안 저장' }))
    await waitFor(() => expect(repo.saveEditedText).toHaveBeenCalledWith('w1', 's1', '안 된다고요'))
    await waitFor(() => expect(screen.getByRole('article', { name: '별빛 서약 3화 수정 제안' }).querySelector('ins')!.textContent).toBe('안 된다고요'))
    within(await card()).getByText('제안자가 처음 올린 수정: 안 된다고')
    expect(within(await card()).getByRole('status').textContent).toContain('편집안을 저장했어요')
    // 카드 안 안내가 있으니 같은 말을 토스트로 또 띄우지 않는다.
    expect(toastText()).not.toContain('편집안을 저장했어요')
  })

  it('승인하면 초안에 반영됨을 알리고 발행은 집필실에서 하도록 안내한다', async () => {
    const repo = await open([suggestion()])
    fireEvent.click(within(await card()).getByRole('button', { name: '승인하고 초안에 반영' }))
    await waitFor(() => expect(repo.approve).toHaveBeenCalledWith('w1', 's1'))
    const c = await card()
    await within(c).findByText('초안에 반영됨 — 발행은 집필실에서')
    within(c).getByText('승인됨 · 초안에 반영됨')
    expect(within(c).getByRole('status').textContent).toBe('승인했고 초안에 반영했어요 — 발행은 집필실에서 해 주세요.')
    expect(within(c).getByRole('link', { name: '집필실 열기' }).getAttribute('href')).toBe('/studio/w1')
    expect(within(c).queryByRole('button', { name: '승인하고 초안에 반영' })).toBeNull()
    expect(toastText()).not.toContain('초안에 반영했어요')
    expect(repo.inbox.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('반영 실패는 사유와 함께 승인됨·반영 실패로 보이고 반영 완료로 안내하지 않으며 다시 시도할 수 있다', async () => {
    const repo = await open([suggestion({ status: 'approved', applyResult: 'failed', applyFailure: '초안에서 고칠 문장을 찾을 수 없어요. 집필실에서 직접 고쳐 주세요.' })])
    const c = await card()
    within(c).getByText('승인됨 · 반영 실패')
    expect(within(c).getByText(/반영 실패: 초안에서 고칠 문장을 찾을 수 없어요/).classList.contains('note')).toBe(true)
    expect(within(c).queryByText(/초안에 반영됨 — 발행은 집필실에서/)).toBeNull()
    expect(within(c).getByRole('link', { name: '집필실에서 직접 고치기' }).getAttribute('href')).toBe('/studio/w1')
    expect(within(c).queryByRole('button', { name: '거절' })).toBeNull()
    fireEvent.click(within(c).getByRole('button', { name: '다시 반영 시도' }))
    await waitFor(() => expect(repo.approve).toHaveBeenCalledWith('w1', 's1'))
    await within(await card()).findByText('초안에 반영됨 — 발행은 집필실에서')
  })

  it('기준 발행본이 바뀌어 승인이 409로 거절되면 서버 안내를 보이고 목록을 다시 읽는다', async () => {
    const repo = await open([suggestion()], (r) => r.approve.mockRejectedValueOnce(new Error('원문이 다시 발행돼 그대로 반영할 수 없어요. 집필실에서 직접 고치거나 거절해 주세요.')))
    fireEvent.click(within(await card()).getByRole('button', { name: '승인하고 초안에 반영' }))
    const alert = await within(await card()).findByRole('alert')
    expect(alert.textContent).toBe('원문이 다시 발행돼 그대로 반영할 수 없어요. 집필실에서 직접 고치거나 거절해 주세요.')
    await waitFor(() => expect(repo.inbox.mock.calls.length).toBeGreaterThanOrEqual(2))
    const c = await card()
    within(c).getByText('검토 대기')
    expect(within(c).getByRole('button', { name: '승인하고 초안에 반영' }).hasAttribute('disabled')).toBe(false)
    // 다음 행동: 바뀐 발행본은 집필실에서 확인한다.
    expect(within(c).getByRole('link', { name: '집필실 열기' }).getAttribute('href')).toBe('/studio/w1')
  })

  it('기준 변경이 아닌 처리 실패에는 집필실 링크를 붙이지 않는다', async () => {
    await open([suggestion()], (r) => r.approve.mockRejectedValueOnce(new Error('서버가 잠시 응답하지 않아요.')))
    fireEvent.click(within(await card()).getByRole('button', { name: '승인하고 초안에 반영' }))
    const c = await card()
    await within(c).findByRole('alert')
    expect(within(c).queryByRole('link', { name: '집필실 열기' })).toBeNull()
  })

  it('거절을 눌러야 사유 입력과 확인 버튼이 나타나고, 선택 사유와 함께 종결하며 사유를 보인다', async () => {
    const repo = await open([suggestion()])
    const c = await card()
    // 평소에는 사유 칸도 확인 버튼도 없다.
    expect(within(c).queryByLabelText('거절 사유 (선택)')).toBeNull()
    expect(within(c).queryByRole('button', { name: '거절 확인' })).toBeNull()
    const toggle = within(c).getByRole('button', { name: '거절' })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    const reason = within(c).getByLabelText<HTMLInputElement>('거절 사유 (선택)')
    expect(document.activeElement).toBe(reason)
    expect(repo.reject).not.toHaveBeenCalled()
    // 거절을 다시 누르면 접힌다.
    fireEvent.click(toggle)
    expect(within(c).queryByLabelText('거절 사유 (선택)')).toBeNull()
    fireEvent.click(toggle)
    fireEvent.change(within(c).getByLabelText('거절 사유 (선택)'), { target: { value: ' 톤이 달라요 ' } })
    fireEvent.click(within(c).getByRole('button', { name: '거절 확인' }))
    await waitFor(() => expect(repo.reject).toHaveBeenCalledWith('w1', 's1', '톤이 달라요'))
    const after = await card()
    await within(after).findByText('거절 사유: 톤이 달라요')
    within(after).getByText('거절됨')
    expect(within(after).queryByRole('button', { name: '승인하고 초안에 반영' })).toBeNull()
  })

  it('거절이 실패하면 사유 입력을 닫지 않고 그대로 둔다', async () => {
    await open([suggestion()], (r) => r.reject.mockRejectedValueOnce(new Error('이미 처리했거나 지금은 할 수 없는 상태예요. 목록을 새로 불러와 주세요.')))
    const c = await card()
    fireEvent.click(within(c).getByRole('button', { name: '거절' }))
    fireEvent.change(within(c).getByLabelText('거절 사유 (선택)'), { target: { value: '톤이 달라요' } })
    fireEvent.click(within(c).getByRole('button', { name: '거절 확인' }))
    const alert = await within(await card()).findByRole('alert')
    expect(alert.textContent).toBe('이미 처리했거나 지금은 할 수 없는 상태예요. 목록을 새로 불러와 주세요.')
    expect(within(await card()).getByLabelText<HTMLInputElement>('거절 사유 (선택)').value).toBe('톤이 달라요')
  })

  it('보류하면 보류 상태로 바뀌어 다시 보류할 수는 없지만 거절·승인은 할 수 있다', async () => {
    const repo = await open([suggestion()])
    fireEvent.click(within(await card()).getByRole('button', { name: '보류' }))
    await waitFor(() => expect(repo.hold).toHaveBeenCalledWith('w1', 's1'))
    const c = await card()
    await within(c).findByText('보류')
    await waitFor(() => expect(within(c).queryByRole('button', { name: '보류' })).toBeNull())
    within(c).getByRole('button', { name: '거절' })
    within(c).getByRole('button', { name: '승인하고 초안에 반영' })
  })

  it('목록을 못 읽으면 오류와 다시 불러오기를 보이고 빈 목록으로 숨기지 않는다', async () => {
    const repo = serve([suggestion()], (r) => r.inbox.mockRejectedValueOnce(new Error('offline')))
    renderApp('/inbox', user())
    const alert = await screen.findByText(/수정 제안을 불러오지 못했어요/)
    expect(alert.closest('[role=alert]')).not.toBeNull()
    expect(screen.queryByText('받은 수정 제안이 없어요.')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '수정 제안 다시 불러오기' }))
    await screen.findByRole('article', { name: '별빛 서약 3화 수정 제안' })
    expect(repo.inbox).toHaveBeenCalledTimes(2)
  })

  it('제안이 없으면 없다고 알린다', async () => {
    await open([])
    await screen.findByText('받은 수정 제안이 없어요.')
  })

  it('서버가 없는 목업 빌드는 서버 수정 제안을 부르지 않고 데모 피드백함만 보인다', async () => {
    vi.stubEnv('MODE', 'mockup')
    const repo = serve([suggestion()])
    renderApp('/inbox', user())
    await screen.findByRole('heading', { name: /독자 피드백함/ })
    expect(screen.queryByRole('heading', { name: '독자 수정 제안' })).toBeNull()
    expect(repo.inbox).not.toHaveBeenCalled()
  })
})

describe('내 서재의 내 수정 제안 (기능 24)', () => {
  const open = async (seed: EditSuggestion[], tweak: (repo: MemorySuggestions) => void = () => {}) => {
    const repo = serve(seed, tweak)
    renderApp('/content?view=reports', user())
    await screen.findByRole('heading', { name: '내 수정 제안' })
    return repo
  }

  it('내 제안을 상태 읽기 전용으로 보여 주고 승인·반영 결과를 발행과 구분해 알린다', async () => {
    await open([
      suggestion({ id: 'a', mine: true, owner: false, status: 'approved', applyResult: 'applied', editedText: '안 된다고요' }),
      suggestion({ id: 'b', mine: true, owner: false, status: 'rejected', decisionReason: '톤이 달라요', reason: '맞춤법' }),
      suggestion({ id: 'c', mine: true, owner: false, status: 'approved', applyResult: 'failed', applyFailure: '내부 사유' }),
      suggestion({ id: 'd', mine: true, owner: false, status: 'held' }),
    ])
    const list = await waitFor(() => { const el = document.getElementById('mysuggestions'); expect(el).not.toBeNull(); return el! })
    const rows = [...list.querySelectorAll('.rp')]
    expect(rows).toHaveLength(4)
    within(rows[0] as HTMLElement).getByText('승인됨 · 초안에 반영됨')
    within(rows[0] as HTMLElement).getByText('작가가 승인해 초안에 반영했어요. 독자에게는 작가가 발행해야 보여요.')
    within(rows[0] as HTMLElement).getByText('작가가 고친 문장: 안 된다고요')
    expect(within(rows[1] as HTMLElement).queryByText(/작가가 고친 문장/)).toBeNull()
    within(rows[1] as HTMLElement).getByText('거절됨')
    within(rows[1] as HTMLElement).getByText('작가가 거절했어요 · 톤이 달라요')
    within(rows[1] as HTMLElement).getByText('사유: 맞춤법')
    within(rows[2] as HTMLElement).getByText('승인됨 · 반영 실패')
    within(rows[2] as HTMLElement).getByText('작가가 승인했지만 아직 초안에 반영되지 않았어요. 작가가 직접 고칠 수 있어요.')
    expect(list.textContent).not.toContain('내부 사유')
    within(rows[3] as HTMLElement).getByText('보류')
    expect(list.querySelectorAll('button')).toHaveLength(0)
  })

  it('제안이 없으면 안내를 보이고 목록을 못 읽으면 오류와 다시 불러오기를 보인다', async () => {
    await open([])
    await screen.findByText(/'수정 제안'을 보내면 여기에 모여요/)
    cleanup()
    const repo = serve([suggestion({ mine: true, owner: false })], (r) => r.mine.mockRejectedValueOnce(new Error('offline')))
    renderApp('/content?view=reports', user())
    await screen.findByText(/수정 제안을 불러오지 못했어요/)
    expect(screen.queryByText(/'수정 제안'을 보내면 여기에 모여요/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '수정 제안 다시 불러오기' }))
    await waitFor(() => expect(document.getElementById('mysuggestions')).not.toBeNull())
    expect(repo.mine).toHaveBeenCalledTimes(2)
  })

  it('서버가 없는 목업 빌드는 서버 수정 제안을 부르지 않는다', async () => {
    vi.stubEnv('MODE', 'mockup')
    const repo = serve([suggestion({ mine: true, owner: false })])
    renderApp('/content?view=reports', user())
    await screen.findByText('작가가 처리하면 상태가 바뀌어요.')
    expect(screen.queryByRole('heading', { name: '내 수정 제안' })).toBeNull()
    expect(repo.mine).not.toHaveBeenCalled()
  })
})
