import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import type { Evaluation } from '../entities/llmOps'
import { AGENT_EVALUATIONS, NO_SET, RECENT_RUN, latestRun } from '../entities/llmOpsEvalTable'

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
    expect(empty.map((row) => row.agent)).toEqual(expect.arrayContaining(['메인 에이전트', 'Decision Guard', 'Manuscript Review', 'Research', 'Rating', '전처리 설정 추출']))
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
