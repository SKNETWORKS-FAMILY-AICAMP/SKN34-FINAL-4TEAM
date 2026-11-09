// @vitest-environment jsdom
import '../../../../test/fixtureApp'

import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { appContainer } from '../../../../app/appContainer'
import { createAppStore } from '../../../../app/store'
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

/** 서버 작품처럼 회차마다 설정을 다시 읽는 Fork 폼을 흉내 낸다. `at` 회차의 응답만 호출자가 정한 때까지 붙잡거나 실패시킨다. */
function serverFork(on: (at: number) => Promise<void> | void) {
  const forks = appContainer.resolve('forkUseCase')
  const getForm = forks.getForm.bind(forks)
  vi.spyOn(forks, 'getForm').mockImplementation(async (id, at) => {
    const form = await getForm(id, at)
    if (form) form.work.canonical = true
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
  fireEvent.click(epcButton(/3화 끝에서/))
  expect(epcButton(/3화 끝에서/).getAttribute('aria-pressed')).toBe('true')
  expect(counts()).toEqual(['…', '…'])
  await act(async () => release())
  await waitFor(() => expect(document.getElementById('rulecount')!.textContent).toBe('2'))
  expect(counts().every((n) => /^\d+$/.test(n!))).toBe(true)
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
