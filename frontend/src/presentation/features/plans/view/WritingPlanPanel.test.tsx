// @vitest-environment jsdom
// React/Hook 조립은 CI 통합 계층에서 실행한다.
import { useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'
import { createAppStore } from '../../../../app/store'
import { createFixtureDb } from '../../../../data/mock/fixtureDb'
import { InMemoryWorkRepository } from '../../../../data/mock/InMemoryRepositories'
import { InMemoryStoryPlanRepository } from '../../../../data/plans/InMemoryStoryPlanRepository'
import { StoryPlanUseCase } from '../../../../domain/usecases/StoryPlanUseCase'
import { useStoryPlanViewModel } from '../viewmodel/useStoryPlanViewModel'
import { useWritingPlanNavigation } from '../../studio/viewmodel/useWritingPlanNavigation'
import { StoryPlanPanel } from './StoryPlanWorkspace'

afterEach(() => { cleanup(); vi.restoreAllMocks() })
function Host({ api }: { api: StoryPlanUseCase }) {
  const vm = useStoryPlanViewModel('starlight', true, api, true)
  const [advanced, setAdvanced] = useState(true)
  const [body, setBody] = useState('')
  useWritingPlanNavigation(() => vm.confirmLeave() && (!body || window.confirm('원고를 버릴까요?')), vm.dirty || !!body, vm.busy)
  return <>
    <header className="sbar"><button onClick={() => setAdvanced(!advanced)}>모드 전환</button><button>원고 저장</button><a href="/away">이탈</a></header>
    <textarea aria-label="원고" value={body} onChange={e => setBody(e.target.value)} />
    <div hidden={!advanced}><StoryPlanPanel workId="starlight" vm={vm} episode={2} /></div>
    <output aria-label="시뮬레이션 잠금">{vm.startBlocker}</output>
    <output aria-label="계획 갱신">{vm.version}</output>
  </>
}
async function setup() {
  const db = createFixtureDb()
  db.works.find(w => w.id === 'starlight')!.owner = 'me'
  const api = new StoryPlanUseCase(new InMemoryStoryPlanRepository(new InMemoryWorkRepository(db)))
  await api.save('starlight', { kind: 'plot', parentId: null, title: '귀환', content: '', episodeNumber: null, characterIds: [], placeIds: [] })
  render(<Provider store={createAppStore({ role: 'user' })}><MemoryRouter><Host api={api} /></MemoryRouter></Provider>)
  await waitFor(() => expect(screen.getByRole('button', { name: '장면 계획 추가' })).toHaveProperty('disabled', false))
  fireEvent.click(screen.getByRole('button', { name: '장면 계획 추가' }))
  fireEvent.change(screen.getByLabelText('장면 제목'), { target: { value: '다시 만남' } })
  fireEvent.change(screen.getByLabelText('계획 내용'), { target: { value: '남겨 둘 입력' } })
  return api
}

it('열린 회차를 기본 지정하고 모드 전환·원고 저장 버튼에서도 계획 입력을 보존한다', async () => {
  await setup()
  const confirm = vi.spyOn(window, 'confirm')
  expect(screen.getByLabelText('연결 회차')).toHaveProperty('value', '2')
  const input = screen.getByLabelText('계획 내용')
  fireEvent.click(screen.getByRole('button', { name: '모드 전환' }))
  fireEvent.click(screen.getByRole('button', { name: '원고 저장' }))
  fireEvent.click(screen.getByRole('button', { name: '모드 전환' }))
  expect(screen.getByLabelText('계획 내용')).toBe(input)
  expect(input).toHaveProperty('value', '남겨 둘 입력')
  expect(confirm).not.toHaveBeenCalled()
  expect(screen.getByLabelText('시뮬레이션 잠금').textContent).toContain('저장하지 않은 계획')
})

it('계획 이탈 확인 후 원고 이탈을 취소해도 양쪽 입력이 모두 남는다', async () => {
  await setup()
  fireEvent.change(screen.getByLabelText('원고'), { target: { value: '보존할 원고' } })
  vi.spyOn(window, 'confirm').mockReturnValueOnce(true).mockReturnValueOnce(false)
  expect(fireEvent.click(screen.getByRole('link', { name: '이탈' }))).toBe(false)
  expect(screen.getByLabelText('원고')).toHaveProperty('value', '보존할 원고')
  expect(screen.getByLabelText('계획 내용')).toHaveProperty('value', '남겨 둘 입력')
})

it('저장 실패는 입력과 실행 잠금을 유지하고 성공한 재시도만 갱신을 알린다', async () => {
  const api = await setup()
  vi.spyOn(api, 'save').mockRejectedValueOnce(new Error('편집 충돌'))
  fireEvent.click(screen.getByRole('button', { name: '저장' }))
  await screen.findByText('편집 충돌')
  expect(screen.getByLabelText('계획 내용')).toHaveProperty('value', '남겨 둘 입력')
  expect(screen.getByLabelText('계획 갱신').textContent).toBe('0')
  fireEvent.click(screen.getByRole('button', { name: '저장' }))
  await waitFor(() => expect(screen.getByLabelText('계획 갱신').textContent).toBe('1'))
  await waitFor(() => expect(screen.getByLabelText('시뮬레이션 잠금').textContent).toBe(''))
  expect((await api.list('starlight')).find(p => p.kind === 'scene')).toMatchObject({ title: '다시 만남', episodeNumber: 2 })
})

it('인라인 편집을 취소하면 편집을 연 버튼으로 초점이 돌아온다', async () => {
  await setup()
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  fireEvent.click(screen.getByRole('button', { name: '취소' }))
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: '장면 계획 추가' })))
})

it('이동 저장 뒤 목록 재조회가 실패하면 저장 완료를 알리고 다시 불러올 때까지 순서 변경을 잠근다', async () => {
  const api = await setup()
  fireEvent.click(screen.getByRole('button', { name: '저장' }))
  await waitFor(() => expect(screen.getByLabelText('계획 갱신').textContent).toBe('1'))
  fireEvent.click(screen.getByRole('button', { name: '장면 계획 추가' }))
  fireEvent.change(screen.getByLabelText('장면 제목'), { target: { value: '두번째' } })
  fireEvent.click(screen.getByRole('button', { name: '저장' }))
  await waitFor(() => expect(screen.getByLabelText('계획 갱신').textContent).toBe('2'))
  vi.spyOn(api, 'list').mockRejectedValueOnce(new Error('목록 실패'))
  fireEvent.click(screen.getByRole('button', { name: '두번째 위로 이동' }))
  await screen.findByText('목록 실패')
  expect(screen.getByText('장면 순서를 저장했어요.')).toBeTruthy()
  expect(screen.getByRole('button', { name: '다시 만남 위로 이동' })).toHaveProperty('disabled', true)
})

it('편집한 장면이 현재 회차 목록에서 빠지면 장면 계획 추가로 초점을 돌린다', async () => {
  await setup()
  fireEvent.click(screen.getByRole('button', { name: '저장' }))
  await waitFor(() => expect(screen.getByLabelText('계획 갱신').textContent).toBe('1'))
  fireEvent.click(screen.getByText('다시 만남').closest('button')!)
  fireEvent.change(await screen.findByLabelText('연결 회차'), { target: { value: '' } })
  fireEvent.click(screen.getByRole('button', { name: '저장' }))
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: '장면 계획 추가' })))
})
