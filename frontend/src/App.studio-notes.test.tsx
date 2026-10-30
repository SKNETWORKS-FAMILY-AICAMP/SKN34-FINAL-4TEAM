// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from './App'
import { appContainer } from './app/appContainer'
import { createAppStore } from './app/store'

const db = () => appContainer.resolve('mockDb')
const star = () => db().works.find((w) => w.id === 'starlight')!
const toastIs = (t: string) => waitFor(() => expect(document.getElementById('toast')!.textContent).toBe(t))
const renderAt = (path: string) => render(<Provider store={createAppStore({ role: 'user' })}><MemoryRouter initialEntries={[path]}><App /></MemoryRouter></Provider>)
const box = (name: string) => screen.findByLabelText(name) as Promise<HTMLInputElement>
const ownWorld = () => {
  if (!db().worlds.some((w) => w.id === 'my-world')) db().worlds.push({ id: 'my-world', name: '별빛 세계', description: '', rules: [], public: false })
  star().worldIds = ['my-world']
}

beforeEach(() => { vi.spyOn(window, 'confirm').mockReturnValue(true) })
afterEach(() => { cleanup(); vi.restoreAllMocks(); delete star().worldIds; delete star().settings; delete star().worldCandidate })

describe('설정 노트 (U19 작품 설정·설정 추출·독자 공개 회차·인물 상태)', () => {
  it('세계관 자동 업데이트는 작가 소유 세계관이 없거나 확인을 취소하면 꺼진 채로 남는다', async () => {
    renderAt('/studio/starlight?tab=note')
    fireEvent.click(await box('새 회차 발행 후 세계관 자동 업데이트'))
    await toastIs('작가 소유 세계관이 필요해요')
    expect((await box('새 회차 발행 후 세계관 자동 업데이트')).checked).toBe(false)
    cleanup()
    ownWorld()
    vi.mocked(window.confirm).mockReturnValue(false)
    renderAt('/studio/starlight?tab=note')
    fireEvent.click(await box('새 회차 발행 후 세계관 자동 업데이트'))
    await waitFor(() => expect(window.confirm).toHaveBeenCalledWith('세계관 자동 업데이트 설정 · 회당 예시 5 · 예시 비용 0 크레딧 · 데모 잔액 100. 실제 요금은 미정이며 실제 차감은 없어요. 계속할까요?'))
    expect((await box('새 회차 발행 후 세계관 자동 업데이트')).checked).toBe(false)
    expect(star().settings?.autoWorld).toBeFalsy()
  })

  it('autoWorld를 켜고 발행하면 세계관에 후보와 이력이 쌓인다', async () => {
    ownWorld()
    renderAt('/studio/starlight?tab=note')
    fireEvent.click(await box('새 회차 발행 후 세계관 자동 업데이트'))
    await toastIs('작품 설정을 변경했어요 (데모)')
    expect((await box('새 회차 발행 후 세계관 자동 업데이트')).checked).toBe(true)
    fireEvent.click(screen.getByLabelText('표기 오류 수정안 자동 승인·발행'))
    await waitFor(() => expect(star().settings).toEqual({ autoWorld: true, typoAuto: true }))
    const no = star().eps.length + 1
    fireEvent.click(screen.getByRole('button', { name: 'AI 도움' }))
    const body = await screen.findByLabelText('원고 본문')
    body.innerHTML = '<p>새벽 탑의 종이 세 번 울렸다.</p>'
    fireEvent.input(body)
    fireEvent.click(screen.getByRole('button', { name: '공개하기' }))
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '공개하기' }))
    await toastIs(`${no}화를 공개했어요`)
    const world = db().worlds.find((w) => w.id === 'my-world')!
    expect(world.facts?.at(-1)).toEqual({ text: '새벽 탑의 종이 세 번 울렸다.', source: '별빛 서약의 탑', ep: no })
    expect(world.history?.length).toBeGreaterThan(0)
    star().eps.pop()
  })

  it('표기 오류 자동 승인이 켜진 작품은 단순 오류 제보로 본문이 바로 고쳐지고 피드백함에 들어가지 않는다', async () => {
    star().settings = { autoWorld: false, typoAuto: true }
    const inbox = db().inbox.length
    renderAt('/read/starlight/2')
    fireEvent.click((await screen.findAllByText('리안은 낮게 되뇌였다.')).find((el) => el.classList.contains('s'))!)
    fireEvent.click(screen.getByRole('button', { name: '✉ 피드백 보내기' }))
    const dialog = screen.getByRole('dialog', { name: '피드백 보내기' })
    fireEvent.change(within(dialog).getByLabelText('내용'), { target: { value: '되뇌였다 오타' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '피드백 보내기' }))
    await within(dialog).findByText('처리 완료')
    within(dialog).getByText('작품 설정의 자동 승인으로 표기 오류 수정안을 발행했어요 (데모).')
    expect(star().eps[1].p[2]).toContain('되뇌었다')
    expect(db().inbox.length).toBe(inbox)
    star().eps[1].p[2] = star().eps[1].p[2].replace('되뇌었다', '되뇌였다')
  })

  it('설정 추출 후보는 반영하거나 제외할 수 있다', async () => {
    renderAt('/studio/starlight?tab=note')
    fireEvent.click(await screen.findByRole('button', { name: '설정 추출 (데모)' }))
    await toastIs('작가 소유 세계관과 발행된 회차가 필요해요')
    cleanup()
    ownWorld()
    renderAt('/studio/starlight?tab=note')
    fireEvent.change(await screen.findByLabelText('추출할 발행 회차'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: '설정 추출 (데모)' }))
    await toastIs('설정 후보를 확인해 주세요 (데모)')
    await screen.findByText('검토 대기 · 원고 발췌 예시')
    screen.getByText(star().eps[1].p[0])
    const facts = db().worlds.find((w) => w.id === 'my-world')!.facts?.length ?? 0
    fireEvent.click(screen.getByRole('button', { name: '세계관에 반영' }))
    await toastIs('채택한 후보를 세계관에 반영했어요 (데모)')
    expect(db().worlds.find((w) => w.id === 'my-world')!.facts).toHaveLength(facts + 1)
    await waitFor(() => expect(screen.queryByText('검토 대기 · 원고 발췌 예시')).toBeNull())
    fireEvent.click(screen.getByRole('button', { name: '설정 추출 (데모)' }))
    await screen.findByText('검토 대기 · 원고 발췌 예시')
    fireEvent.click(screen.getByRole('button', { name: '제외' }))
    await toastIs('후보를 제외했어요')
    await waitFor(() => expect(screen.queryByText('검토 대기 · 원고 발췌 예시')).toBeNull())
  })

  it('세계관을 연결한 원작만 독자 공개 시작 회차를 입력하고, 1 미만은 거부한다', async () => {
    renderAt('/studio/starlight?tab=note')
    await screen.findByLabelText('리안 상태')
    expect(screen.queryAllByLabelText('독자 공개 시작 회차 (비우면 비공개)')).toHaveLength(0)
    cleanup()
    ownWorld()
    renderAt('/studio/starlight?tab=note')
    const [rule] = await screen.findAllByLabelText('독자 공개 시작 회차 (비우면 비공개)')
    fireEvent.change(rule, { target: { value: '0' } })
    fireEvent.blur(rule)
    await toastIs('1 이상의 회차를 입력해 주세요')
    await waitFor(() => expect((screen.getAllByLabelText('독자 공개 시작 회차 (비우면 비공개)')[0] as HTMLInputElement).value).toBe(''))
    const again = screen.getAllByLabelText('독자 공개 시작 회차 (비우면 비공개)')[0]
    fireEvent.change(again, { target: { value: '2' } })
    fireEvent.blur(again)
    await toastIs('이 작품의 독자 공개 회차를 변경했어요 (데모)')
    expect(star().ruleFrom!['해가 지면 탑의 문은 열리지 않는다']).toBe(2)
    const ev = screen.getByLabelText('탑 앞에서 밤을 지새우다 · 공개 시작 회차 (비우면 비공개)')
    fireEvent.change(ev, { target: { value: '1' } })
    fireEvent.blur(ev)
    await toastIs('이 작품의 사건 공개 회차를 변경했어요 (데모)')
    const cast = screen.getByLabelText('세라핀 독자 공개 시작 회차 (비우면 비공개)')
    fireEvent.change(cast, { target: { value: '3' } })
    fireEvent.blur(cast)
    await toastIs('이 작품의 인물 공개 회차를 변경했어요 (데모)')
    expect(star().castFrom!['세라핀']).toBe(3)
  })

  it('독자 공개 회차는 칸을 벗어나지 않아도 change(Enter·스핀 버튼) 한 번마다 저장한다', async () => {
    ownWorld()
    renderAt('/studio/starlight?tab=note')
    const rule = (await screen.findAllByLabelText('독자 공개 시작 회차 (비우면 비공개)'))[0] as HTMLInputElement
    fireEvent.change(rule, { target: { value: '0' } })
    await toastIs('1 이상의 회차를 입력해 주세요')
    await waitFor(() => expect(rule.value).toBe(''))
    const cast = screen.getByLabelText('세라핀 독자 공개 시작 회차 (비우면 비공개)')
    fireEvent.change(cast, { target: { value: '2' } })
    await toastIs('이 작품의 인물 공개 회차를 변경했어요 (데모)')
    expect(star().castFrom!['세라핀']).toBe(2)
  })

  it('공개 회차를 저장해도 같은 입력칸이 남고 포커스가 유지된다', async () => {
    ownWorld()
    renderAt('/studio/starlight?tab=note')
    const cast = await screen.findByLabelText('세라핀 독자 공개 시작 회차 (비우면 비공개)')
    cast.focus()
    fireEvent.change(cast, { target: { value: '3' } })
    await toastIs('이 작품의 인물 공개 회차를 변경했어요 (데모)')
    await waitFor(() => expect(star().castFrom!['세라핀']).toBe(3))
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.getByLabelText('세라핀 독자 공개 시작 회차 (비우면 비공개)')).toBe(cast)
    expect(document.activeElement).toBe(cast)
  })

  it('인물 상태를 바꾸면 원작·포크에 맞게 알리고, 포크에는 원작 값을 함께 보여 준다', async () => {
    renderAt('/studio/starlight?tab=note')
    fireEvent.change(await screen.findByLabelText('리안 상태'), { target: { value: '결심' } })
    await toastIs('원작 설정을 바꿨어요')
    cleanup()
    db().works.find((w) => w.id === 'crown')!.owner = 'me'
    renderAt('/studio/crown?tab=note')
    await screen.findByText('견습 서약사 · 원작: 결심')
    fireEvent.change(screen.getByLabelText('리안 상태'), { target: { value: '의문' } })
    await toastIs('이 소설에서만 리안 상태를 ‘의문’로 바꿨어요 (원작 그대로)')
    expect(star().cast[0].st).toBe('결심')
  })
})
