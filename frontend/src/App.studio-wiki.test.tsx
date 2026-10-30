// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'

import App from './App'
import { appContainer } from './app/appContainer'
import { createAppStore } from './app/store'

afterEach(cleanup)

const Where = () => { const l = useLocation(); return <p hidden data-testid="where">{l.pathname + l.search}</p> }
const where = () => screen.getByTestId('where').textContent
const toastIs = (t: string | RegExp) => waitFor(() => expect(document.getElementById('toast')!.textContent).toMatch(t))
const renderAt = (path: string) => render(<Provider store={createAppStore({ role: 'user' })}><MemoryRouter initialEntries={[path]}><App /><Where /></MemoryRouter></Provider>)
const sheet = () => screen.getByRole('dialog')
const fill = (label: string, value: string) => fireEvent.change(within(sheet()).getByLabelText(label), { target: { value } })
const submit = () => fireEvent.submit(document.getElementById('fsf')!)
const blurWith = (el: HTMLElement, text: string) => { el.textContent = text; fireEvent.blur(el) }
const starlight = async () => (await appContainer.resolve('workRepository').listWorks()).find((w) => w.id === 'starlight')!

describe('집필실 사전 편집 (U38)', () => {
  it('새 인물 문서를 만들면 그 문서로 이동하고 등장인물에 반영된다', async () => {
    renderAt('/studio/starlight?view=wiki')
    fireEvent.click(await screen.findByRole('button', { name: '＋ 새 문서' }))
    expect(within(sheet()).getByRole('heading', { name: '새 문서 · 캐릭터' })).toBeTruthy()
    submit()
    await toastIs('필수 항목을 입력해 주세요')
    fill('제목', '미르')
    submit()
    await toastIs('‘미르’ 문서를 만들었어요')
    await screen.findByRole('heading', { name: '미르' })
    expect(where()).toMatch(/view=wiki&doc=d/)
    expect((await starlight()).cast.some((c) => c.n === '미르')).toBe(true)
  })

  it('분류를 추가하면 사이드바에 나온다', async () => {
    renderAt('/studio/starlight?view=wiki')
    fireEvent.click(await screen.findByRole('button', { name: '＋ 분류' }))
    fill('분류 이름', '마법 체계')
    submit()
    await toastIs('분류를 추가했어요')
    await screen.findByRole('button', { name: /마법 체계/ })
  })

  it('제목·본문·속성을 고치면 다시 열어도 남아 있다', async () => {
    renderAt('/studio/starlight?view=wiki&cat=place')
    fireEvent.click((await screen.findAllByRole('button', { name: '지하서고' }))[0])
    blurWith(await screen.findByRole('heading', { name: '지하서고' }), '깊은 서고')
    await screen.findByRole('heading', { name: '깊은 서고' })
    blurWith(screen.getByLabelText('문서 본문'), '봉인이 잠든 곳')
    blurWith(screen.getByLabelText('첫 등장 값'), '3화')
    fireEvent.click(screen.getByRole('button', { name: '＋ 속성 추가' }))
    fill('속성 이름 (예: 관계, 능력, 소속)', '관리자')
    fill('값', '카엘')
    submit()
    await screen.findByLabelText('관리자 값')
    cleanup()
    renderAt('/studio/starlight?view=wiki&cat=place')
    fireEvent.click((await screen.findAllByRole('button', { name: '깊은 서고' }))[0])
    expect((await screen.findByLabelText('문서 본문')).textContent).toBe('봉인이 잠든 곳')
    expect(screen.getByLabelText('첫 등장 값').textContent).toBe('3화')
    expect(screen.getByLabelText('관리자 값').textContent).toBe('카엘')
  })

  it('본문 줄바꿈을 저장한다', async () => {
    renderAt('/studio/starlight?view=wiki&cat=item')
    fireEvent.click((await screen.findAllByRole('button', { name: '오르벤의 서한' }))[0])
    const body = await screen.findByLabelText('문서 본문')
    Object.defineProperty(body, 'innerText', { value: '첫 줄\n둘째 줄', configurable: true })
    fireEvent.blur(body)
    await waitFor(async () => expect((await starlight()).wiki!.docs.some((d) => d.body === '첫 줄\n둘째 줄')).toBe(true))
  })

  it('본문의 다른 문서 이름 링크를 누르면 그 문서가 열린다', async () => {
    renderAt('/studio/starlight?view=wiki&cat=place')
    fireEvent.click((await screen.findAllByRole('button', { name: '별빛 탑' }))[0])
    blurWith(await screen.findByLabelText('문서 본문'), '리안이 지키는 탑')
    const link = await waitFor(() => { const b = within(screen.getByLabelText('문서 본문')).getByRole('button', { name: '리안' }); expect(b.className).toBe('wl'); return b })
    fireEvent.click(link)
    await screen.findByRole('heading', { name: '리안' })
  })

  it('별칭을 추가·삭제하고 별칭으로 검색한다', async () => {
    renderAt('/studio/starlight?view=wiki&cat=char')
    fireEvent.click((await screen.findAllByRole('button', { name: '카엘' }))[0])
    fireEvent.click(await screen.findByRole('button', { name: '＋ 별칭' }))
    fill('별칭', '탑의 기사')
    submit()
    await screen.findByText('탑의 기사')
    fireEvent.click(screen.getByRole('button', { name: '＋ 태그' }))
    fill('태그', '조력자')
    submit()
    await screen.findByText('조력자')
    fireEvent.change(screen.getByLabelText('사전 검색'), { target: { value: '탑의 기사' } })
    fireEvent.submit(screen.getByRole('search'))
    await screen.findByRole('heading', { name: /검색 결과/ })
    const result = document.querySelector('.wmain .wlist') as HTMLElement
    fireEvent.click(within(result).getByRole('button', { name: /카엘/ }))
    fireEvent.click(await screen.findByRole('button', { name: '별칭 삭제' }))
    await waitFor(() => expect(screen.queryByText('탑의 기사')).toBeNull())
  })

  it('문서를 지우면 토스트가 뜨고 분류 목록으로 이동한다', async () => {
    renderAt('/studio/starlight?view=wiki&cat=item')
    fireEvent.click((await screen.findAllByRole('button', { name: '별빛 수정' }))[0])
    fireEvent.click(await screen.findByRole('button', { name: '삭제' }))
    await toastIs('문서를 지웠어요 (소설은 그대로예요)')
    await waitFor(() => expect(where()).toBe('/studio/starlight?view=wiki&cat=item'))
    await waitFor(() => expect(screen.queryByRole('button', { name: '별빛 수정' })).toBeNull())
  })
})
