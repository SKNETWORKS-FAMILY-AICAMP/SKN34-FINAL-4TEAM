// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter, useLocation } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

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
    expect(document.getElementById('saved')!.className).not.toContain('saving')
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

  it('＋ 속성 추가는 시트에서 값만 넣고 인물 상태는 그대로 둔다', async () => {
    renderAt('/studio/starlight?view=wiki&cat=char')
    fireEvent.click((await screen.findAllByRole('button', { name: '세라핀' }))[0])
    fireEvent.click(await screen.findByRole('button', { name: '＋ 속성 추가' }))
    expect(within(sheet()).getByRole('heading', { name: '속성 추가' })).toBeTruthy()
    fill('속성 이름 (예: 관계, 능력, 소속)', '상태')
    fill('값', '분노')
    submit()
    await waitFor(async () => expect((await starlight()).wiki!.docs.find((d) => d.t === '세라핀')!.props.상태).toBe('분노'))
    expect((await starlight()).cast.find((c) => c.n === '세라핀')!.st).toBe('여유')
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
    expect(document.getElementById('saved')!.className).not.toContain('saving')
    await waitFor(() => expect(where()).toBe('/studio/starlight?view=wiki&cat=item'))
    await waitFor(() => expect(screen.queryByRole('button', { name: '별빛 수정' })).toBeNull())
  })
  it('사건 시점·라인을 바꾸면 보드에 반영되고, 등장 인물 칩을 켜고 끈다', async () => {
    renderAt('/studio/starlight?view=wiki&cat=event')
    fireEvent.click((await screen.findAllByRole('button', { name: '재의 사절 도착' }))[0])
    fireEvent.change(await screen.findByLabelText('사건 시점'), { target: { value: '1' } })
    await toastIs('보드에 반영했어요')
    fireEvent.change(screen.getByLabelText('사건 라인'), { target: { value: 'f' } })
    await waitFor(() => expect(screen.getByLabelText<HTMLSelectElement>('사건 라인').value).toBe('f'))
    const chip = screen.getByRole('button', { name: '카엘', pressed: false })
    fireEvent.click(chip)
    await screen.findByRole('button', { name: '카엘', pressed: true })
    fireEvent.click(screen.getByRole('button', { name: '카엘', pressed: true }))
    await screen.findByRole('button', { name: '카엘', pressed: false })
    cleanup()
    renderAt('/studio/starlight?view=board')
    const card = await screen.findByRole('button', { name: /재의 사절 도착/ })
    expect(card.textContent).toContain('#1화')
    expect(card.className).toContain('f')
  })

  it('이어지는 사건을 연결·삭제하고 보드에 연결선을 그린다', async () => {
    renderAt('/studio/starlight?view=wiki&cat=event')
    fireEvent.click((await screen.findAllByRole('button', { name: '탑 앞에서 밤을 지새우다' }))[0])
    fireEvent.click(await screen.findByRole('button', { name: '＋ 계기·복선 연결' }))
    expect(within(sheet()).getByRole('heading', { name: '이어지는 사건 연결' })).toBeTruthy()
    fireEvent.change(within(sheet()).getByLabelText('관계'), { target: { value: '복선' } })
    fireEvent.click(within(sheet()).getByRole('button', { name: '연결' }))
    await toastIs('보드에 화살표로 표시돼요')
    await waitFor(() => expect(screen.getAllByRole('button', { name: '연결 삭제' })).toHaveLength(2))
    fireEvent.click(within(screen.getByRole('navigation', { name: '집필 도구' })).getByRole('button', { name: '보드' }))
    await waitFor(() => expect(document.querySelectorAll('svg.blinks g > path')).toHaveLength(2))
    expect(document.querySelectorAll('svg.blinks g > path.dash')).toHaveLength(1)
    expect([...document.querySelectorAll('svg.blinks text')].map((t) => t.textContent)).toEqual(['계기', '복선'])
    cleanup()
    renderAt('/studio/starlight?view=wiki&cat=event')
    fireEvent.click((await screen.findAllByRole('button', { name: '탑 앞에서 밤을 지새우다' }))[0])
    fireEvent.click((await screen.findAllByRole('button', { name: '연결 삭제' }))[1])
    await waitFor(() => expect(screen.getAllByRole('button', { name: '연결 삭제' })).toHaveLength(1))
  })

  it('연결할 다른 사건이 없으면 안내한다', async () => {
    const w = await starlight()
    const only = w.wiki!.docs.filter((d) => d.cat !== 'event' || d.t === '탑 앞에서 밤을 지새우다')
    await appContainer.resolve('workRepository').saveWork({ ...w, events: w.events.slice(0, 1), ownEvents: [], wiki: { ...w.wiki!, docs: only } })
    renderAt('/studio/starlight?view=wiki&cat=event')
    fireEvent.click((await screen.findAllByRole('button', { name: '탑 앞에서 밤을 지새우다' }))[0])
    fireEvent.click(await screen.findByRole('button', { name: '＋ 계기·복선 연결' }))
    await toastIs('연결할 다른 사건이 없어요')
    await appContainer.resolve('workRepository').saveWork(w)
  })

  it('문서 시점을 고르면 주소의 ep와 표시 값이 바뀌고, 상태 이력에 등장이 먼저 나온다', async () => {
    renderAt('/studio/starlight?view=wiki&cat=char')
    fireEvent.click((await screen.findAllByRole('button', { name: '리안' }))[0])
    await screen.findByText('▲ 등장')
    fireEvent.change(screen.getByLabelText('시점'), { target: { value: '2' } })
    await waitFor(() => expect(where()).toMatch(/&ep=2/))
    await screen.findByText(/2화까지의 변화가 반영된 값이에요/)
    expect(screen.getByLabelText('상태 값').textContent).toBe('봉인의 속삭임을 들음')
    blurWith(screen.getByLabelText('상태 값'), '두려움')
    await waitFor(async () => expect((await starlight()).wiki!.docs.find((d) => d.t === '리안')!.at[2].상태).toBe('두려움'))
  })

  it('보드 ＋ 사건은 필수 항목을 검사하고, 시점 없이 추가하면 시점 미정으로 안내한다', async () => {
    renderAt('/studio/starlight?view=board')
    fireEvent.click(await screen.findByRole('button', { name: '＋ 사건' }))
    expect(within(sheet()).getByRole('heading', { name: '사건 추가' })).toBeTruthy()
    submit()
    await toastIs('필수 항목을 입력해 주세요')
    fill('사건 이름', '떠도는 소문')
    fill('시점', '')
    submit()
    await toastIs('시점 미정 사건으로 추가했어요 · 설정 점검에 표시돼요')
    within(document.querySelector('.bund') as HTMLElement).getByRole('button', { name: /떠도는 소문/ })
    fireEvent.click(screen.getByRole('button', { name: '＋ 사건' }))
    fill('사건 이름', '탑의 붕괴')
    fireEvent.click(within(sheet()).getByLabelText('카엘'))
    submit()
    await toastIs('보드에 사건을 추가했어요')
    expect((await starlight()).ownEvents!.some((e) => e[2] === '탑의 붕괴' && e[3].includes('카엘'))).toBe(true)
  })
  it('인물의 시점별 지식을 추가하고 확인 후 삭제한다', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderAt('/studio/starlight?view=wiki&cat=char')
    fireEvent.click((await screen.findAllByRole('button', { name: '리안' }))[0])
    await screen.findByText('등록된 지식이 없어요.')
    fireEvent.change(screen.getByLabelText('알게 된 사실'), { target: { value: '봉인은 별빛으로 열린다' } })
    fireEvent.change(screen.getByLabelText('인물이 아는 시작 회차'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: '지식 추가' }))
    await toastIs('인물 지식을 저장했어요 (데모)')
    await screen.findByText(/봉인은 별빛으로 열린다 · 인지 2화 · 독자 비공개/)
    fireEvent.click(within(screen.getByText(/봉인은 별빛으로/).closest('li')!).getByRole('button', { name: '삭제' }))
    await screen.findByText('등록된 지식이 없어요.')
    vi.restoreAllMocks()
  })

  it('분류를 표로 보고 셀을 바로 고친다', async () => {
    renderAt('/studio/starlight?view=wiki&cat=place')
    fireEvent.click(await screen.findByRole('button', { name: '표' }))
    await screen.findByText('셀을 눌러 바로 수정해요.')
    expect(where()).toContain('ct=table')
    expect(screen.getByRole('columnheader', { name: '제목' })).toBeTruthy()
  })

  it('대표 이미지 영역을 보여 준다', async () => {
    renderAt('/studio/starlight?view=wiki&cat=place')
    fireEvent.click((await screen.findAllByRole('button', { name: '별빛 탑' }))[0])
    await screen.findByText('클릭해 추가')
    expect(document.querySelector('input[type=file][accept="image/*"]')).toBeTruthy()
  })

  it('연결된 공개 세계관은 복사 전에 편집을 막고, 복사 후 수정으로 연결을 교체한다', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const repo = appContainer.resolve('workRepository')
    const w = await starlight()
    await repo.saveWork({ ...w, worldIds: ['shared-world'] })
    renderAt('/studio/starlight?view=wiki')
    await screen.findByText(/연결한 공개 세계관을 수정하려면 내 세계관으로 복사해야 해요/)
    fireEvent.click(screen.getByRole('button', { name: '＋ 새 문서' }))
    await toastIs('먼저 연결된 공개 세계관을 복사해 주세요')
    fireEvent.click(screen.getByRole('button', { name: '안개 항구 복사 후 수정' }))
    await toastIs('연결을 내 세계관 포크로 교체했어요 (데모)')
    expect((await starlight()).worldIds![0]).not.toBe('shared-world')
    await repo.saveWork(w)
    vi.restoreAllMocks()
  })
})
