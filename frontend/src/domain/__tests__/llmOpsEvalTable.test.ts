import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import type { Evaluation } from '../entities/llmOps'
import { AGENT_EVALUATIONS, NO_SET, RECENT_RUN, evaluationName, latestRun, pairSets, pairedPrompt, promptRuns, setItems } from '../entities/llmOpsEvalTable'
import { promptLabel } from '../entities/promptNames'

const run = (runId: string, dataset: string, createdAt: string): Evaluation => ({ runId, dataset, prompt: 'p', version: 1, status: 'completed', passed: true, createdAt, metrics: [] })

it('latestRun은 그 세트의 가장 최근 Run을 목록 순서와 무관하게 고르고, 그 세트의 Run이 없으면 없음이다', () => {
  const rows = [run('old', 'qa.grounding', '2026-11-20T01:00:00Z'), run('new', 'qa.grounding', '2026-11-23T01:00:00Z'), run('mid', 'qa.grounding', '2026-11-21T01:00:00Z')]
  expect(latestRun('qa.grounding', rows)?.runId).toBe('new')
  expect(latestRun('simulation.act', rows)).toBeUndefined()
  expect(latestRun('simulation.act', [])).toBeUndefined()
})

describe('에이전트별 평가 표', () => {
  it('메인·Decision Guard·업무 Agent 6·인물 시뮬레이션·전처리 설정 추출이 모두 있고, 세트가 없는 에이전트는 숨기지 않고 평가 세트 없음(후속)이다', () => {
    const agents = new Set(AGENT_EVALUATIONS.map((row) => row.agent))
    for (const name of ['메인 에이전트', 'Decision Guard', 'Q&A', 'Manuscript Review', 'World', 'Writing', 'Research', 'Rating', '인물 시뮬레이션', '전처리 설정 추출']) expect(agents, name).toContain(name)
    expect(AGENT_EVALUATIONS.map((row) => row.feature)).toEqual(expect.arrayContaining(['character_simulation.act', 'character_simulation.narrate']))
    const empty = AGENT_EVALUATIONS.filter((row) => row.set === NO_SET)
    expect(empty.map((row) => row.agent)).toEqual(expect.arrayContaining(['메인 에이전트', 'Manuscript Review', 'Research', 'Rating']))
    expect(empty.map((row) => row.agent)).not.toContain('Decision Guard')   // 라우팅 세트(#783)가 생겼다
    for (const row of empty) expect([row.dataset, row.metrics, row.result], row.feature).toEqual([undefined, '—', '—'])
  })

  it('모드는 새 답변 생성과 원문 검색뿐이고(저장 답변 재평가 없음) 검색 행은 버튼 없이 CI에서 확인한다', () => {
    expect(new Set(AGENT_EVALUATIONS.map((row) => row.mode))).toEqual(new Set(['새 답변 생성', '원문 검색', '—']))
    const search = AGENT_EVALUATIONS.filter((row) => row.mode === '원문 검색' && row.metrics !== '—')
    expect(search.length).toBeGreaterThan(0)
    for (const row of search) expect([row.dataset, row.result], row.feature).toEqual([undefined, expect.stringContaining('버튼 없음 · CI에서 확인')])
  })

  it('회귀 평가 행의 세트 이름·항목 수가 AI 서비스의 세트 파일과 같다', () => {
    const rows = AGENT_EVALUATIONS.filter((row) => row.dataset)
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      const file = new URL('../../../../backend/ai-service/app/evaluation/datasets/' + row.dataset + '.jsonl', import.meta.url)
      const items = readFileSync(file, 'utf8').split('\n').filter(Boolean).length
      expect([row.set, row.mode, row.result], row.dataset).toEqual([row.dataset + '(' + items + ')', '새 답변 생성', RECENT_RUN])
    }
  })

  it('docs/evaluation/retrieval.md §1.1 표와 칸마다 같다(기준표를 고치면 화면 표 상수도 같이 고친다)', () => {
    const doc = readFileSync(new URL('../../../../docs/evaluation/retrieval.md', import.meta.url), 'utf8')
    const section = doc.split('### 1.1')[1].split(/\n#{2,3} /)[0]
    const rows = section.split('\n').filter((line) => line.startsWith('|')).slice(2).map((line) => line.split('|').slice(1, -1).map((cell) => cell.replaceAll('`', '').trim()))
    expect(rows).toEqual(AGENT_EVALUATIONS.map((row) => [row.agent + ' · ' + row.feature, row.mode, row.set, row.metrics, row.result]))
  })
})

describe('프롬프트 개선 루프의 짝 평가 세트(#857)', () => {
  const read = (path: string) => readFileSync(new URL('../../../../' + path, import.meta.url), 'utf8')

  it('pairSets는 그 프롬프트를 새 답변 생성으로 평가하는 행의 세트를 주고, 세트가 없는 프롬프트·모르는 프롬프트는 빈 목록이다', () => {
    expect(pairSets('character_simulation.act').map((row) => row.dataset)).toEqual(['simulation.act'])
    expect(pairSets('manuscript_extraction.extract').map((row) => row.set)).toEqual(['extraction.extract(30)'])
    expect(pairSets('decision_guard.judge').map((row) => row.dataset)).toEqual(['decision_guard.routing'])
    expect(pairSets('orchestration.main')).toEqual([])
    expect(pairSets('nope')).toEqual([])
  })

  it('setItems는 표의 세트 칸 괄호 안 항목 수를 주고, 항목 수가 없는 칸은 없음이다', () => {
    expect(pairSets('story_context.answer').map(setItems)).toEqual([6])
    expect(pairSets('character_simulation.narrate').map(setItems)).toEqual([46])
    expect(pairSets('decision_guard.judge').map(setItems)).toEqual([49])
    expect([NO_SET, '한국어 62문항(설정 14·누설 62)', '제외(결과가 시점마다 달라 재현 불가)'].map((set) => setItems({ set }))).toEqual([undefined, undefined, undefined])
  })

  it('후보 등록 게이트의 짝(운영 서비스 PromptService의 EVALUATION_SETS)이 표의 프롬프트·세트와 같다', () => {
    const kotlin = read('backend/operations-service/src/main/kotlin/ai/storyfork/operations/llmops/service/PromptService.kt')
    const gate = [...kotlin.split('EVALUATION_SETS = mapOf(')[1].split('\n)')[0].matchAll(/"([^"]+)" to "([^"]+)"/g)].map((m) => [m[1], m[2]])
    expect(gate.length).toBeGreaterThan(0)
    expect(gate.map(([prompt]) => pairSets(prompt).map((row) => row.dataset))).toEqual(gate.map(([, set]) => [set]))
  })

  it('행에서 프롬프트 상세로 이동하는 프롬프트는 feature가 프롬프트 이름인 행뿐이고, 모두 AI 서비스가 등록하는 프롬프트(SEEDS)다', () => {
    const registered = new Set([...read('backend/ai-service/app/prompts.py').split('SEEDS: dict[str, str] = {')[1].split('\n}')[0].matchAll(/^\s+'([a-z_.]+)':/gm)].map((m) => m[1]))
    const linked = AGENT_EVALUATIONS.filter((row) => row.prompt)
    expect(linked.map((row) => row.prompt)).toEqual([
      'orchestration.main', 'decision_guard.judge', 'story_context.answer', 'web_research.search', 'rating.assess', 'character_simulation.act', 'character_simulation.narrate', 'manuscript_extraction.extract',
    ])
    for (const row of linked) expect([row.feature, registered.has(row.prompt!)], row.feature).toEqual([row.prompt, true])
  })

  it('promptRuns는 짝 세트의 Run과 이 프롬프트를 다른 세트로 돌린 Run만 남기고 목록 순서를 지킨다', () => {
    const on = (runId: string, dataset: string, prompt: string): Evaluation => ({ ...run(runId, dataset, '2026-11-24T01:00:00Z'), prompt })
    const rows = [
      on('a', 'simulation.act', 'character_simulation.act'), on('b', 'simulation.narrate', 'character_simulation.narrate'),
      on('c', 'world.conflict', 'character_simulation.act'), on('d', 'world.conflict', 'world_review.check'), on('e', 'simulation.act', 'character_simulation.act'),
    ]
    expect(promptRuns('character_simulation.act', rows).map((e) => e.runId)).toEqual(['a', 'c', 'e'])
    // 짝 세트가 없는 프롬프트는 그 프롬프트로 돌린 Run만 보인다.
    expect(promptRuns('world_review.check', rows).map((e) => e.runId)).toEqual(['d'])
    expect(promptRuns('nope', rows)).toEqual([])
  })

  it('행 이름은 프롬프트가 정해진 행이면 그 프롬프트의 한국어 이름(에이전트 이름으로 시작), 아니면 에이전트 · 기능이고, 모든 행의 이름이 다르다(#857)', () => {
    const names = AGENT_EVALUATIONS.map(evaluationName)
    expect(new Set(names).size).toBe(names.length)
    for (const row of AGENT_EVALUATIONS.filter((r) => r.prompt)) expect([evaluationName(row), evaluationName(row).startsWith(row.agent + ' · ')], row.feature).toEqual([promptLabel(row.prompt!), true])
    expect(names).toEqual(expect.arrayContaining(['인물 시뮬레이션 · 인물 대사(act)', '인물 시뮬레이션 · 나레이션·독백(narrate)', 'World · 설정 충돌 지적', 'Manuscript Review · 원고 검수(manuscript_review.*)']))
  })

  it('pairedPrompt는 세트의 짝 프롬프트를 주고, 범용 세트·모르는 세트는 없음이다(데이터셋 목록의 짝 프롬프트 칸)', () => {
    expect(['simulation.act', 'simulation.narrate', 'qa.grounding', 'extraction.extract', 'decision_guard.routing'].map(pairedPrompt)).toEqual(['character_simulation.act', 'character_simulation.narrate', 'story_context.answer', 'manuscript_extraction.extract', 'decision_guard.judge'])
    expect(['leak.spoiler', 'world.conflict', 'writing.fix', 'my-upload'].map(pairedPrompt)).toEqual([null, null, null, null])
  })
})
