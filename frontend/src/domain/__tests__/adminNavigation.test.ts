import { expect, it } from 'vitest'

import { LLM_PAGES, METRICS_SUBS, PIPELINE_FLOWS, PROMPT_SUBS, adminReturnPath, llmPage, llmPageHref, metricsSub, metricsSubHref, pipelineFlowHref, pipelineFlowKey, promptSub, promptSubHref } from '../entities/admin'

it('관리자 로그인 복귀는 허용 탭만 보존하고 외부 경로·임의 쿼리를 버린다', () => {
  expect(adminReturnPath('?tab=notices')).toBe('/admin?tab=notices')
  expect(adminReturnPath('?tab=events&next=https://example.invalid')).toBe('/admin?tab=events')
  expect(adminReturnPath('?tab=feedback')).toBe('/admin?tab=feedback')
  expect(adminReturnPath('?tab=genres')).toBe('/admin?tab=genres') // 콘텐츠 관리 > 장르(DEC-56)
  expect(adminReturnPath('?tab=ai')).toBe('/admin?tab=llm')
  expect(adminReturnPath('?tab=https://example.invalid')).toBe('/admin?tab=data')
  expect(adminReturnPath('?next=//example.invalid')).toBe('/admin')
  expect(adminReturnPath('')).toBe('/admin')
})

it('LLM Ops 쪽은 view로 정하고 없거나 모르는 값은 에이전트 지표이며, 에이전트 지표만 view 없는 주소다(#857)', () => {
  expect(LLM_PAGES.map(([page, label]) => [page, label])).toEqual([['metrics', '에이전트 지표'], ['prompts', '프롬프트·평가'], ['alerts', '경고·누설 감시']])
  expect(['metrics', 'prompts', 'alerts'].map(llmPage)).toEqual(['metrics', 'prompts', 'alerts'])
  expect([null, '', 'nope', 'METRICS'].map(llmPage)).toEqual(['metrics', 'metrics', 'metrics', 'metrics'])
  expect(LLM_PAGES.map(([page]) => llmPageHref(page))).toEqual(['/admin?tab=llm', '/admin?tab=llm&view=prompts', '/admin?tab=llm&view=alerts'])
})

it('옮기거나 없앤 옛 view는 새 위치로 이어진다: traces(추적·지표)는 에이전트 지표, quality(평가·누설 검사)와 이슈가 적은 eval은 프롬프트·평가이고, 객체 기본 속성 이름은 쪽이 되지 않는다(#857)', () => {
  expect(['traces', 'quality', 'eval'].map(llmPage)).toEqual(['metrics', 'prompts', 'prompts'])
  expect(['constructor', 'toString', '__proto__'].map(llmPage)).toEqual(['metrics', 'metrics', 'metrics'])
})

it('LLM Ops 쪽(view)은 로그인 복귀에도 알려진 값만 보존하고, 옛 view는 새 위치로 옮기며, 다른 탭이나 모르는 값은 버린다', () => {
  expect(adminReturnPath('?tab=llm&view=metrics')).toBe('/admin?tab=llm')
  expect(adminReturnPath('?tab=llm&view=traces')).toBe('/admin?tab=llm')
  expect(adminReturnPath('?tab=llm&view=alerts')).toBe('/admin?tab=llm&view=alerts')
  expect(adminReturnPath('?tab=ai&view=quality')).toBe('/admin?tab=llm&view=prompts')
  expect(adminReturnPath('?tab=llm&view=eval')).toBe('/admin?tab=llm&view=prompts')
  expect(adminReturnPath('?tab=llm&view=https://example.invalid')).toBe('/admin?tab=llm')
  expect(adminReturnPath('?tab=users&view=traces')).toBe('/admin?tab=users')
})

it('에이전트 지표 쪽의 보기는 sub로 정하고 없거나 모르는 값은 지표이며, 지표만 sub 없는 주소다(#857, 추적은 지우지 않고 보기 전환으로 둔다)', () => {
  expect(METRICS_SUBS.map(([sub, label]) => [sub, label])).toEqual([['cards', '지표'], ['traces', '추적']])
  expect(['cards', 'traces'].map(metricsSub)).toEqual(['cards', 'traces'])
  expect([null, '', 'nope', 'TRACES'].map(metricsSub)).toEqual(['cards', 'cards', 'cards', 'cards'])
  expect(METRICS_SUBS.map(([sub]) => metricsSubHref(sub))).toEqual(['/admin?tab=llm', '/admin?tab=llm&sub=traces'])
})

it('프롬프트·평가 쪽의 보기는 sub로 정하고 없거나 모르는 값은 전체(AI 파이프라인)이며, 전체만 sub 없는 주소다(#857: 전체가 가장 왼쪽·기본 보기, 에이전트별 평가는 그 뒤)', () => {
  expect(PROMPT_SUBS.map(([sub, label]) => [sub, label])).toEqual([['all', '전체(AI 파이프라인)'], ['evals', '에이전트별 평가'], ['prompts', '프롬프트'], ['models', '모델']])
  expect(['evals', 'prompts', 'models'].map(promptSub)).toEqual(['evals', 'prompts', 'models'])
  expect([null, '', 'all', 'nope', 'PROMPTS'].map(promptSub)).toEqual(['all', 'all', 'all', 'all', 'all'])
  expect(PROMPT_SUBS.map(([sub]) => promptSubHref(sub))).toEqual([
    '/admin?tab=llm&view=prompts', '/admin?tab=llm&view=prompts&sub=evals', '/admin?tab=llm&view=prompts&sub=prompts', '/admin?tab=llm&view=prompts&sub=models',
  ])
})

it('로그인 복귀는 sub도 알려진 값만 보존하고(프롬프트·평가·에이전트 지표 쪽만), 다른 쪽이나 모르는 값의 sub는 버린다', () => {
  expect(adminReturnPath('?tab=llm&view=prompts&sub=models')).toBe('/admin?tab=llm&view=prompts&sub=models')
  expect(adminReturnPath('?tab=llm&view=prompts&sub=prompts')).toBe('/admin?tab=llm&view=prompts&sub=prompts')
  expect(adminReturnPath('?tab=llm&view=prompts&sub=evals')).toBe('/admin?tab=llm&view=prompts&sub=evals')
  expect(adminReturnPath('?tab=llm&view=prompts&sub=all')).toBe('/admin?tab=llm&view=prompts')
  expect(adminReturnPath('?tab=llm&view=prompts&sub=https://example.invalid')).toBe('/admin?tab=llm&view=prompts')
  expect(adminReturnPath('?tab=llm&view=quality&sub=models')).toBe('/admin?tab=llm&view=prompts&sub=models')
  expect(adminReturnPath('?tab=llm&sub=traces')).toBe('/admin?tab=llm&sub=traces')
  expect(adminReturnPath('?tab=llm&view=metrics&sub=cards')).toBe('/admin?tab=llm')
  expect(adminReturnPath('?tab=llm&view=alerts&sub=models')).toBe('/admin?tab=llm&view=alerts')
})

it('AI 파이프라인(전체) 보기의 워크플로우는 flow로 정하고 없거나 모르는 값은 전체이며, 전체만 flow 없는 주소다(#857 3차)', () => {
  expect(['all', 'simulation', 'preprocessing', 'review', 'research', 'writing'].map(pipelineFlowKey)).toEqual(['all', 'simulation', 'preprocessing', 'review', 'research', 'writing'])
  expect([null, '', 'nope', 'SIMULATION', 'constructor', '__proto__'].map(pipelineFlowKey)).toEqual(['all', 'all', 'all', 'all', 'all', 'all'])
  expect(PIPELINE_FLOWS.map(([key]) => pipelineFlowHref(key))).toEqual([
    '/admin?tab=llm&view=prompts', '/admin?tab=llm&view=prompts&flow=simulation', '/admin?tab=llm&view=prompts&flow=preprocessing', '/admin?tab=llm&view=prompts&flow=review',
    '/admin?tab=llm&view=prompts&flow=research', '/admin?tab=llm&view=prompts&flow=writing',
  ])
})

it('로그인 복귀는 전체(AI 파이프라인) 보기의 알려진 flow만 보존하고, 다른 보기나 모르는 flow는 버린다(#857 3차)', () => {
  expect(adminReturnPath('?tab=llm&view=prompts&flow=simulation')).toBe('/admin?tab=llm&view=prompts&flow=simulation')
  expect(adminReturnPath('?tab=llm&view=prompts&sub=all&flow=review')).toBe('/admin?tab=llm&view=prompts&flow=review')
  expect(adminReturnPath('?tab=llm&view=prompts&flow=nope')).toBe('/admin?tab=llm&view=prompts')
  expect(adminReturnPath('?tab=llm&view=prompts&flow=all')).toBe('/admin?tab=llm&view=prompts')
  expect(adminReturnPath('?tab=llm&view=prompts&sub=evals&flow=simulation')).toBe('/admin?tab=llm&view=prompts&sub=evals')
  expect(adminReturnPath('?tab=llm&view=alerts&flow=simulation')).toBe('/admin?tab=llm&view=alerts')
  expect(adminReturnPath('?tab=llm&flow=simulation')).toBe('/admin?tab=llm')
})
