// @vitest-environment jsdom
import '../../../../test/fixtureApp'

import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { appContainer } from '../../../../app/appContainer'
import { createAppStore } from '../../../../app/store'
import { WCATS, type Doc } from '../../../../domain/entities/wiki'
import { renderApp } from '../../../../test/renderApp'

afterEach(() => { cleanup(); vi.restoreAllMocks(); document.title = 'STORYFORK' })

const user = () => createAppStore({ role: 'user' })
const expectOneMain = () => {
  const mains = document.querySelectorAll('main')
  expect(mains).toHaveLength(1)
  expect(mains[0].id).toBe('main')
  expect(mains[0].getAttribute('tabindex')).toBe('-1')
  return mains[0]
}

it('회차 선택 버튼은 눌림 상태를 알린다', async () => {
  renderApp('/fork/guunmong', user())
  await screen.findByRole('heading', { name: '「구운몽」 포크' })
  const epc = within(document.getElementById('epc')!)
  epc.getByRole('button', { name: /1화 끝에서/, pressed: false })
  epc.getByRole('button', { name: /2화 끝에서/, pressed: true })
  fireEvent.click(epc.getByRole('button', { name: /3화 끝에서/ }))
  epc.getByRole('button', { name: /2화 끝에서/, pressed: false })
  epc.getByRole('button', { name: /3화 끝에서/, pressed: true })
})

it('포크 만들기의 단계 제목은 h1 바로 아래 단계로 알려 제목 단계를 건너뛰지 않는다', async () => {
  renderApp('/fork/guunmong', user())
  await screen.findByRole('heading', { name: '「구운몽」 포크', level: 1 })
  expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(['1어디서부터 바꿀까요?', '2무엇이 달라지나요?', '3제목'])
  const levels = screen.getAllByRole('heading').map((h) => Number(h.getAttribute('aria-level') ?? h.tagName.slice(1)))
  expect(levels.filter((level, i) => i > 0 && level > levels[i - 1] + 1)).toEqual([])
})

const doc = (id: string, cat: string, t: string): Doc => ({ id, cat, t, body: '', alias: [], tags: [], props: {}, at: {} })

/**
 * 서버 작품처럼 회차마다 설정을 다시 읽는 Fork 폼을 흉내 낸다. `at` 회차의 응답만 호출자가 정한 때까지 붙잡거나 실패시킨다.
 * 서버 작품의 설정 분류(cats)는 기존 WCATS 이름이고, `docs`·`allowed`로 공개 자료와 포크를 허용한 회차를 바꿀 수 있다.
 */
function serverFork(on: (at: number) => Promise<void> | void, options: { docs?: Doc[]; allowed?: number[] } = {}) {
  const forks = appContainer.resolve('forkUseCase')
  const getForm = forks.getForm.bind(forks)
  vi.spyOn(forks, 'getForm').mockImplementation(async (id, at) => {
    const form = await getForm(id, at)
    if (form) {
      form.work.canonical = true
      form.work.wiki = { cats: structuredClone(WCATS), docs: options.docs ?? [doc('event', 'event', `${form.basisEpisode}화 사건`)] }
      if (options.allowed) form.forkList = options.allowed
    }
    await on(at ?? 0)
    return form
  })
}
const epcButton = (name: RegExp) => within(document.getElementById('epc')!).getByRole('button', { name })

it('서버 작품은 선택한 회차의 설정을 읽는 동안 이전 회차의 규칙·인물 수를 보이지 않는다', async () => {
  let release!: () => void
  const held = new Promise<void>((resolve) => { release = resolve })
  serverFork((at) => at === 3 ? held : undefined)
  renderApp('/fork/guunmong', user())
  await screen.findByRole('heading', { name: '「구운몽」 포크' })
  const counts = () => [document.getElementById('rulecount')!.textContent, document.getElementById('castcount')!.textContent]
  expect(counts().every((n) => /^\d+$/.test(n!))).toBe(true)
  expect(screen.getByText('사건 · 2화 사건')).toBeTruthy()
  fireEvent.click(epcButton(/3화 끝에서/))
  expect(epcButton(/3화 끝에서/).getAttribute('aria-pressed')).toBe('true')
  expect(counts()).toEqual(['…', '…'])
  expect(screen.queryByText('사건 · 2화 사건')).toBeNull()
  await act(async () => release())
  await screen.findByText('사건 · 3화 사건')
  await waitFor(() => expect(document.getElementById('rulecount')!.textContent).toBe('2'))
  expect(counts().every((n) => /^\d+$/.test(n!))).toBe(true)
})

it('공개 자료 미리보기는 기존 설정 분류 이름을 칩으로 보이고 많으면 8개까지만 보이며 나머지는 외 N개로 알린다', async () => {
  const docs = [doc('c', 'char', '성진'), doc('p', 'place', '연화봉'), doc('w', 'world', '구슬의 규칙'), ...Array.from({ length: 8 }, (_, i) => doc(`e${i}`, 'event', `사건 ${i + 1}`))]
  serverFork(() => {}, { docs })
  renderApp('/fork/guunmong', user())
  await screen.findByRole('heading', { name: '「구운몽」 포크' })
  const preview = within(await screen.findByRole('region', { name: /공개 자료 미리보기/ }))
  const items = preview.getAllByRole('listitem')
  // 분류 이름은 설정 위키와 같은 표기다(인물이 아니라 캐릭터, 장소·세계관 설정을 '설정'으로 뭉치지 않는다).
  expect(items.slice(0, 3).map((li) => li.textContent)).toEqual(['캐릭터 · 성진', '장소 · 연화봉', '세계관 설정 · 구슬의 규칙'])
  expect(items).toHaveLength(9)
  expect(items.at(-1)!.textContent).toBe('외 3개')
  // 가져가는 것 칩과 같은 칩 목록이다.
  expect(items[0].parentElement!.className).toBe('carry')
})

it('공개 자료가 8개 이하이면 외 N개 칩 없이 모두 보인다', async () => {
  serverFork(() => {}, { docs: Array.from({ length: 8 }, (_, i) => doc(`e${i}`, 'event', `사건 ${i + 1}`)) })
  renderApp('/fork/guunmong', user())
  await screen.findByRole('heading', { name: '「구운몽」 포크' })
  const items = within(await screen.findByRole('region', { name: /공개 자료 미리보기/ })).getAllByRole('listitem')
  expect(items).toHaveLength(8)
  expect(items.some((li) => li.textContent?.startsWith('외 '))).toBe(false)
})

it('회차를 바꿔 설정을 다 읽으면 항상 마운트된 안내 영역이 전환 완료를 알린다', async () => {
  let release!: () => void
  const held = new Promise<void>((resolve) => { release = resolve })
  serverFork((at) => at === 3 ? held : undefined)
  renderApp('/fork/guunmong', user())
  await screen.findByRole('heading', { name: '「구운몽」 포크' })
  const live = document.querySelector<HTMLElement>('.fork [aria-live="polite"]')!
  expect(live.textContent).toContain('2화 끝에서 포크해요')
  fireEvent.click(epcButton(/3화 끝에서/))
  expect(live.textContent).toBe('선택한 회차의 공개 설정을 불러오고 있어요…')
  await act(async () => release())
  await waitFor(() => expect(live.textContent).toContain('3화 끝에서 포크해요'))
  // 같은 노드가 처음부터 계속 마운트돼 있어야 스크린 리더가 문구 변경을 알린다.
  expect(live.isConnected).toBe(true)
  expect(document.querySelector('.fork [aria-live="polite"]')).toBe(live)
})

it('포크를 허용하지 않은 회차는 이유를 화면에 보이고 그 회차 버튼이 문구를 설명으로 가리킨다', async () => {
  serverFork(() => {}, { allowed: [2, 3] })
  renderApp('/fork/guunmong', user())
  await screen.findByRole('heading', { name: '「구운몽」 포크' })
  const note = await screen.findByText('작가가 포크를 허용하지 않은 회차는 고를 수 없어요.')
  const denied = epcButton(/1화 끝에서/)
  expect(denied.hasAttribute('disabled')).toBe(true)
  // title은 비활성 버튼에서 키보드·터치로 읽을 수 없어 쓰지 않는다.
  expect(denied.hasAttribute('title')).toBe(false)
  expect(denied.getAttribute('aria-describedby')).toBe(note.id)
  expect(epcButton(/2화 끝에서/).hasAttribute('aria-describedby')).toBe(false)
})

it('선택한 회차의 설정을 읽지 못하면 이전 값을 두지 않고 오류와 다시 불러오기를 보여 준다', async () => {
  let offline = true
  serverFork((at) => { if (at === 3 && offline) throw new Error('offline') })
  renderApp('/fork/guunmong', user())
  await screen.findByRole('heading', { name: '「구운몽」 포크' })
  fireEvent.click(epcButton(/3화 끝에서/))
  await screen.findByText(/소설을 불러오지 못했어요/)
  expect(document.getElementById('epc')).toBeNull()
  offline = false
  fireEvent.click(screen.getByRole('button', { name: '다시 불러오기' }))
  await screen.findByRole('heading', { name: '「구운몽」 포크' })
  expect(epcButton(/3화 끝에서/).getAttribute('aria-pressed')).toBe('true')
})

it('포크 폼은 main 하나와 h1 하나를 갖고 탭 제목은 포크 만들기이다', async () => {
  renderApp('/fork/guunmong', user())
  const h1 = await screen.findByRole('heading', { name: '「구운몽」 포크', level: 1 })
  expect(expectOneMain().contains(h1)).toBe(true)
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  await waitFor(() => expect(document.title).toBe('포크 만들기 · STORYFORK'))
})

it('포크를 만든 뒤 완료 화면과 이미 포크한 안내도 main 하나와 h1 하나를 갖는다', async () => {
  renderApp('/fork/guunmong', user())
  await screen.findByRole('heading', { name: '「구운몽」 포크' })
  fireEvent.click(within(document.getElementById('epc')!).getByRole('button', { name: /3화 끝에서/ }))
  // 샘플 이관이 구운몽 전용 기본 변경 설명·제목을 없앴으므로 두 입력을 직접 적는다.
  fireEvent.change(screen.getByLabelText('무엇이 달라지나요?'), { target: { value: '성진이 털어놓았다면?' } })
  fireEvent.change(screen.getByLabelText('제목'), { target: { value: '구운몽: 연화봉에 남은 성진' } })
  fireEvent.click(screen.getByRole('button', { name: '포크 소설 시작하기 →' }))
  await screen.findByRole('heading', { name: '포크 소설을 만들었어요' })
  expectOneMain()
  expect(screen.getAllByRole('heading', { level: 1 }).map((h) => h.textContent)).toEqual(['포크 소설 생성 완료'])
  await waitFor(() => expect(document.title).toBe('포크 소설 · STORYFORK'))
  cleanup()

  renderApp('/fork/guunmong', user())
  const h1 = await screen.findByRole('heading', { name: '이미 포크한 원작이에요', level: 1 })
  expect(expectOneMain().contains(h1)).toBe(true)
  await waitFor(() => expect(document.title).toBe('포크 만들기 · STORYFORK'))
})
