// @vitest-environment jsdom
import '../../../../test/fixtureApp'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { Provider } from 'react-redux'
import { MemoryRouter, useNavigate } from 'react-router'
import { afterEach, expect, it, vi } from 'vitest'

import '../../../../test/testLocks'
import { appContainer } from '../../../../app/appContainer'
import { createAppStore } from '../../../../app/store'
import { PIPELINE_FLOWS } from '../../../../domain/entities/admin'
import { LLM_FORBIDDEN } from '../../../../domain/entities/llmOps'
import { FLOW_DEFS } from '../../../../domain/entities/llmOpsFlows'
import type { PipelineRecord } from '../../../../domain/entities/llmOpsPipeline'
import { AdminPage } from './AdminPage'

// 파이프라인 캔버스(react-force-graph, d3·canvas)는 jsdom에서 그리지 않는다. 캔버스가 넘기는 값은 AdminPipelineCanvas.test가 본다.
vi.mock('react-force-graph-2d', () => ({ default: () => null }))
afterEach(() => { cleanup(); vi.restoreAllMocks(); document.title = 'STORYFORK' })

// AI 파이프라인은 프롬프트·평가 쪽의 첫 보기(전체)라 sub가 없어도 열린다(#857: 전체가 가장 왼쪽·기본 보기).
const renderPipeline = (query = '') => render(
  <Provider store={createAppStore({ role: 'admin' })}>
    <MemoryRouter initialEntries={[`/admin?tab=llm&view=prompts${query}`]} useTransitions={false}><AdminPage /></MemoryRouter>
  </Provider>,
)
const llm = () => appContainer.resolve('llmOpsUseCase')
// 노드 버튼은 이름이 노드 이름으로 시작한다(같은 이름을 품은 '프롬프트 보기' 버튼과 겹치지 않게 시작을 고정한다).
const pick = async (label: string) => { fireEvent.click(await screen.findByRole('button', { name: new RegExp(`^${label}`) })) }
const panel = (node: string) => screen.findByRole('region', { name: `${node} 기록` })
const table = async (node: string) => within(await screen.findByRole('region', { name: `${node} 기록 표` }))
const dataRows = (t: ReturnType<typeof within>) => t.getAllByRole('row').slice(1)
/** 표 행의 ⋮ 버튼을 눌러 메뉴를 열고 그 안을 돌려준다(다른 행의 열린 메뉴는 바깥 누름으로 먼저 닫는다). */
const openRowMenu = (row: HTMLElement) => {
  fireEvent.pointerDown(document.body)
  fireEvent.click(within(row).getByRole('button', { name: /조치$/ }))
  return within(screen.getByRole('menu'))
}

it('AI 파이프라인(전체)은 프롬프트·평가 쪽의 가장 왼쪽·기본 보기이고, 보기 전환 링크로 에이전트별 평가·프롬프트·모델을 오간다', async () => {
  renderPipeline()
  const views = within(await screen.findByRole('navigation', { name: '프롬프트·평가 보기' }))
  expect(views.getAllByRole('link').map((link) => [link.textContent, link.getAttribute('href'), link.getAttribute('aria-current')])).toEqual([
    ['전체(AI 파이프라인)', '/admin?tab=llm&view=prompts', 'page'], ['에이전트별 평가', '/admin?tab=llm&view=prompts&sub=evals', null],
    ['프롬프트', '/admin?tab=llm&view=prompts&sub=prompts', null], ['모델', '/admin?tab=llm&view=prompts&sub=models', null],
  ])
  await screen.findByRole('region', { name: 'AI 파이프라인' })
  fireEvent.click(views.getByRole('link', { name: '프롬프트' }))
  await screen.findByRole('region', { name: '프롬프트' })
  expect(screen.queryByRole('region', { name: 'AI 파이프라인' })).toBeNull()
  fireEvent.click(within(screen.getByRole('navigation', { name: '프롬프트·평가 보기' })).getByRole('link', { name: '모델' }))
  await screen.findByRole('region', { name: '모델 단가' })
  expect(screen.queryByRole('region', { name: '프롬프트' })).toBeNull()
  fireEvent.click(within(screen.getByRole('navigation', { name: '프롬프트·평가 보기' })).getByRole('link', { name: '에이전트별 평가' }))
  await screen.findByRole('region', { name: '에이전트별 평가' })
  expect(screen.queryByRole('region', { name: '모델 단가' })).toBeNull()
})

it('노드는 캔버스 아래 버튼 목록(요청 흐름·단독 기능)으로도 있고 건수와 오류 수를 보이며, 오류가 있는 노드만 위험 표시를 단다', async () => {
  renderPipeline()
  const flow = within(await screen.findByRole('group', { name: '요청 흐름' }))
  const solo = within(screen.getByRole('group', { name: '단독 기능' }))
  const nodeButtons = (group: ReturnType<typeof within>) => group.getAllByRole('button').filter((button: HTMLElement) => button.classList.contains('pipe-node'))
  expect([nodeButtons(flow).length, nodeButtons(solo).length]).toEqual([13, 7])
  const guard = flow.getByRole('button', { name: /^Decision Guard/ })
  within(guard).getByText('104건 · 오류 1건')
  expect(guard.className).toContain('bad')
  expect(flow.getByRole('button', { name: /^집필 AI 요청/ }).className).not.toContain('bad')
  // 캔버스는 요약 이름만 가진 보조 그림이다(jsdom에서는 틀만 그린다).
  await screen.findByRole('img', { name: '집필 AI 파이프라인: 노드 20개, 오류가 있는 노드 5개' })
})

it('노드를 고르면 기록 패널이 열려 제목으로 초점이 가고, 닫으면 눌렀던 노드 버튼으로 돌아온다', async () => {
  renderPipeline()
  const button = await screen.findByRole('button', { name: /^Decision Guard/ })
  fireEvent.click(button)
  const records = await panel('Decision Guard')
  await waitFor(() => expect(document.activeElement).toBe(within(records).getByRole('heading', { name: 'Decision Guard 기록' })))
  // 기록 패널은 캔버스·노드 버튼 아래에 쌓인다(옆에 두면 표가 넘쳤다).
  expect([...document.querySelector('.pipe-body')!.children].map((el) => el.className)).toEqual(['pipe-diagram', 'pipe-records'])
  expect(button.getAttribute('aria-current')).toBe('true')
  within(records).getByText(/p95 지연 820ms · 프롬프트 Decision Guard · 요청 판정\(judge\)/)
  expect(records.querySelector('p.muted small.prompt-code')?.textContent).toBe('decision_guard.judge')   // 코드는 작은 보조 글씨
  fireEvent.click(within(records).getByRole('button', { name: '기록 닫기' }))
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Decision Guard 기록' })).toBeNull())
  await waitFor(() => expect(document.activeElement).toBe(button))
  expect(button.getAttribute('aria-current')).toBeNull()
})

it('Guard 기록은 결과 칸에 허용·거절과 이유·기능을, 오류는 위험 표시로 보인다', async () => {
  renderPipeline()
  await pick('Decision Guard')
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
  await pick('Decision Guard')
  const guard = await panel('Decision Guard')
  await table('Decision Guard')
  const reads = records.mock.calls.length
  fireEvent.change(within(guard).getByLabelText('결과'), { target: { value: 'ERROR' } })
  await waitFor(async () => expect(dataRows(await table('Decision Guard'))).toHaveLength(2)) // 거절 + 오류
  fireEvent.change(within(guard).getByLabelText('결과'), { target: { value: 'DEFAULT' } })
  await waitFor(async () => expect(dataRows(await table('Decision Guard'))).toHaveLength(2)) // 허용 + 통과(생성 기록)
  expect(records.mock.calls.length).toBe(reads)
  expect(records.mock.calls.every(([query]) => query.level === '')).toBe(true)
  await pick('작품 질문')
  const qa = await panel('작품 질문')
  fireEvent.change(within(qa).getByLabelText('결과'), { target: { value: 'ERROR' } })
  await waitFor(() => expect(records.mock.calls.at(-1)![0]).toMatchObject({ nodeId: 'qa', level: 'ERROR', page: 0 }))
  await waitFor(async () => expect(dataRows(await table('작품 질문'))).toHaveLength(1))
})

it('기록 한 줄을 펼치면 입력·출력·메타데이터를, 메인 에이전트는 도구 호출(이름·인자)까지 그대로 보인다', async () => {
  renderPipeline()
  await pick('메인 에이전트')
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
  await pick('Decision Guard')
  await table('Decision Guard')
  fireEvent.click(document.querySelector<HTMLButtonElement>('.pipe-records button.pipe-toggle')!)
  within(document.querySelector<HTMLElement>('.pipe-detail')!).getByText('판정 근거(메타데이터)')
})

it('실행 흐름 보기는 그 기록이 속한 작업의 observation을 부모 아래 자식으로 들여 쓴 트리로 보이고, 단계마다 입력·출력을 펼친다', async () => {
  renderPipeline()
  await pick('메인 에이전트')
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
  await pick('Decision Guard')
  const rows = await table('Decision Guard')
  fireEvent.click(openRowMenu(dataRows(rows)[0]).getByRole('menuitem', { name: '프롬프트 보기' }))
  const detail = await screen.findByLabelText('프롬프트 상세')
  await within(detail).findByRole('heading', { name: /^Decision Guard · 요청 판정\(judge\) decision_guard\.judge$/ })
  expect(screen.queryByRole('navigation', { name: '프롬프트·평가 보기' })).toBeNull()
  expect(screen.queryByRole('region', { name: 'AI 파이프라인' })).toBeNull()
  fireEvent.click(within(detail).getByRole('button', { name: '프롬프트 목록으로' }))
  const views = within(await screen.findByRole('navigation', { name: '프롬프트·평가 보기' }))
  expect(views.getByRole('link', { name: '프롬프트' }).getAttribute('aria-current')).toBe('page')
})

it('프롬프트가 연결된 노드는 노드 버튼 목록에 \'프롬프트 보기\'가 있다: 하나면 버튼, 여럿이면 목록 메뉴, 없으면 버튼이 없고, 고르면 그 프롬프트의 상세(개선 루프)를 연다(#857)', async () => {
  renderPipeline()
  const flow = within(await screen.findByRole('group', { name: '요청 흐름' }))
  const solo = within(screen.getByRole('group', { name: '단독 기능' }))
  // 프롬프트가 없는 노드(요청·NovelBrain·MCP·승인 반영)에는 버튼이 없다.
  for (const label of ['집필 AI 요청', 'NovelBrain 기억 회상', 'Content MCP 도구', '작가 승인 반영']) expect(flow.queryByRole('button', { name: new RegExp(`^프롬프트 보기 · ${label}`) }), label).toBeNull()
  // 하나: 버튼(이름에 노드와 한국어 프롬프트 이름). 노드를 고르는 버튼과 따로다.
  const guard = flow.getByRole('button', { name: '프롬프트 보기 · Decision Guard · Decision Guard · 요청 판정(judge)' })
  expect(guard.textContent).toBe('프롬프트 보기')
  expect(guard.getAttribute('aria-haspopup')).toBeNull()
  // 여럿: 목록 메뉴(항목은 프롬프트마다 한국어 이름).
  expect(flow.queryByRole('button', { name: '프롬프트 보기 · 인물 시뮬레이션 · 인물 시뮬레이션 · 인물 대사(act)' })).toBeNull()
  fireEvent.click(flow.getByRole('button', { name: '프롬프트 보기 · 인물 시뮬레이션' }))
  const menu = within(screen.getByRole('menu', { name: '프롬프트 보기 · 인물 시뮬레이션' }))
  expect(menu.getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
    '인물 시뮬레이션 · 인물 대사(act)', '인물 시뮬레이션 · 문단 검사(check)', '인물 시뮬레이션 · 장면 연출(direct)', '인물 시뮬레이션 · 나레이션·독백(narrate)', '인물 시뮬레이션 · 시뮬레이션 계획(plan)',
  ])
  fireEvent.click(menu.getByRole('menuitem', { name: '인물 시뮬레이션 · 인물 대사(act)' }))
  const detail = await screen.findByLabelText('프롬프트 상세')
  await within(detail).findByRole('heading', { name: /^인물 시뮬레이션 · 인물 대사\(act\) character_simulation\.act$/ })
  expect(screen.queryByRole('region', { name: 'AI 파이프라인' })).toBeNull()
  cleanup()
  // 단독 기능 노드도 같다(한 프롬프트 노드는 버튼, 둘인 노드는 메뉴).
  renderPipeline()
  const soloNow = within(await screen.findByRole('group', { name: '단독 기능' }))
  fireEvent.click(soloNow.getByRole('button', { name: '프롬프트 보기 · 전개 제안 · 이어쓰기 제안 · 다음 문단 제안(continue)' }))
  await within(await screen.findByLabelText('프롬프트 상세')).findByRole('heading', { name: /다음 문단 제안\(continue\)/ })
  expect(solo).toBeTruthy()
})

it('프롬프트 연결이 없는 노드의 기록 머리글은 프롬프트 없음이고, 있는 노드는 한국어 이름(작은 코드)을 / 로 이어 보인다(#857)', async () => {
  renderPipeline()
  await pick('Content MCP 도구')
  within(await panel('Content MCP 도구')).getByText(/p95 지연 640ms · 프롬프트 없음/)
  await pick('작품 질문')
  const qa = within(await panel('작품 질문'))
  qa.getByText(/프롬프트 Q&A · 작품 질문 답변\(answer\)/)
  await pick('원고 검수')
  const review = within(await panel('원고 검수'))
  review.getByText(/프롬프트 Manuscript Review · 수치·표기·맞춤법 검수\(mechanical\) \/ Manuscript Review · 설정 충돌·인과 검수\(semantic\)/)
})

it('기록 표의 프롬프트 칸은 한국어 이름(작은 코드)과 버전이고, 기록 줄 메뉴의 프롬프트 보기도 한국어 이름을 쓴다(#857)', async () => {
  renderPipeline()
  await pick('Decision Guard')
  const rows = dataRows(await table('Decision Guard'))
  const generation = rows.find((row: HTMLElement) => row.textContent?.includes('decision_guard.generation')) as HTMLElement
  expect(within(generation).getAllByRole('cell')[5].textContent).toBe('Decision Guard · 요청 판정(judge) decision_guard.judge v1')
  // 기록에 프롬프트가 있으면 그 하나만 대상이라 이름 없이 '프롬프트 보기'이고, 기록에 없어 노드의 프롬프트가 여럿이면 프롬프트마다 항목을 둔다.
  cleanup()
  renderPipeline()
  await pick('인물 시뮬레이션')
  const sim = dataRows(await table('인물 시뮬레이션'))
  expect(openRowMenu(sim[0]).getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['실행 흐름 보기', '프롬프트 보기'])
  cleanup()
  renderPipeline()
  await pick('세계관')
  const world = dataRows(await table('세계관'))
  expect(openRowMenu(world[0]).getAllByRole('menuitem').map((item) => item.textContent)).toEqual([
    '실행 흐름 보기', '프롬프트 보기 · World · 설정집 오류 검토(check)', '프롬프트 보기 · World · 설정집 보강(enrich)', '프롬프트 보기 · World · 설정 변경 영향 분석(impact)',
  ])
})

const nodeButtons = (group: HTMLElement) => within(group).getAllByRole('button').filter((button) => button.classList.contains('pipe-node')).map((button) => [button.querySelector('b')?.textContent, button.querySelector('span')?.textContent])

it('캔버스 위 드롭다운으로 워크플로우를 고른다: 전체가 기본이고 선택은 주소(flow)에 남으며 없거나 모르는 값은 전체다(#857 3차)', async () => {
  renderPipeline()
  const select = await screen.findByLabelText<HTMLSelectElement>('워크플로우')
  expect([...select.options].map((o) => [o.value, o.text])).toEqual([
    ['all', '전체'], ['simulation', '인물 시뮬레이션'], ['preprocessing', '원고 전처리'], ['review', '원고 검수'], ['research', '고증 조사'], ['writing', '기획·집필·수정'],
  ])
  expect(select.value).toBe('all')
  screen.getByRole('img', { name: /^집필 AI 파이프라인: 노드 20개/ })
  cleanup()
  renderPipeline('&flow=simulation')
  expect((await screen.findByLabelText<HTMLSelectElement>('워크플로우')).value).toBe('simulation')
  cleanup()
  renderPipeline('&flow=nope')
  expect((await screen.findByLabelText<HTMLSelectElement>('워크플로우')).value).toBe('all')
})

it('흐름을 고르면 같은 자리에 그 흐름의 단계만 그리고(캔버스 요약·노드 버튼 목록), 서버 노드와 1:1인 단계만 건수를 보이며, 전체로 돌아오면 서버 노드 흐름이 다시 보인다(#857 3차)', async () => {
  renderPipeline()
  fireEvent.change(await screen.findByLabelText('워크플로우'), { target: { value: 'simulation' } })
  const steps = await screen.findByRole('group', { name: '인물 시뮬레이션 내부 흐름' })
  expect(nodeButtons(steps)).toEqual([
    ['계획', 'LLM 호출'], ['연출 결정', 'LLM 호출'], ['NovelBrain 기억 회상', '18건 · 오류 0건'], ['턴 쓰기', 'LLM 호출'], ['검사', 'LLM 호출'], ['작가 승인·초안 반영', 'LLM 아님'],
  ])
  screen.getByRole('img', { name: '인물 시뮬레이션 내부 흐름: 단계 6개, 건수·오류가 있는 단계 1개(나머지는 서버 노드가 없어 이름만)' })
  expect(screen.queryByRole('group', { name: '요청 흐름' })).toBeNull()
  expect(screen.queryByRole('group', { name: '단독 기능' })).toBeNull()
  fireEvent.change(screen.getByLabelText('워크플로우'), { target: { value: 'all' } })
  await screen.findByRole('group', { name: '요청 흐름' })
  screen.getByRole('img', { name: /^집필 AI 파이프라인: 노드 20개/ })
})

it('모든 워크플로우가 정의한 단계를 노드 버튼 목록에 순서대로 그린다(구조용 단계는 점선 표시)', async () => {
  for (const [key, label] of PIPELINE_FLOWS.filter(([k]) => k !== 'all')) {
    renderPipeline(`&flow=${key}`)
    const group = await screen.findByRole('group', { name: `${label} 내부 흐름` })
    expect(nodeButtons(group).map(([name]) => name), key).toEqual(FLOW_DEFS[key as keyof typeof FLOW_DEFS].steps.map((s) => s.label))
    const buttons = within(group).getAllByRole('button').filter((b) => b.classList.contains('pipe-node'))
    expect(buttons.filter((b) => b.classList.contains('structural')).length, key).toBe(FLOW_DEFS[key as keyof typeof FLOW_DEFS].steps.filter((s) => !s.server).length)
    cleanup()
  }
})

it('흐름 화면에는 설명과 서버 집계(그 흐름이 속한 서버 노드)가 보이고, 집계 기록 보기는 그 서버 노드의 기록 패널을 연다(#857 3차)', async () => {
  renderPipeline('&flow=simulation')
  await screen.findByRole('group', { name: '인물 시뮬레이션 내부 흐름' })
  screen.getByText(/장면은 한 턴씩 씁니다/)
  const aggregate = screen.getByText(/서버는 이 흐름의 LLM 단계를 ‘인물 시뮬레이션’ 한 노드로 함께 세요/)
  expect(aggregate.textContent).toContain('2건 · 오류 0건')
  fireEvent.click(within(aggregate.closest('p') as HTMLElement).getByRole('button', { name: '집계 기록 보기' }))
  const records = await panel('인물 시뮬레이션')
  await table('인물 시뮬레이션')
  expect(within(records).queryByRole('button', { name: '내부 흐름 보기' })).toBeNull()   // 이미 그 흐름 안이다
})

it('구조용 단계를 고르면 서버에 기록을 묻지 않고 단계 설명(LLM 여부·설명·프롬프트)만 보이고, 서버 노드와 1:1인 단계는 기록 패널이 열린다(#857 3차)', async () => {
  const records = vi.spyOn(llm(), 'pipelineRecords')
  renderPipeline('&flow=simulation')
  await pick('연출 결정')
  const step = within(await screen.findByRole('region', { name: '연출 결정 단계' }))
  step.getByText(/LLM 호출 · 단계별 서버 노드가 없어 건수·오류는 보이지 않아요/)
  step.getByText(/Decisions API로 정한다/)
  step.getByText(/프롬프트 인물 시뮬레이션 · 장면 연출\(direct\)/)
  expect(records).not.toHaveBeenCalled()
  fireEvent.click(step.getByRole('button', { name: '프롬프트 보기 · 연출 결정 · 인물 시뮬레이션 · 장면 연출(direct)' }))
  await within(await screen.findByLabelText('프롬프트 상세')).findByRole('heading', { name: /장면 연출\(direct\)/ })
  cleanup()
  records.mockClear()   // 프롬프트 상세가 열리면 기본 모델 근거(promptRecords)를 읽느라 노드 기록을 부른다
  renderPipeline('&flow=simulation')
  await pick('작가 승인·초안 반영')
  const apply = within(await screen.findByRole('region', { name: '작가 승인·초안 반영 단계' }))
  apply.getByText(/LLM 아님 · 건수·오류를 세지 않는 단계예요/)
  expect(apply.queryByRole('button', { name: /프롬프트 보기/ })).toBeNull()
  expect(records).not.toHaveBeenCalled()
  await pick('NovelBrain 기억 회상')
  await panel('NovelBrain 기억 회상')
  await waitFor(() => expect(records.mock.calls.at(-1)![0]).toMatchObject({ nodeId: 'novelbrain', page: 0 }))
  expect(records.mock.calls.every(([query]) => !query.nodeId.includes(':'))).toBe(true)
})

it('노드를 고르면 기록 패널 머리에 프롬프트 보기가 있고(하나면 버튼·여럿이면 목록), 내부 흐름이 있는 노드에는 내부 흐름 보기가 있어 그 흐름으로 바꾼다(#857 3차)', async () => {
  renderPipeline()
  await pick('Decision Guard')
  const guard = within(await panel('Decision Guard'))
  guard.getByRole('button', { name: '프롬프트 보기 · Decision Guard · Decision Guard · 요청 판정(judge)' })
  expect(guard.queryByRole('button', { name: '내부 흐름 보기' })).toBeNull()   // 내부 흐름이 없는 노드
  await pick('인물 시뮬레이션')
  const sim = within(await panel('인물 시뮬레이션'))
  fireEvent.click(sim.getByRole('button', { name: '프롬프트 보기 · 인물 시뮬레이션' }))
  expect(within(screen.getByRole('menu', { name: '프롬프트 보기 · 인물 시뮬레이션' })).getAllByRole('menuitem')).toHaveLength(5)
  fireEvent.pointerDown(document.body)
  fireEvent.click(sim.getByRole('button', { name: '내부 흐름 보기' }))
  await screen.findByRole('group', { name: '인물 시뮬레이션 내부 흐름' })
  expect((screen.getByLabelText('워크플로우') as HTMLSelectElement).value).toBe('simulation')
  expect(screen.queryByRole('region', { name: '인물 시뮬레이션 기록' })).toBeNull()   // 흐름을 바꾸면 고른 노드는 닫힌다
  cleanup()
  renderPipeline()
  await pick('원고 설정 추출')
  fireEvent.click(within(await panel('원고 설정 추출')).getByRole('button', { name: '내부 흐름 보기' }))
  await screen.findByRole('group', { name: '원고 전처리 내부 흐름' })
})

it('조회 권한(llm)이 없으면(403) 파이프라인도 노드 기록도 다시 불러오기 없이 권한 안내만 보인다', async () => {
  vi.spyOn(llm(), 'pipelineRecords').mockResolvedValue(null)
  renderPipeline()
  await pick('Decision Guard')
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
  await pick('Decision Guard')
  await screen.findByText(/전체 45건 · 1\/3쪽/)
  fireEvent.click(screen.getByRole('button', { name: '다음' }))
  await waitFor(() => expect(records.mock.calls.at(-1)![0]).toMatchObject({ nodeId: 'guard', page: 1 }))
  await pick('메인 에이전트')
  await waitFor(() => expect(records.mock.calls.at(-1)![0]).toMatchObject({ nodeId: 'main', page: 0 }))
})

it('서버는 기록을 최신 1,000건까지만 주므로 그 밖의 쪽으로는 넘기지 못하게 하고 안내한다', async () => {
  const item: PipelineRecord = { id: 'a', traceId: 'trace-1', name: 'decision_guard', type: 'SPAN', startTime: '2026-11-21T01:00:00Z', latencyMs: 100, level: 'DEFAULT' }
  vi.spyOn(llm(), 'pipelineRecords').mockResolvedValue({ items: [item], page: 49, size: 20, total: 3000, unavailable: [] })
  renderPipeline()
  await pick('Decision Guard')
  await screen.findByText(/전체 3,000건 · 50\/50쪽/)
  expect((screen.getByRole('button', { name: '다음' }) as HTMLButtonElement).disabled).toBe(true)
  screen.getByText(/최신 1,000건까지만 볼 수 있어요/)
})

it('NovelBrain 기억 회상 노드는 인물 시뮬레이션 바로 뒤에 이어지고, 기록을 펼치면 회상한 기억(recalled)의 제목 목록을 보인다', async () => {
  renderPipeline()
  const flow = within(await screen.findByRole('group', { name: '요청 흐름' }))
  const labels = flow.getAllByRole('button').filter((button) => button.classList.contains('pipe-node')).map((button) => button.querySelector('b')?.textContent)
  expect(labels.indexOf('NovelBrain 기억 회상')).toBe(labels.indexOf('인물 시뮬레이션') + 1)
  await pick('NovelBrain 기억 회상')
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
  await pick('NovelBrain 기억 회상')
  const rows = dataRows(await table('NovelBrain 기억 회상'))
  expect(rows.map((row: HTMLElement) => within(row).getAllByRole('cell')[3].textContent)).toEqual(['1ms 미만', '—', '250ms'])
  fireEvent.click(openRowMenu(rows[0]).getByRole('menuitem', { name: '실행 흐름 보기' }))
  const flow = within(await screen.findByRole('region', { name: '실행 흐름' }))
  await flow.findByText('RETRIEVER · 1ms 미만')
  flow.getByText('SPAN · —')
})

it('주소만 바뀌어(뒤로 가기 등) 다른 흐름으로 옮겨도 그 흐름에 속하지 않는 서버 노드의 기록은 남지 않고, 그 흐름의 집계 노드는 그대로 열린다(#857 3차)', async () => {
  let go: (to: string) => void = () => undefined
  const Go = () => { go = useNavigate(); return null }
  render(
    <Provider store={createAppStore({ role: 'admin' })}>
      <MemoryRouter initialEntries={['/admin?tab=llm&view=prompts']} useTransitions={false}><Go /><AdminPage /></MemoryRouter>
    </Provider>,
  )
  await pick('Decision Guard')
  await panel('Decision Guard')
  act(() => go('/admin?tab=llm&view=prompts&flow=preprocessing'))   // 드롭다운이 아니라 주소로만 옮긴다(노드 선택은 그대로 남는다)
  await screen.findByRole('group', { name: '원고 전처리 내부 흐름' })
  expect(screen.queryByRole('region', { name: 'Decision Guard 기록' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '집계 기록 보기' }))
  await panel('원고 설정 추출')
})

it('서버 목록에 NovelBrain 노드가 없으면 그 단계도 구조용이라 단계 설명을 보이고 서버에 기록을 묻지 않는다(#857 3차, CodeRabbit 반영)', async () => {
  const list = (await llm().pipeline({ from: '2026-11-17T00:00:00Z', to: '2026-11-24T00:00:00Z' }))!
  vi.spyOn(llm(), 'pipeline').mockResolvedValue(list.filter((n) => n.id !== 'novelbrain'))
  const records = vi.spyOn(llm(), 'pipelineRecords')
  renderPipeline('&flow=simulation')
  await pick('NovelBrain 기억 회상')
  const step = within(await screen.findByRole('region', { name: 'NovelBrain 기억 회상 단계' }))
  step.getByText(/LLM 아님 · 건수·오류를 세지 않는 단계예요/)
  expect(screen.queryByRole('region', { name: 'NovelBrain 기억 회상 기록' })).toBeNull()
  expect(records).not.toHaveBeenCalled()
})
