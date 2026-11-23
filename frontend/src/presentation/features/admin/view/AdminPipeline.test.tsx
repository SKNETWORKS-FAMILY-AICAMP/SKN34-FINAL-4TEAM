// @vitest-environment jsdom
import '../../../../test/fixtureApp'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'

import '../../../../test/testLocks'
import { appContainer } from '../../../../app/appContainer'
import { createAppStore } from '../../../../app/store'
import { LLM_FORBIDDEN } from '../../../../domain/entities/llmOps'
import type { PipelineRecord } from '../../../../domain/entities/llmOpsPipeline'
import { AdminPage } from './AdminPage'

// 파이프라인 캔버스(react-force-graph, d3·canvas)는 jsdom에서 그리지 않는다. 캔버스가 넘기는 값은 AdminPipelineCanvas.test가 본다.
vi.mock('react-force-graph-2d', () => ({ default: () => null }))
afterEach(() => { cleanup(); vi.restoreAllMocks(); document.title = 'STORYFORK' })

const renderPipeline = (query = '') => render(
  <Provider store={createAppStore({ role: 'admin' })}>
    <MemoryRouter initialEntries={[`/admin?tab=llm&view=prompts${query}`]} useTransitions={false}><AdminPage /></MemoryRouter>
  </Provider>,
)
const llm = () => appContainer.resolve('llmOpsUseCase')
const pick = async (name: RegExp | string) => { fireEvent.click(await screen.findByRole('button', { name })) }
const panel = (node: string) => screen.findByRole('region', { name: `${node} 기록` })
const table = async (node: string) => within(await screen.findByRole('region', { name: `${node} 기록 표` }))
const dataRows = (t: ReturnType<typeof within>) => t.getAllByRole('row').slice(1)
/** 표 행의 ⋮ 버튼을 눌러 메뉴를 열고 그 안을 돌려준다(다른 행의 열린 메뉴는 바깥 누름으로 먼저 닫는다). */
const openRowMenu = (row: HTMLElement) => {
  fireEvent.pointerDown(document.body)
  fireEvent.click(within(row).getByRole('button', { name: /조치$/ }))
  return within(screen.getByRole('menu'))
}

it('프롬프트·모델 쪽은 sub가 없으면 전체(AI 파이프라인)이고, 보기 전환 링크로 프롬프트·모델을 오간다', async () => {
  renderPipeline()
  const views = within(await screen.findByRole('navigation', { name: '프롬프트·모델 보기' }))
  expect(views.getAllByRole('link').map((link) => [link.textContent, link.getAttribute('href'), link.getAttribute('aria-current')])).toEqual([
    ['전체', '/admin?tab=llm&view=prompts', 'page'], ['프롬프트', '/admin?tab=llm&view=prompts&sub=prompts', null], ['모델', '/admin?tab=llm&view=prompts&sub=models', null],
  ])
  await screen.findByRole('region', { name: 'AI 파이프라인' })
  fireEvent.click(views.getByRole('link', { name: '프롬프트' }))
  await screen.findByRole('region', { name: '프롬프트' })
  expect(screen.queryByRole('region', { name: 'AI 파이프라인' })).toBeNull()
  fireEvent.click(within(screen.getByRole('navigation', { name: '프롬프트·모델 보기' })).getByRole('link', { name: '모델' }))
  await screen.findByRole('region', { name: '모델 단가' })
  expect(screen.queryByRole('region', { name: '프롬프트' })).toBeNull()
})

it('노드는 캔버스 아래 버튼 목록(요청 흐름·단독 기능)으로도 있고 건수와 오류 수를 보이며, 오류가 있는 노드만 위험 표시를 단다', async () => {
  renderPipeline()
  const flow = within(await screen.findByRole('group', { name: '요청 흐름' }))
  const solo = within(screen.getByRole('group', { name: '단독 기능' }))
  expect([flow.getAllByRole('button').length, solo.getAllByRole('button').length]).toEqual([13, 7])
  const guard = flow.getByRole('button', { name: /Decision Guard/ })
  within(guard).getByText('104건 · 오류 1건')
  expect(guard.className).toContain('bad')
  expect(flow.getByRole('button', { name: /^집필 AI 요청/ }).className).not.toContain('bad')
  // 캔버스는 요약 이름만 가진 보조 그림이다(jsdom에서는 틀만 그린다).
  await screen.findByRole('img', { name: '집필 AI 파이프라인: 노드 20개, 오류가 있는 노드 4개' })
})

it('노드를 고르면 기록 패널이 열려 제목으로 초점이 가고, 닫으면 눌렀던 노드 버튼으로 돌아온다', async () => {
  renderPipeline()
  const button = await screen.findByRole('button', { name: /Decision Guard/ })
  fireEvent.click(button)
  const records = await panel('Decision Guard')
  await waitFor(() => expect(document.activeElement).toBe(within(records).getByRole('heading', { name: 'Decision Guard 기록' })))
  // 기록 패널은 캔버스·노드 버튼 아래에 쌓인다(옆에 두면 표가 넘쳤다).
  expect([...document.querySelector('.pipe-body')!.children].map((el) => el.className)).toEqual(['pipe-diagram', 'pipe-records'])
  expect(button.getAttribute('aria-current')).toBe('true')
  within(records).getByText(/p95 지연 820ms · 프롬프트 decision_guard\.judge/)
  fireEvent.click(within(records).getByRole('button', { name: '기록 닫기' }))
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Decision Guard 기록' })).toBeNull())
  await waitFor(() => expect(document.activeElement).toBe(button))
  expect(button.getAttribute('aria-current')).toBeNull()
})

it('Guard 기록은 결과 칸에 허용·거절과 이유·기능을, 오류는 위험 표시로 보인다', async () => {
  renderPipeline()
  await pick(/Decision Guard/)
  const rows = await table('Decision Guard')
  expect(dataRows(rows)).toHaveLength(4)
  expect(rows.getByText('허용').closest('td')!.textContent).toContain('기능 작품 질문') // 기능 코드(story_context)가 아니라 집필 채팅과 같은 표시 이름
  expect(rows.getByText('거절').closest('td')!.textContent).toContain('out_of_scope')
  expect(rows.getByText('거절').className).not.toContain('bad')
  expect(rows.getByText('오류').className).toContain('bad')
  expect(rows.getByText('통과')).toBeTruthy()
})

it('결과 필터: Guard는 서버에 level을 보내지 않고 받은 쪽에서 가려 다시 읽지 않고, 다른 노드는 level로 서버에 다시 묻는다', async () => {
  const records = vi.spyOn(llm(), 'pipelineRecords')
  renderPipeline()
  await pick(/Decision Guard/)
  const guard = await panel('Decision Guard')
  await table('Decision Guard')
  const reads = records.mock.calls.length
  fireEvent.change(within(guard).getByLabelText('결과'), { target: { value: 'ERROR' } })
  await waitFor(async () => expect(dataRows(await table('Decision Guard'))).toHaveLength(2)) // 거절 + 오류
  fireEvent.change(within(guard).getByLabelText('결과'), { target: { value: 'DEFAULT' } })
  await waitFor(async () => expect(dataRows(await table('Decision Guard'))).toHaveLength(2)) // 허용 + 통과(생성 기록)
  expect(records.mock.calls.length).toBe(reads)
  expect(records.mock.calls.every(([query]) => query.level === '')).toBe(true)
  await pick(/작품 질문/)
  const qa = await panel('작품 질문')
  fireEvent.change(within(qa).getByLabelText('결과'), { target: { value: 'ERROR' } })
  await waitFor(() => expect(records.mock.calls.at(-1)![0]).toMatchObject({ nodeId: 'qa', level: 'ERROR', page: 0 }))
  await waitFor(async () => expect(dataRows(await table('작품 질문'))).toHaveLength(1))
})

it('기록 한 줄을 펼치면 입력·출력·메타데이터를, 메인 에이전트는 도구 호출(이름·인자)까지 그대로 보인다', async () => {
  renderPipeline()
  await pick(/메인 에이전트/)
  await table('메인 에이전트')
  const toggle = () => document.querySelector<HTMLButtonElement>('.pipe-records button.pipe-toggle')!
  expect(toggle().getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(toggle())
  expect(toggle().getAttribute('aria-expanded')).toBe('true')
  const detail = within(document.querySelector<HTMLElement>('.pipe-detail')!)
  detail.getByText(/세계수의 비밀을 알려줘/)
  detail.getByText('스토리 Q&A로 조회할게요.')
  detail.getByText('도구 호출')
  detail.getByText('ask_story_qa')
  detail.getByText(/"request": "세계수의 비밀"/)
  detail.getByText('메타데이터')
  fireEvent.click(toggle())
  expect(document.querySelector('.pipe-detail')).toBeNull()
})

it('Guard 기록의 펼침은 메타데이터를 판정 근거로 이름 붙인다', async () => {
  renderPipeline()
  await pick(/Decision Guard/)
  await table('Decision Guard')
  fireEvent.click(document.querySelector<HTMLButtonElement>('.pipe-records button.pipe-toggle')!)
  within(document.querySelector<HTMLElement>('.pipe-detail')!).getByText('판정 근거(메타데이터)')
})

it('실행 흐름 보기는 그 기록이 속한 작업의 observation을 부모 아래 자식으로 들여 쓴 트리로 보이고, 단계마다 입력·출력을 펼친다', async () => {
  renderPipeline()
  await pick(/메인 에이전트/)
  const rows = await table('메인 에이전트')
  fireEvent.click(openRowMenu(dataRows(rows)[0]).getByRole('menuitem', { name: '실행 흐름 보기' }))
  const flow = await screen.findByRole('region', { name: '실행 흐름' })
  await waitFor(() => expect(document.activeElement).toBe(within(flow).getByRole('heading', { name: '실행 흐름' })))
  const steps = await within(flow).findAllByRole('listitem')
  expect(steps.map((step) => step.querySelector('b')?.textContent)).toEqual(['retrieve', 'generate'])
  expect([steps[0].getAttribute('style'), steps[1].getAttribute('style')]).toEqual([expect.stringContaining('--depth: 0'), expect.stringContaining('--depth: 1')])
  within(steps[1]).getByText('입력·출력')
  fireEvent.click(within(flow).getByRole('button', { name: '실행 흐름 닫기' }))
  expect(screen.queryByRole('region', { name: '실행 흐름' })).toBeNull()
})

it('프롬프트 보기는 그 노드의 프롬프트 상세(프롬프트 보기 sub)로 옮겨 열고, 상세가 열린 동안은 보기 전환을 숨긴다', async () => {
  renderPipeline()
  await pick(/Decision Guard/)
  const rows = await table('Decision Guard')
  fireEvent.click(openRowMenu(dataRows(rows)[0]).getByRole('menuitem', { name: '프롬프트 보기' }))
  const detail = await screen.findByLabelText('프롬프트 상세')
  await within(detail).findByRole('heading', { name: 'decision_guard.judge' })
  expect(screen.queryByRole('navigation', { name: '프롬프트·모델 보기' })).toBeNull()
  expect(screen.queryByRole('region', { name: 'AI 파이프라인' })).toBeNull()
  fireEvent.click(within(detail).getByRole('button', { name: '프롬프트 목록으로' }))
  const views = within(await screen.findByRole('navigation', { name: '프롬프트·모델 보기' }))
  expect(views.getByRole('link', { name: '프롬프트' }).getAttribute('aria-current')).toBe('page')
})

it('조회 권한(llm)이 없으면(403) 파이프라인도 노드 기록도 다시 불러오기 없이 권한 안내만 보인다', async () => {
  vi.spyOn(llm(), 'pipelineRecords').mockResolvedValue(null)
  renderPipeline()
  await pick(/Decision Guard/)
  const guard = await panel('Decision Guard')
  await within(guard).findByText(LLM_FORBIDDEN)
  expect(within(guard).queryByRole('table')).toBeNull()
  expect(screen.queryByRole('button', { name: '다시 불러오기' })).toBeNull()
  cleanup()
  vi.spyOn(llm(), 'pipeline').mockResolvedValue(null)
  renderPipeline()
  await screen.findByText(LLM_FORBIDDEN)
  expect(screen.queryByRole('group', { name: '요청 흐름' })).toBeNull()
  expect(screen.queryByRole('button', { name: '다시 불러오기' })).toBeNull()
})

it('조회가 실패하면 빈 화면으로 숨기지 않고 다시 불러오기를 보인다', async () => {
  const pipeline = vi.spyOn(llm(), 'pipeline').mockRejectedValue(new Error('조회 실패'))
  renderPipeline()
  await screen.findByText(/AI 파이프라인 현황을 불러오지 못했어요/)
  expect(screen.queryByRole('group', { name: '요청 흐름' })).toBeNull()
  pipeline.mockRestore()
  fireEvent.click(screen.getByRole('button', { name: '다시 불러오기' }))
  await screen.findByRole('group', { name: '요청 흐름' })
  expect(screen.queryByText(/불러오지 못했어요/)).toBeNull()
})

it('기간은 기본 최근 7일이고 바꾸면 그 구간으로 다시 읽는다', async () => {
  const pipeline = vi.spyOn(llm(), 'pipeline')
  renderPipeline()
  await screen.findByRole('group', { name: '요청 흐름' })
  const span = () => { const [query] = pipeline.mock.calls.at(-1)!; return Date.parse(query.to) - Date.parse(query.from) }
  expect(span()).toBe(7 * 24 * 3_600_000)
  fireEvent.change(screen.getByLabelText('기간'), { target: { value: String(30 * 24) } })
  await waitFor(() => expect(span()).toBe(30 * 24 * 3_600_000))
})

it('기록은 20건씩 쪽을 넘기며 읽고, 다른 노드를 고르면 첫 쪽부터 다시 읽는다', async () => {
  const item = (id: string): PipelineRecord => ({ id, traceId: 'trace-1', name: 'decision_guard', type: 'SPAN', startTime: '2026-11-21T01:00:00Z', latencyMs: 100, level: 'DEFAULT' })
  const records = vi.spyOn(llm(), 'pipelineRecords').mockResolvedValue({ items: [item('a'), item('b')], page: 0, size: 20, total: 45, unavailable: [] })
  renderPipeline()
  await pick(/Decision Guard/)
  await screen.findByText(/전체 45건 · 1\/3쪽/)
  fireEvent.click(screen.getByRole('button', { name: '다음' }))
  await waitFor(() => expect(records.mock.calls.at(-1)![0]).toMatchObject({ nodeId: 'guard', page: 1 }))
  await pick(/메인 에이전트/)
  await waitFor(() => expect(records.mock.calls.at(-1)![0]).toMatchObject({ nodeId: 'main', page: 0 }))
})

it('서버는 기록을 최신 1,000건까지만 주므로 그 밖의 쪽으로는 넘기지 못하게 하고 안내한다', async () => {
  const item: PipelineRecord = { id: 'a', traceId: 'trace-1', name: 'decision_guard', type: 'SPAN', startTime: '2026-11-21T01:00:00Z', latencyMs: 100, level: 'DEFAULT' }
  vi.spyOn(llm(), 'pipelineRecords').mockResolvedValue({ items: [item], page: 49, size: 20, total: 3000, unavailable: [] })
  renderPipeline()
  await pick(/Decision Guard/)
  await screen.findByText(/전체 3,000건 · 50\/50쪽/)
  expect((screen.getByRole('button', { name: '다음' }) as HTMLButtonElement).disabled).toBe(true)
  screen.getByText(/최신 1,000건까지만 볼 수 있어요/)
})

it('NovelBrain 기억 회상 노드는 인물 시뮬레이션 바로 뒤에 이어지고, 기록을 펼치면 회상한 기억(recalled)의 제목 목록을 보인다', async () => {
  renderPipeline()
  const flow = within(await screen.findByRole('group', { name: '요청 흐름' }))
  const labels = flow.getAllByRole('button').map((button) => button.querySelector('b')?.textContent)
  expect(labels.indexOf('NovelBrain 기억 회상')).toBe(labels.indexOf('인물 시뮬레이션') + 1)
  await pick(/NovelBrain 기억 회상/)
  await table('NovelBrain 기억 회상')
  fireEvent.click(document.querySelector<HTMLButtonElement>('.pipe-records button.pipe-toggle')!)
  const detail = within(document.querySelector<HTMLElement>('.pipe-detail')!)
  detail.getByText('회상한 기억')
  // 카드 항목은 제목에 ref의 문서 조각(정체·성격·목표)을 붙이고, 관계·원고 항목은 제목이 없어 ref로 보인다.
  expect(detail.getAllByRole('listitem').map((item) => item.textContent)).toEqual(['세계수 · 정체', 'relation:r-kl', 'manuscript:m1'])
  // 회상이 없는 기록은 빈 목록 대신 '없음'을 보인다.
  fireEvent.click(document.querySelector<HTMLButtonElement>('.pipe-records button.pipe-toggle')!)
  fireEvent.click(document.querySelectorAll<HTMLButtonElement>('.pipe-records button.pipe-toggle')[1])
  within(document.querySelector<HTMLElement>('.pipe-detail')!).getByText('없음')
})

it('지연은 같은 밀리초 안에 끝난 기록(0)을 1ms 미만으로, 종료 시각이 없어 모르는 기록을 —로 보이고, 실행 흐름의 단계도 같다', async () => {
  const at = '2026-11-21T01:00:00Z'
  const item = (id: string, latencyMs: number | null): PipelineRecord => ({ id, traceId: 'trace-1', name: 'novelbrain.recall', type: 'RETRIEVER', startTime: at, latencyMs, level: 'DEFAULT' })
  vi.spyOn(llm(), 'pipelineRecords').mockResolvedValue({ items: [item('a', 0), item('b', null), item('c', 250)], page: 0, size: 20, total: 3, unavailable: [] })
  // 실행 흐름의 단계는 종료 시각이 없어도 지연 0으로 오므로, 0이어도 종료 시각이 없으면 1ms 미만이 아니라 모르는 값이다.
  vi.spyOn(llm(), 'trace').mockResolvedValue({
    id: 'trace-1', timestamp: at, feature: 'orchestration', status: 'success',
    observations: [
      { id: 'o1', name: 'novelbrain.recall', type: 'RETRIEVER', startTime: at, endTime: at, latencyMs: 0, level: 'DEFAULT' },
      { id: 'o2', name: 'simulation.turn', type: 'SPAN', startTime: at, endTime: null, latencyMs: 0, level: 'DEFAULT' },
    ],
  })
  renderPipeline()
  await pick(/NovelBrain 기억 회상/)
  const rows = dataRows(await table('NovelBrain 기억 회상'))
  expect(rows.map((row: HTMLElement) => within(row).getAllByRole('cell')[3].textContent)).toEqual(['1ms 미만', '—', '250ms'])
  fireEvent.click(openRowMenu(rows[0]).getByRole('menuitem', { name: '실행 흐름 보기' }))
  const flow = within(await screen.findByRole('region', { name: '실행 흐름' }))
  await flow.findByText('RETRIEVER · 1ms 미만')
  flow.getByText('SPAN · —')
})
