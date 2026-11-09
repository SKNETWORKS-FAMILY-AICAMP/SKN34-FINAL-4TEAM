// @vitest-environment jsdom
import '../fixtureApp'

import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { asValue } from 'awilix/browser'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { appContainer } from '../../app/appContainer'
import { createAppStore } from '../../app/store'
import { WCATS, type Doc } from '../../domain/entities/wiki'
import { ReadingUseCase } from '../../domain/usecases/ReadingUseCase'
import { renderApp } from '../renderApp'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const user = () => createAppStore({ role: 'user' })
const sid = () => document.getElementById('sid')!.textContent
const sentence = async (t: string) => (await screen.findAllByText(t)).find((el) => el.classList.contains('s'))!
/** 비회원 시나리오: 세션 복원이 401로 끝나 비로그인 상태가 유지된다. */
function guestSession() {
  vi.stubGlobal('navigator', { locks: { request: (_name: string, _options: object, callback: (lock: object) => Promise<unknown>) => callback({}) } })
  vi.stubGlobal('fetch', vi.fn(async (path: string) => path.endsWith('/csrf') ? Response.json({ csrfToken: 'csrf' }) : new Response(null, { status: 401 })))
}

describe('소설 상세 (U04)', () => {
  it('없는 작품은 목업 unavailableWork 화면을 보여 준다', async () => {
    renderApp('/work/nope')
    await screen.findByRole('heading', { name: '소설을 찾을 수 없거나 볼 수 없어요.' })
    screen.getByRole('link', { name: '홈으로' })
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
    expect(screen.getByRole('status').textContent).toBe('이 창의 관심 소설에 담았어요 · 계정에 저장되지 않아요')
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

describe('정본 열람의 미지원 기능 표시 (CI integration)', () => {
  it('does not present canonical placeholders as rankings or editable sentence actions', async () => {
    const works = appContainer.resolve('mockDb').works
    const searchedUseCase = appContainer.resolve('readingUseCase')
    for (const work of works) { work.canonical = true; work.statisticsSupported = false }
    try {
      renderApp('/work/guunmong')
      await screen.findByRole('heading', { name: '구운몽' })
      expect(document.querySelector('.ifs .md')).toBeNull()
      expect(document.getElementById('lkc')).toBeNull()
      cleanup()
      renderApp('/read/guunmong/2', user())
      await screen.findByRole('heading', { name: '돌다리 위의 팔선녀' })
      expect(document.querySelector('#text [data-s]')).toBeNull()
      expect(screen.queryByRole('button', { name: '등록' })).toBeNull()
      cleanup()
      // 서버 순위가 없는 목록(지표 없는 정본 작품)은 순위·메달로 보이지 않는다(서버 랭킹이 있는 홈은 App.home이 다룬다).
      const { workRepository, readingRepository } = appContainer.cradle
      appContainer.register({ readingUseCase: asValue(new ReadingUseCase(workRepository, readingRepository)) })
      renderApp('/')
      await screen.findByRole('heading', { name: '공개 소설' })
      expect(document.querySelector('#home .md, #home .rk .top')).toBeNull()
    } finally {
      cleanup()
      appContainer.register({ readingUseCase: asValue(searchedUseCase) })
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

  it('작품 상세는 최신 공개 회차 기준의 공개 설정을 비회원에게도 읽기 전용으로 보여 준다', async () => {
    restore = servePublicWiki()
    guestSession()
    renderApp('/work/guunmong')
    const panel = await screen.findByRole('region', { name: '공개된 설정' })
    within(panel).getByText('4화까지 공개된 설정만 보여요.')
    for (const name of ['성진', '연화봉', '돌다리']) within(panel).getByRole('heading', { name })
    within(panel).getByRole('heading', { name: /^스승의 벌/ })
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

  it('공개된 설정이 없으면 빈 상태를 보여 주고, 서버 작품이 아니면 패널을 만들지 않는다', async () => {
    restore = servePublicWiki([])
    renderApp('/work/guunmong')
    within(await screen.findByRole('region', { name: '공개된 설정' })).getByText('공개된 설정이 없어요.')
    cleanup()
    restore()
    restore = () => {}
    renderApp('/work/guunmong')
    await screen.findByRole('heading', { name: '구운몽' })
    expect(screen.queryByRole('region', { name: '공개된 설정' })).toBeNull()
    cleanup()
    renderApp('/read/guunmong/1', user())
    await screen.findByRole('heading', { name: '연화봉의 젊은 승려' })
    expect(screen.queryByRole('button', { name: '공개 설정 보기' })).toBeNull()
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
