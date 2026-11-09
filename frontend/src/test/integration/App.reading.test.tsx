// @vitest-environment jsdom
import '../fixtureApp'

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { asValue } from 'awilix/browser'
import { Provider } from 'react-redux'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { appContainer } from '../../app/appContainer'
import { createAppStore } from '../../app/store'
import type { CommentSort, EpisodeComment } from '../../domain/entities/episodeComment'
import type { Sentence } from '../../domain/entities/feedback'
import { WCATS, type Doc } from '../../domain/entities/wiki'
import type { EpisodeCommentRepository } from '../../domain/repositories/EpisodeCommentRepository'
import { EpisodeCommentUseCase } from '../../domain/usecases/EpisodeCommentUseCase'
import { ReadingUseCase } from '../../domain/usecases/ReadingUseCase'
import { EpisodeComments } from '../../presentation/features/reading/view/EpisodeComments'
import { sessionActions } from '../../presentation/shared/session/sessionSlice'
import { renderApp } from '../renderApp'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const user = () => createAppStore({ role: 'user' })
const sid = () => document.getElementById('sid')!.textContent
const sentence = async (t: string) => (await screen.findAllByText(t)).find((el) => el.classList.contains('s'))!
/** 비회원 시나리오: 세션 복원이 401로 끝나 비로그인 상태가 유지된다. [canLogin]이면 로그인 요청만 성공한다. */
function guestSession(canLogin = false) {
  vi.stubGlobal('navigator', { locks: { request: (_name: string, _options: object, callback: (lock: object) => Promise<unknown>) => callback({}) } })
  vi.stubGlobal('fetch', vi.fn(async (path: string) => path.endsWith('/csrf') ? Response.json({ csrfToken: 'csrf' })
    : canLogin && path.endsWith('/login') ? Response.json({ accessToken: 'token', user: { id: 'reader', email: 'reader@example.invalid', nickname: '독자', operator: false } })
      : new Response(null, { status: 401 })))
}

describe('소설 상세 (U04)', () => {
  it('없는 작품은 목업 unavailableWork 화면을 보여 준다', async () => {
    renderApp('/work/nope')
    await screen.findByRole('heading', { name: '소설을 찾을 수 없거나 볼 수 없어요.' })
    screen.getByRole('link', { name: '홈으로' })
  })

  it('회원의 상세는 독서 기록으로 읽은 회차를 표시하고 처음부터 버튼을 보이며 비회원에는 표시하지 않는다', async () => {
    renderApp('/work/guunmong', user())
    await screen.findByRole('heading', { name: '구운몽' })
    const read = () => [...document.querySelectorAll('#eplist .ep.read .no')].map((el) => el.textContent)
    await waitFor(() => expect(read()).toEqual(['1', '2']))
    screen.getByRole('link', { name: '처음부터' })
    cleanup()
    renderApp('/work/guunmong')
    await screen.findByRole('heading', { name: '구운몽' })
    expect(read()).toEqual([])
    expect(screen.queryByRole('link', { name: '처음부터' })).toBeNull()
  })

  it('회차 검색·결과 없음·정렬·좋아요·포크 허용 회차를 보여 준다', async () => {
    renderApp('/work/guunmong')
    await screen.findByRole('heading', { name: '구운몽' })
    await waitFor(() => expect(sid()).toBe('U04 소설 상세'))
    screen.getByText('전체 4화')
    expect(screen.getByText('2·3·4화').closest('p')!.textContent).toContain('운영팀이 2·3·4화에서 포크를 허용했어요.')
    const list = () => [...document.querySelectorAll<HTMLElement>('#eplist .ep')].filter((el) => el.style.display !== 'none').map((el) => el.querySelector('.no')!.textContent)
    fireEvent.change(screen.getByLabelText('회차 검색'), { target: { value: '팔선녀' } })
    expect(list()).toEqual(['2'])
    fireEvent.change(screen.getByLabelText('회차 검색'), { target: { value: '없는말' } })
    screen.getByText('검색 결과가 없어요.')
    fireEvent.change(screen.getByLabelText('회차 검색'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: '최신순' }))
    expect(list()).toEqual(['4', '3', '2', '1'])
    fireEvent.click(screen.getByRole('button', { name: '관심 소설' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '관심 소설' }).getAttribute('aria-pressed')).toBe('true'))
    expect(screen.getByRole('status').textContent).toBe('이 창에서만 좋아요를 눌렀어요 · 계정에 저장되지 않아요')
    expect(document.getElementById('lkc')!.textContent).toBe('1.2만')
    fireEvent.click(screen.getByRole('button', { name: '공유' }))
    expect(screen.getByRole('status').textContent).toBe('링크 공유는 데모예요 (실제 복사 없음)')
    screen.getByText('이 원작의 포크 소설')
  })

  it('소설 신고는 소설 단위 시트로 열리고 Esc로 닫으면 포커스가 신고 버튼으로 돌아온다', async () => {
    renderApp('/work/guunmong')
    const open = await screen.findByRole('button', { name: '구운몽 소설 신고' })
    open.focus()
    fireEvent.click(open)
    const dialog = screen.getByRole('dialog', { name: '소설 신고' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(sid()).toBe('U06 댓글·피드백·신고')
    within(dialog).getByText('문장별 신고가 아니라 소설 전체에 대한 신고예요.')
    expect(within(dialog).getAllByRole('option').map((o) => o.textContent)).toEqual(['권리 침해', '유해 콘텐츠'])
    expect(document.activeElement).toBe(within(dialog).getByLabelText('신고 내용'))
    within(dialog).getByRole('button', { name: '신고하기' }).focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: '닫기' }))
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: '신고하기' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(open)
    expect(sid()).toBe('U04 소설 상세')
  })

  it('신고 내용을 적어 접수하면 운영 검토 목록에 회차 없이 남는다', async () => {
    renderApp('/work/guunmong')
    fireEvent.click(await screen.findByRole('button', { name: '구운몽 소설 신고' }))
    const dialog = screen.getByRole('dialog', { name: '소설 신고' })
    fireEvent.click(within(dialog).getByRole('button', { name: '신고하기' }))
    expect(screen.getByRole('status').textContent).toBe('신고 내용을 입력해 주세요')
    fireEvent.change(within(dialog).getByLabelText('신고 내용'), { target: { value: '권리 확인 부탁' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '신고하기' }))
    await within(dialog).findByText(/신고를 운영팀에 접수했어요/)
    expect(appContainer.resolve('mockDb').reviewQueue[0]).toMatchObject({ w: 'guunmong', n: null, type: '권리 침해' })
    fireEvent.click(within(dialog).getByRole('button', { name: '확인' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('내 소설 상세에는 신고 버튼이 없다 (#196)', async () => {
    renderApp('/work/starlight')
    await screen.findByRole('heading', { name: '별빛 서약의 탑' })
    expect(screen.queryByRole('button', { name: /소설 신고/ })).toBeNull()
  })

  it('서버(정본) 작품 상세도 남의 공개 작품이면 신고 버튼이 보이고 운영 신고 폼이 열린다 (#196)', async () => {
    const works = appContainer.resolve('mockDb').works
    for (const work of works) work.canonical = true
    try {
      renderApp('/work/guunmong')
      fireEvent.click(await screen.findByRole('button', { name: '구운몽 소설 신고' }))
      const dialog = screen.getByRole('dialog', { name: '소설 신고' })
      within(dialog).getByLabelText('신고 사유')
      within(dialog).getByRole('button', { name: '신고 접수' })
    } finally {
      cleanup()
      for (const work of works) delete work.canonical
    }
  })
})

describe('회차 뷰어 (U05·U07·U08)', () => {
  it('비회원도 로그인 없이 공개 회차를 읽는다 (UC-01)', async () => {
    guestSession()
    const { store } = renderApp('/read/guunmong/2')
    await screen.findByRole('heading', { name: '돌다리 위의 팔선녀' })
    expect(screen.queryByText('소설을 읽으려면 로그인해 주세요.')).toBeNull()
    expect(store.getState().session).toMatchObject({ role: null, next: null })
    screen.getByRole('link', { name: '‹ 이전 화' })
    fireEvent.click(screen.getByRole('link', { name: '다음 화 ›' }))
    await screen.findByRole('heading', { name: '인간 세상으로' })
    expect(store.getState().session.role).toBeNull()
  })

  it('비회원의 열람은 서버 조회 기록을 보내지 않고, 회원의 열람만 보낸다', async () => {
    const works = appContainer.resolve('mockDb').works
    for (const work of works) work.canonical = true
    try {
      guestSession()
      renderApp('/read/guunmong/2')
      await screen.findByRole('heading', { name: '돌다리 위의 팔선녀' })
      const record = appContainer.resolve('workSearchRepository').recordView
      expect(record).not.toHaveBeenCalled()
      cleanup()
      // 회원 시나리오는 세션 복원 401 대역을 걷어 내야 한다(401이면 복원이 로그아웃시킨다).
      vi.unstubAllGlobals()
      renderApp('/read/guunmong/2', user())
      await screen.findByRole('heading', { name: '돌다리 위의 팔선녀' })
      expect(record).toHaveBeenCalledWith('guunmong', 2)
    } finally {
      cleanup()
      for (const work of works) delete work.canonical
    }
  })

  it('비회원이 포크하려 하면 읽기는 그대로 두고 포크 화면에서만 로그인 안내를 받는다', async () => {
    guestSession()
    const { store } = renderApp('/read/guunmong/2')
    fireEvent.click(await screen.findByRole('link', { name: '✎ 2화에서 포크하기' }))
    await screen.findByText('로그인이 필요한 화면이에요.')
    expect(store.getState().session).toMatchObject({ role: null, next: '/writing-policy?method=fork' })
  })

  it('작가의 말은 본문 뒤에 있고 감정 반응 없이 댓글 좋아요만 있다', async () => {
    appContainer.resolve('mockDb').works.find((w) => w.id === 'guunmong')!.eps[0].authorNote = '첫 화를 열어 주셔서 고마워요.'
    renderApp('/read/guunmong/1', user())
    await screen.findByRole('heading', { name: '연화봉의 젊은 승려' })
    // jsdom은 레이아웃이 없어 회차 끝 표시가 늘 화면 안에 있으므로 U08로 바뀐다. 라벨은 effect 뒤에 갱신되므로 기다린다.
    await waitFor(() => expect(sid()).toBe('U08 회차 끝 · 포크·댓글'))
    const note = screen.getByRole('heading', { name: '작가의 말' }).closest('section')!
    expect(document.getElementById('text')!.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    screen.getByText('第 一 回')
    expect(document.querySelector('.reader')!.className).toBe('th-hanji themed lite reader')
    expect(document.querySelector('.amb.lite')).toBeTruthy()
    expect(document.querySelector('[data-act="react"]')).toBeNull()
    expect(screen.queryByRole('button', { name: /공감|감동|슬퍼요/ })).toBeNull()
    const like = screen.getByRole('button', { name: '♡ 412' })
    fireEvent.click(like)
    await screen.findByRole('button', { name: '♥ 413' })
    expect(screen.getByRole('link', { name: '‹ 이전 화' }).getAttribute('aria-disabled')).toBe('true')
    expect(screen.getByRole('link', { name: '‹ 이전 화' }).hasAttribute('href')).toBe(false)
    fireEvent.click(screen.getByRole('link', { name: '다음 화 ›' }))
    await screen.findByRole('heading', { name: '돌다리 위의 팔선녀' })
    screen.getByText('여기서 포크해 볼까요?')
  })

  it('문장을 골라 댓글을 남기면 인용과 함께 목록에 붙는다', async () => {
    renderApp('/read/postman/1', user())
    fireEvent.click(await sentence('“이건 어디로 가야 하지.”'))
    expect(document.querySelector('.s.sel')!.textContent).toBe('“이건 어디로 가야 하지.”')
    fireEvent.click(screen.getByRole('button', { name: '💬 댓글 달기' }))
    const dialog = screen.getByRole('dialog', { name: '문장에 댓글 달기' })
    within(dialog).getByText('댓글만 등록되며 자동 답변은 제공하지 않아요.')
    fireEvent.change(within(dialog).getByLabelText('댓글'), { target: { value: '첫 문장부터 궁금해요' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '등록' }))
    await screen.findByText('첫 문장부터 궁금해요')
    expect(screen.queryByRole('dialog')).toBeNull()
    screen.getByRole('heading', { name: '댓글 3' })
    expect(document.querySelector('.cm:last-of-type .cq')!.textContent).toBe('“이건 어디로 가야 하지.”')
    fireEvent.change(screen.getByPlaceholderText('감상이나 궁금한 점을 남겨 주세요'), { target: { value: '아래 댓글' } })
    fireEvent.click(screen.getByRole('button', { name: '등록' }))
    await screen.findByRole('heading', { name: '댓글 4' })
  })

  it('피드백은 4가지 유형과 무료 안내를 보여 주고 질문은 응답 완료로 접수한다', async () => {
    renderApp('/read/postman/1', user())
    fireEvent.click(await sentence('“이건 어디로 가야 하지.”'))
    fireEvent.click(screen.getByRole('button', { name: '✉ 피드백 보내기' }))
    const dialog = screen.getByRole('dialog', { name: '피드백 보내기' })
    expect(within(dialog).getAllByRole('option').map((o) => o.textContent)).toEqual(['단순 오류', '스토리 오류', '질문', '제안'])
    within(dialog).getByText(/댓글·단순 오류·스토리 오류·질문·제안은 무료로 등록돼요/)
    fireEvent.change(within(dialog).getByLabelText('피드백 유형'), { target: { value: '스토리 오류' } })
    within(dialog).getByLabelText('스토리 오류 검증 시뮬레이션에 동의')
    fireEvent.change(within(dialog).getByLabelText('피드백 유형'), { target: { value: '질문' } })
    fireEvent.change(within(dialog).getByLabelText('내용'), { target: { value: '누가 보낸 편지인가요?' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '피드백 보내기' }))
    await within(dialog).findByText('응답 완료')
    expect(appContainer.resolve('mockDb').reports[0]).toMatchObject({ w: 'postman', n: 1, type: '질문', status: '응답 완료' })
  })

  it('보기 설정은 화면 사이에 유지된다', async () => {
    const { store } = renderApp('/read/guunmong/1', user())
    fireEvent.click(await screen.findByRole('button', { name: '보기 설정' }))
    const dialog = screen.getByRole('dialog', { name: '보기 설정' })
    expect(sid()).toBe('U07 보기 설정 (Aa)')
    fireEvent.click(within(dialog).getByRole('button', { name: '야간' }))
    fireEvent.click(within(dialog).getByRole('button', { name: '가 +' }))
    fireEvent.click(within(dialog).getByRole('button', { name: '끄기' }))
    expect(store.getState().ui).toMatchObject({ look: 'night', fs: 20, motion: false })
    expect(document.querySelector('.reader')!.className).toBe('calm rd calm-hanji reader')
    fireEvent.click(dialog.parentElement!)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('읽은 회차가 홈 이어 읽기에 반영된다', async () => {
    renderApp('/read/starlight/3', user())
    await screen.findByRole('heading', { name: '재의 사절' })
    cleanup()
    renderApp('/', user())
    await screen.findByRole('link', { name: /별빛 서약의 탑 · 3화 재의 사절/ })
  })
})

describe('비회원의 회원 전용 동작 (기능 20)', () => {
  // 데모(메모리) 작품의 댓글·좋아요·피드백은 회원 전용이다. 비회원은 포크와 같이 로그인 안내로 가고 메모리에는 아무것도 남지 않는다.
  const memory = () => appContainer.resolve('mockDb')
  const snapshot = () => JSON.stringify([memory().comments, memory().cmLiked, memory().reports])
  const prompt = async (store: ReturnType<typeof createAppStore>, message: string) => {
    await screen.findByText(message)
    expect(store.getState().session).toMatchObject({ role: null, next: '/read/postman/1', loginMsg: message })
    expect(screen.queryByRole('dialog')).toBeNull()
  }

  it('문장 팝업의 댓글·피드백은 로그인 안내로 보내고 시트도 저장도 만들지 않는다', async () => {
    guestSession()
    const before = snapshot()
    const first = renderApp('/read/postman/1')
    fireEvent.click(await sentence('“이건 어디로 가야 하지.”'))
    fireEvent.click(screen.getByRole('button', { name: '💬 댓글 달기' }))
    await prompt(first.store, '댓글은 로그인한 회원만 남길 수 있어요.')
    cleanup()
    const second = renderApp('/read/postman/1')
    fireEvent.click(await sentence('“이건 어디로 가야 하지.”'))
    fireEvent.click(screen.getByRole('button', { name: '✉ 피드백 보내기' }))
    await prompt(second.store, '피드백은 로그인한 회원만 보낼 수 있어요.')
    expect(snapshot()).toBe(before)
  })

  it('댓글 입력과 댓글 좋아요도 로그인 안내로 보내고 저장하지 않는다', async () => {
    guestSession()
    const before = snapshot()
    const first = renderApp('/read/postman/1')
    fireEvent.change(await screen.findByLabelText('댓글 입력'), { target: { value: '비회원 댓글' } })
    fireEvent.click(screen.getByRole('button', { name: '등록' }))
    await prompt(first.store, '댓글은 로그인한 회원만 남길 수 있어요.')
    cleanup()
    const second = renderApp('/read/postman/1')
    fireEvent.click((await screen.findAllByRole('button', { name: /^[♡♥] \d+$/ }))[0])
    await prompt(second.store, '댓글 좋아요는 로그인한 회원만 누를 수 있어요.')
    expect(snapshot()).toBe(before)
  })

  it('로그인하면 원래 회차로 돌아온다', async () => {
    guestSession(true)
    const { store } = renderApp('/read/postman/1')
    fireEvent.click(await sentence('“이건 어디로 가야 하지.”'))
    fireEvent.click(screen.getByRole('button', { name: '💬 댓글 달기' }))
    await screen.findByText('댓글은 로그인한 회원만 남길 수 있어요.')
    fireEvent.change(screen.getByLabelText('이메일'), { target: { value: 'reader@example.invalid' } })
    fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: 'test-password' } })
    fireEvent.click(screen.getByRole('button', { name: '로그인' }))
    await screen.findByRole('heading', { name: '수취인 불명' })
    expect(store.getState().session.role).toBe('user')
  })
})

describe('정본 열람의 미지원 기능 표시 (CI integration)', () => {
  it('does not present canonical placeholders as rankings or editable sentence actions', async () => {
    const works = appContainer.resolve('mockDb').works
    const searchedUseCase = appContainer.resolve('readingUseCase')
    const commentUseCase = appContainer.resolve('episodeCommentUseCase')
    appContainer.register({ episodeCommentUseCase: asValue(new EpisodeCommentUseCase(memoryComments([]))) })
    for (const work of works) { work.canonical = true; work.statisticsSupported = false }
    try {
      renderApp('/work/guunmong')
      await screen.findByRole('heading', { name: '구운몽' })
      expect(document.querySelector('.ifs .md')).toBeNull()
      // 좋아요 수는 서버 값이라 보이지만, 서버에 없는 조회·댓글 지표는 자리표시로 그리지 않는다.
      expect(document.getElementById('lkc')).not.toBeNull()
      expect(document.querySelector('.stats')!.textContent).not.toMatch(/👁|💬/)
      cleanup()
      renderApp('/read/guunmong/2', user())
      await screen.findByRole('heading', { name: '돌다리 위의 팔선녀' })
      // 댓글은 서버에 연결돼 있지만(기능 22) 피드백·문장 공유는 데모뿐이라 정본 문장에는 댓글 달기만 연다.
      fireEvent.click(document.querySelector<HTMLElement>('#text [data-s]')!)
      expect(within(screen.getByRole('dialog', { name: '문장 작업' })).getAllByRole('button').map((b) => b.textContent)).toEqual(['💬 댓글 달기'])
      cleanup()
      // 서버 순위가 없는 목록(지표 없는 정본 작품)은 순위·메달로 보이지 않는다(서버 랭킹이 있는 홈은 App.home이 다룬다).
      const { workRepository, readingRepository, readingRecordRepository } = appContainer.cradle
      appContainer.register({ readingUseCase: asValue(new ReadingUseCase(workRepository, readingRepository, readingRecordRepository)) })
      renderApp('/')
      await screen.findByRole('heading', { name: '공개 소설' })
      expect(document.querySelector('#home .md, #home .rk .top')).toBeNull()
    } finally {
      cleanup()
      appContainer.register({ readingUseCase: asValue(searchedUseCase), episodeCommentUseCase: asValue(commentUseCase) })
      for (const work of works) { delete work.canonical; delete work.statisticsSupported }
    }
  })
})

/** 서버가 기준 회차까지 공개한 설정만 준다는 계약을 메모리 저장소로 흉내 낸다. 각 항목은 [공개되는 첫 회차, 문서]다. */
const doc = (id: string, cat: string, t: string, extra: Partial<Doc> = {}): Doc => ({ id, cat, t, alias: [], tags: [], props: {}, at: {}, body: '', ...extra })
const scoped: [number, Doc][] = [
  [1, doc('seongjin', 'char', '성진', { body: '연화봉의 젊은 승려', props: { 나이: '20' } })],
  [1, doc('lotus', 'place', '연화봉', { body: '육관대사의 도량이 있는 봉우리' })],
  [2, doc('bridge', 'place', '돌다리', { body: '성진이 팔선녀를 만난 좁은 다리' })],
  [3, doc('banish', 'event', '스승의 벌', { ep: 3, line: 'm', who: ['성진'] })],
]

/** 시드 작품을 정본(서버) 작품처럼 보이게 하고 readWorld가 기준 회차까지 공개된 문서만 돌려주게 한다. 되돌리는 함수를 돌려준다. */
function servePublicWiki(docs: [number, Doc][] = scoped) {
  const works = appContainer.resolve('mockDb').works
  const repo = appContainer.resolve('workRepository')
  const original = repo.readWorld
  for (const work of works) work.canonical = true
  repo.readWorld = async (work, episode) => ({ ...work, wiki: { docs: docs.filter(([from]) => from <= episode).map(([, d]) => d), cats: structuredClone(WCATS) } })
  return () => { repo.readWorld = original; for (const work of works) delete work.canonical }
}

describe('공개 설정 읽기 패널 (기능 20)', () => {
  let restore = () => {}
  afterEach(() => { restore(); restore = () => {} })

  it('작품 상세의 설정 위키 링크로 최신 공개 회차 기준의 공개 설정 페이지를 비회원에게도 읽기 전용으로 보여 준다', async () => {
    restore = servePublicWiki()
    guestSession()
    renderApp('/work/guunmong')
    fireEvent.click(await screen.findByRole('link', { name: '설정 위키' }))
    const panel = await screen.findByRole('article', { name: '구운몽/설정 위키' })
    expect(sid()).toBe('U45 설정 위키')
    screen.getByRole('link', { name: '구운몽 소설 상세로 돌아가기' })
    within(panel).getByText('4화까지 공개된 설정만 보여요.')
    // 나무위키 형식: 목차에서 분류·문서로 건너가고, 문서 제목은 목차 번호를 단다.
    const toc = within(panel).getByRole('navigation', { name: '목차' })
    within(toc).getByRole('link', { name: /^\d+\.\d+\. 성진$/ })
    for (const name of ['성진', '연화봉', '돌다리']) within(panel).getByRole('heading', { name: new RegExp(`^\\d+\\.\\d+\\. ${name}$`) })
    within(panel).getByRole('heading', { name: /^\d+\.\d+\. 스승의 벌/ })
    expect(panel.querySelector('input, textarea, select, button, [contenteditable]')).toBeNull()
  })

  it('회차 화면은 그 회차까지 공개된 설정만 시트로 보여 준다', async () => {
    restore = servePublicWiki()
    guestSession()
    renderApp('/read/guunmong/1')
    const open = await screen.findByRole('button', { name: '공개 설정 보기' })
    open.focus()
    fireEvent.click(open)
    const dialog = screen.getByRole('dialog', { name: '공개된 설정' })
    expect(sid()).toBe('U44 공개 설정 보기')
    within(dialog).getByText('1화까지 공개된 설정만 보여요.')
    within(dialog).getByRole('heading', { name: '성진' })
    within(dialog).getByRole('heading', { name: '연화봉' })
    expect(within(dialog).queryByRole('heading', { name: '돌다리' })).toBeNull()
    expect(within(dialog).queryByRole('heading', { name: /^스승의 벌/ })).toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(open)
    cleanup()
    renderApp('/read/guunmong/2')
    fireEvent.click(await screen.findByRole('button', { name: '공개 설정 보기' }))
    const second = screen.getByRole('dialog', { name: '공개된 설정' })
    within(second).getByText('2화까지 공개된 설정만 보여요.')
    within(second).getByRole('heading', { name: '돌다리' })
    expect(within(second).queryByRole('heading', { name: /^스승의 벌/ })).toBeNull()
  })

  it('공개된 설정이 없으면 빈 상태를 보여 주고, 서버 작품이 아니면 위키 링크를 만들지 않고 위키 주소도 작품 상세로 돌려보낸다', async () => {
    restore = servePublicWiki([])
    renderApp('/work/guunmong/wiki')
    within(await screen.findByRole('article', { name: '구운몽/설정 위키' })).getByText('공개된 설정이 없어요.')
    cleanup()
    restore()
    restore = () => {}
    renderApp('/work/guunmong')
    await screen.findByRole('heading', { name: '구운몽' })
    expect(screen.queryByRole('link', { name: '설정 위키' })).toBeNull()
    cleanup()
    renderApp('/work/guunmong/wiki')
    await screen.findByRole('heading', { name: '구운몽' })
    expect(screen.queryByRole('article', { name: '구운몽/설정 위키' })).toBeNull()
    cleanup()
    renderApp('/read/guunmong/1', user())
    await screen.findByRole('heading', { name: '연화봉의 젊은 승려' })
    expect(screen.queryByRole('button', { name: '공개 설정 보기' })).toBeNull()
  })
})

const serverComment = (extra: Partial<EpisodeComment> = {}): EpisodeComment => ({
  id: 'c1', workId: 'guunmong', episodeNumber: 2, publishedVersionId: 'v2', authorName: '독자A', body: '첫 감상', quote: null, spoiler: false,
  likeCount: 0, liked: false, mine: false, edited: false, createdAt: '2026-11-09T01:00:00Z', updatedAt: '2026-11-09T01:00:00Z', ...extra,
})
/** 서버 대신 메모리로 답하는 회차 댓글 저장소: 정렬·작성·수정·삭제·좋아요를 서버처럼 처리하고 호출은 vi.fn에 남긴다. */
function memoryComments(seed: EpisodeComment[]) {
  const rows = [...seed]
  const find = (id: string) => rows.find((r) => r.id === id)!
  return {
    list: vi.fn(async (_id: string, _n: number, sort: CommentSort) => (sort === 'likes' ? [...rows].sort((a, b) => b.likeCount - a.likeCount) : [...rows]).map((r) => ({ ...r }))),
    create: vi.fn(async (workId: string, n: number, input: { body: string; quote?: string; spoiler?: boolean }) => {
      const made = serverComment({ id: `new${rows.length}`, workId, episodeNumber: n, authorName: '나', mine: true, body: input.body, quote: input.quote ?? null, spoiler: input.spoiler ?? false })
      rows.unshift(made)
      return { ...made }
    }),
    update: vi.fn(async (_w: string, _n: number, id: string, input: { body: string; spoiler: boolean }) => ({ ...Object.assign(find(id), input, { edited: true }) })),
    remove: vi.fn(async (_w: string, _n: number, id: string) => { rows.splice(rows.indexOf(find(id)), 1) }),
    like: vi.fn(async (_w: string, _n: number, id: string) => { const r = find(id); if (!r.liked) Object.assign(r, { liked: true, likeCount: r.likeCount + 1 }) }),
    unlike: vi.fn(async (_w: string, _n: number, id: string) => { const r = find(id); if (r.liked) Object.assign(r, { liked: false, likeCount: r.likeCount - 1 }) }),
  } satisfies EpisodeCommentRepository
}
type MemoryComments = ReturnType<typeof memoryComments>
const toastText = () => document.getElementById('toast')!.textContent
const lastSort = (repo: MemoryComments) => repo.list.mock.calls.at(-1)?.[2]
const lastCall = (repo: MemoryComments) => repo.list.mock.calls.at(-1)?.[1]

describe('정본 회차 댓글 (기능 22)', () => {
  const works = appContainer.resolve('mockDb').works
  const original = appContainer.resolve('episodeCommentUseCase')
  /** 정본 작품 열람 화면을 서버 대역과 함께 연다. tweak는 화면을 그리기 전에 대역의 응답을 바꾼다. */
  const open = (seed: EpisodeComment[], tweak: (repo: MemoryComments) => void = () => {}, path = '/read/guunmong/2') => {
    const repo = memoryComments(seed)
    tweak(repo)
    appContainer.register({ episodeCommentUseCase: asValue(new EpisodeCommentUseCase(repo)) })
    renderApp(path, user())
    return repo
  }
  beforeEach(() => { for (const work of works) work.canonical = true })
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    appContainer.register({ episodeCommentUseCase: asValue(original) })
    for (const work of works) delete work.canonical
  })

  it('서버 목록을 작성자·인용·수정됨·스포일러 가림과 함께 보여 주고 정렬을 바꾸면 서버에 다시 묻는다', async () => {
    const repo = open([
      serverComment({ id: 'a', authorName: '독자A', body: '첫 감상', likeCount: 1, quote: '성진은 복숭아꽃 한 가지를 꺾어 던졌다.', edited: true }),
      serverComment({ id: 'b', authorName: '독자B', body: '반전은 사실 이거예요', spoiler: true, likeCount: 7 }),
    ])
    await screen.findByText('독자A')
    screen.getByRole('heading', { name: '댓글 2' })
    expect(repo.list.mock.calls[0]).toEqual(['guunmong', 2, 'latest'])
    screen.getByText(/수정됨/)
    expect(document.querySelector('.cm q.cq')!.textContent).toBe('성진은 복숭아꽃 한 가지를 꺾어 던졌다.')
    const spoiler = screen.getByText('스포일러 댓글 보기').closest('details')!
    expect(spoiler.open).toBe(false)
    expect(spoiler.textContent).toContain('반전은 사실 이거예요')
    expect(screen.queryByText(/아직 연결되지 않았어요/)).toBeNull()
    expect(screen.getAllByText(/^독자/).map((el) => el.textContent?.slice(0, 3))).toEqual(['독자A', '독자B'])
    fireEvent.click(screen.getByRole('button', { name: '좋아요순' }))
    await waitFor(() => expect(lastSort(repo)).toBe('likes'))
    await waitFor(() => expect(screen.getAllByText(/^독자/).map((el) => el.textContent?.slice(0, 3))).toEqual(['독자B', '독자A']))
    expect(screen.getByRole('button', { name: '좋아요순' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: '최신순' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('작성은 앞뒤 공백을 지운 본문과 스포일러 여부를 서버에 보내고 성공하면 입력을 비운다', async () => {
    const repo = open([serverComment()])
    const input = await screen.findByLabelText<HTMLInputElement>('댓글 입력')
    expect(input.maxLength).toBe(500)
    fireEvent.change(input, { target: { value: '  새 감상이에요  ' } })
    const spoiler = screen.getByLabelText<HTMLInputElement>('스포일러 표시')
    fireEvent.click(spoiler)
    fireEvent.click(screen.getByRole('button', { name: '등록' }))
    await screen.findByText('새 감상이에요')
    expect(repo.create).toHaveBeenCalledWith('guunmong', 2, { body: '새 감상이에요', spoiler: true })
    expect(input.value).toBe('')
    expect(spoiler.checked).toBe(false)
    expect(toastText()).toBe('댓글을 남겼어요')
    screen.getByRole('heading', { name: '댓글 2' })
  })

  it('작성이 실패하면 서버 안내를 보이고 입력을 그대로 두며 다시 읽지 않는다', async () => {
    const repo = open([], (r) => r.create.mockRejectedValueOnce(new Error('공개 회차를 찾을 수 없어요.')))
    const input = await screen.findByLabelText<HTMLInputElement>('댓글 입력')
    fireEvent.change(input, { target: { value: '보내려던 감상' } })
    fireEvent.click(screen.getByLabelText('스포일러 표시'))
    fireEvent.click(screen.getByRole('button', { name: '등록' }))
    await waitFor(() => expect(toastText()).toBe('공개 회차를 찾을 수 없어요.'))
    expect(input.value).toBe('보내려던 감상')
    expect(screen.getByLabelText<HTMLInputElement>('스포일러 표시').checked).toBe(true)
    expect(screen.getByRole('button', { name: '등록' }).hasAttribute('disabled')).toBe(false)
    expect(repo.list).toHaveBeenCalledTimes(1)
  })

  it('빈 내용은 UseCase가 거절한 안내만 보이고 서버에 보내지 않으며 곧 다시 보낼 수 있다', async () => {
    const repo = open([])
    const submit = await screen.findByRole('button', { name: '등록' })
    fireEvent.click(submit)
    await waitFor(() => expect(toastText()).toBe('댓글 내용을 입력해 주세요.'))
    await waitFor(() => expect(submit.hasAttribute('disabled')).toBe(false))
    expect(repo.create).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('댓글 입력'), { target: { value: '이제 쓸게요' } })
    fireEvent.click(submit)
    await screen.findByText('이제 쓸게요')
    expect(repo.create).toHaveBeenCalledTimes(1)
  })

  it('진행 중에는 중복 전송하지 않고 끝나면 입력을 비우고 다시 보낼 수 있다', async () => {
    let finish!: (made: EpisodeComment) => void
    const pending = new Promise<EpisodeComment>((resolve) => { finish = resolve })
    const repo = open([], (r) => r.create.mockReturnValueOnce(pending))
    const input = await screen.findByLabelText<HTMLInputElement>('댓글 입력')
    fireEvent.change(input, { target: { value: '한 번만' } })
    const submit = screen.getByRole('button', { name: '등록' })
    fireEvent.click(submit)
    fireEvent.click(submit)
    expect(repo.create).toHaveBeenCalledTimes(1)
    expect(submit.hasAttribute('disabled')).toBe(true)
    await act(async () => { finish(serverComment({ id: 'n', authorName: '나', body: '한 번만', mine: true })) })
    await waitFor(() => expect(submit.hasAttribute('disabled')).toBe(false))
    expect(input.value).toBe('')
  })

  it('문장을 골라 단 댓글은 선택 문장을 인용으로 서버에 보낸다', async () => {
    const repo = open([])
    const picked = await sentence('성진은 복숭아꽃 한 가지를 꺾어 던졌다.')
    fireEvent.click(picked)
    fireEvent.click(within(screen.getByRole('dialog', { name: '문장 작업' })).getByRole('button', { name: '💬 댓글 달기' }))
    const dialog = screen.getByRole('dialog', { name: '문장에 댓글 달기' })
    within(dialog).getByText('성진은 복숭아꽃 한 가지를 꺾어 던졌다.')
    const box = within(dialog).getByLabelText<HTMLTextAreaElement>('댓글')
    expect(box.maxLength).toBe(500)
    fireEvent.change(box, { target: { value: '이 장면이 제일 좋아요' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '등록' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(document.activeElement).toBe(picked)
    expect(repo.create).toHaveBeenCalledWith('guunmong', 2, { body: '이 장면이 제일 좋아요', quote: '성진은 복숭아꽃 한 가지를 꺾어 던졌다.', spoiler: false })
    await screen.findByText('이 장면이 제일 좋아요')
    expect(document.querySelector('.cm q.cq')!.textContent).toBe('성진은 복숭아꽃 한 가지를 꺾어 던졌다.')
  })

  it('문장 댓글이 실패하면 시트를 열어 둔 채 입력을 유지한다', async () => {
    open([], (r) => r.create.mockRejectedValueOnce(new Error('서버 인증이 필요합니다.')))
    fireEvent.click(await sentence('성진은 복숭아꽃 한 가지를 꺾어 던졌다.'))
    fireEvent.click(screen.getByRole('button', { name: '💬 댓글 달기' }))
    const dialog = screen.getByRole('dialog', { name: '문장에 댓글 달기' })
    fireEvent.change(within(dialog).getByLabelText('댓글'), { target: { value: '남기고 싶은 말' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '등록' }))
    await waitFor(() => expect(toastText()).toBe('서버 인증이 필요합니다.'))
    expect(within(screen.getByRole('dialog', { name: '문장에 댓글 달기' })).getByLabelText<HTMLTextAreaElement>('댓글').value).toBe('남기고 싶은 말')
    expect(within(dialog).getByRole('button', { name: '등록' }).hasAttribute('disabled')).toBe(false)
  })

  it('내 댓글만 수정·삭제 버튼이 있고 수정은 본문과 스포일러 여부를 서버에 보낸다', async () => {
    const repo = open([serverComment({ id: 'a', authorName: '독자A' }), serverComment({ id: 'm', authorName: '나', body: '내 감상', mine: true })])
    await screen.findByText('내 감상')
    expect(screen.getAllByRole('button', { name: '수정' })).toHaveLength(1)
    expect(screen.getAllByRole('button', { name: '삭제' })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: '수정' }))
    const box = screen.getByLabelText<HTMLTextAreaElement>('댓글 수정')
    expect(box.value).toBe('내 감상')
    expect(box.maxLength).toBe(500)
    expect(document.activeElement).toBe(box)
    fireEvent.change(box, { target: { value: ' 고친 감상 ' } })
    const form = box.closest('form')!
    fireEvent.click(within(form).getByLabelText('스포일러 표시'))
    fireEvent.click(within(form).getByRole('button', { name: '저장' }))
    await screen.findByText(/수정됨/)
    expect(repo.update).toHaveBeenCalledWith('guunmong', 2, 'm', { body: '고친 감상', spoiler: true })
    expect(screen.queryByLabelText('댓글 수정')).toBeNull()
    expect(screen.getByText('스포일러 댓글 보기').closest('details')!.textContent).toContain('고친 감상')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '수정' }))
  })

  it('수정이 실패하면 안내만 하고 수정 입력과 편집 상태를 유지하며 취소하면 원래 글을 보인다', async () => {
    open([serverComment({ id: 'm', authorName: '나', body: '내 감상', mine: true })], (r) => r.update.mockRejectedValueOnce(new Error('작성자만 수정할 수 있어요.')))
    fireEvent.click(await screen.findByRole('button', { name: '수정' }))
    const box = screen.getByLabelText<HTMLTextAreaElement>('댓글 수정')
    fireEvent.change(box, { target: { value: '고치던 글' } })
    fireEvent.click(screen.getByRole('button', { name: '저장' }))
    await waitFor(() => expect(toastText()).toBe('작성자만 수정할 수 있어요.'))
    expect(screen.getByLabelText<HTMLTextAreaElement>('댓글 수정').value).toBe('고치던 글')
    expect(screen.getByRole('button', { name: '저장' }).hasAttribute('disabled')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: '취소' }))
    expect(screen.queryByLabelText('댓글 수정')).toBeNull()
    screen.getByText('내 감상')
  })

  it('삭제는 확인한 뒤에만 서버에 요청하고 목록에서 사라진다', async () => {
    const repo = open([serverComment({ id: 'm', authorName: '나', body: '내 감상', mine: true })])
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    fireEvent.click(await screen.findByRole('button', { name: '삭제' }))
    expect(repo.remove).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '삭제' }))
    await waitFor(() => expect(screen.queryByText('내 감상')).toBeNull())
    expect(repo.remove).toHaveBeenCalledWith('guunmong', 2, 'm')
    expect(confirm).toHaveBeenCalledTimes(2)
    expect(toastText()).toBe('댓글을 삭제했어요')
    screen.getByRole('heading', { name: '댓글 0' })
  })

  it('좋아요와 취소는 서버가 돌려준 개수와 상태로 다시 그린다', async () => {
    const repo = open([serverComment({ likeCount: 5 })])
    const like = await screen.findByRole('button', { name: '좋아요 5개' })
    expect(like.getAttribute('aria-pressed')).toBe('false')
    fireEvent.click(like)
    await waitFor(() => expect(screen.getByRole('button', { name: '좋아요 6개' }).getAttribute('aria-pressed')).toBe('true'))
    expect(repo.like).toHaveBeenCalledWith('guunmong', 2, 'c1')
    fireEvent.click(screen.getByRole('button', { name: '좋아요 6개' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '좋아요 5개' }).getAttribute('aria-pressed')).toBe('false'))
    expect(repo.unlike).toHaveBeenCalledWith('guunmong', 2, 'c1')
  })

  it('목록을 못 읽으면 오류와 다시 불러오기를 보이고 빈 목록으로 숨기지 않는다', async () => {
    open([serverComment()], (r) => r.list.mockRejectedValueOnce(new Error('offline')))
    await screen.findByText(/댓글을 불러오지 못했어요/)
    expect(screen.queryByText('독자A')).toBeNull()
    expect(screen.queryByText(/아직 댓글이 없어요/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '다시 불러오기' }))
    await screen.findByText('독자A')
    expect(screen.queryByText(/댓글을 불러오지 못했어요/)).toBeNull()
  })

  it('다른 회차로 가면 입력을 비우고 늦게 도착한 이전 회차 목록은 무시한다', async () => {
    let late!: (rows: EpisodeComment[]) => void
    const slow = new Promise<EpisodeComment[]>((resolve) => { late = resolve })
    const repo = open([], (r) => r.list.mockImplementation(async (_id, n) => n === 2 ? slow : [serverComment({ id: 'n3', authorName: '3화 독자', episodeNumber: 3 })]))
    fireEvent.change(await screen.findByLabelText('댓글 입력'), { target: { value: '쓰다 만 글' } })
    fireEvent.click(screen.getByRole('link', { name: '다음 화 ›' }))
    await screen.findByRole('heading', { name: '인간 세상으로' })
    await screen.findByText('3화 독자')
    expect(lastCall(repo)).toBe(3)
    expect(screen.getByLabelText<HTMLInputElement>('댓글 입력').value).toBe('')
    await act(async () => { late([serverComment({ id: 'n2', authorName: '2화 독자' })]) })
    expect(screen.queryByText('2화 독자')).toBeNull()
    screen.getByText('3화 독자')
  })

  it('정렬을 바꾸면 늦게 도착한 이전 정렬의 목록은 무시한다', async () => {
    let late!: (rows: EpisodeComment[]) => void
    const slow = new Promise<EpisodeComment[]>((resolve) => { late = resolve })
    open([serverComment({ id: 'hot', authorName: '좋아요순 독자', likeCount: 9 })], (r) => {
      const memory = r.list.getMockImplementation()!
      r.list.mockImplementation(async (id, n, sort) => sort === 'latest' ? slow : memory(id, n, sort))
    })
    fireEvent.click(await screen.findByRole('button', { name: '좋아요순' }))
    await screen.findByText('좋아요순 독자')
    await act(async () => { late([serverComment({ id: 'old', authorName: '늦은 최신순 독자' })]) })
    expect(screen.queryByText('늦은 최신순 독자')).toBeNull()
    screen.getByText('좋아요순 독자')
    screen.getByRole('heading', { name: '댓글 1' })
  })

  describe('익명', () => {
    const openAnonymous = async (quoted?: Sentence) => {
      const repo = memoryComments([serverComment({ likeCount: 3 })])
      appContainer.register({ episodeCommentUseCase: asValue(new EpisodeCommentUseCase(repo)) })
      const store = createAppStore()
      const Where = () => <p hidden data-testid="where">{useLocation().pathname}</p>
      render(<Provider store={store}><MemoryRouter initialEntries={['/read/guunmong/2?x=1']}><EpisodeComments workId="guunmong" n={2} quoted={quoted} onCloseSheet={() => {}} /><Where /></MemoryRouter></Provider>)
      await screen.findByText('독자A')
      return { store, repo }
    }

    it('목록은 보고 작성 폼과 좋아요 버튼 대신 로그인 안내를 본다', async () => {
      const { store } = await openAnonymous()
      expect(screen.queryByLabelText('댓글 입력')).toBeNull()
      expect(screen.queryByRole('button', { name: '등록' })).toBeNull()
      expect(screen.queryByRole('button', { name: /좋아요 3개/ })).toBeNull()
      fireEvent.click(screen.getByRole('link', { name: '로그인하고 댓글 남기기' }))
      expect(screen.getByTestId('where').textContent).toBe('/login')
      expect(store.getState().session).toMatchObject({ next: '/read/guunmong/2?x=1', loginRole: 'user' })
      expect(store.getState().session.loginMsg).toContain('로그인')
    })

    it('좋아요를 누르면 서버를 부르지 않고 로그인 안내로 이어진다', async () => {
      const { store, repo } = await openAnonymous()
      fireEvent.click(screen.getByRole('link', { name: /좋아요 3개/ }))
      expect(screen.getByTestId('where').textContent).toBe('/login')
      expect(store.getState().session.next).toBe('/read/guunmong/2?x=1')
      expect(repo.like).not.toHaveBeenCalled()
    })

    it('문장 시트에서 등록하면 서버를 부르지 않고 로그인 안내로 이어진다', async () => {
      const { store, repo } = await openAnonymous({ t: '성진은 복숭아꽃 한 가지를 꺾어 던졌다.', pi: 0 })
      const dialog = screen.getByRole('dialog', { name: '문장에 댓글 달기' })
      fireEvent.change(within(dialog).getByLabelText('댓글'), { target: { value: '이 장면이 좋아요' } })
      fireEvent.click(within(dialog).getByRole('button', { name: '등록' }))
      await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/login'))
      expect(store.getState().session).toMatchObject({ next: '/read/guunmong/2?x=1', loginRole: 'user' })
      expect(store.getState().session.loginMsg).toContain('로그인')
      expect(repo.create).not.toHaveBeenCalled()
    })
  })

  it('같은 화면에서 로그아웃하면 목록을 익명으로 다시 읽어 내 댓글·좋아요 표시를 지운다', async () => {
    const store = createAppStore({ role: 'user' })
    const repo = memoryComments([])
    // 서버는 로그인 상태(Bearer)에서만 mine·liked를 채워 준다.
    repo.list.mockImplementation(async () => [serverComment({ id: 'm', authorName: '나', body: '내 감상', likeCount: 1, ...(store.getState().session.role && { mine: true, liked: true }) })])
    appContainer.register({ episodeCommentUseCase: asValue(new EpisodeCommentUseCase(repo)) })
    render(<Provider store={store}><MemoryRouter initialEntries={['/read/guunmong/2']}><EpisodeComments workId="guunmong" n={2} onCloseSheet={() => {}} /></MemoryRouter></Provider>)
    await screen.findByRole('button', { name: '수정' })
    expect(screen.getByRole('button', { name: '좋아요 1개' }).getAttribute('aria-pressed')).toBe('true')
    act(() => { store.dispatch(sessionActions.logout()) })
    await screen.findByRole('link', { name: /좋아요 1개/ })
    expect(screen.queryByRole('button', { name: '수정' })).toBeNull()
    expect(repo.list).toHaveBeenCalledTimes(2)
  })
})

describe('빠른 이동 (U03)', () => {
  it('Ctrl K와 GNB 검색 버튼으로 열고 고른 항목으로 이동한다', async () => {
    renderApp('/')
    fireEvent.click(await screen.findByRole('button', { name: '소설·인물·회차 검색' }))
    screen.getByRole('dialog', { name: '빠른 이동' })
    expect(sid()).toBe('U03 빠른 이동 (Ctrl K)')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true })
    const dialog = screen.getByRole('dialog', { name: '빠른 이동' })
    fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: '팔선녀' } })
    fireEvent.click(await within(dialog).findByText('구운몽 2화 돌다리 위의 팔선녀'))
    await screen.findByRole('heading', { name: '돌다리 위의 팔선녀' })
    expect(screen.queryByText('소설을 읽으려면 로그인해 주세요.')).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
