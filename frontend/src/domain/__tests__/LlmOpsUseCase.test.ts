import { describe, expect, it, vi } from 'vitest'

import { OperationsError, OperationsForbidden } from '../entities/operations'
import type { LlmOpsRepository } from '../repositories/LlmOpsRepository'
import { LlmOpsUseCase } from '../usecases/LlmOpsUseCase'

const make = (repo: Partial<LlmOpsRepository> = {}) => new LlmOpsUseCase(repo as LlmOpsRepository)
const rejects = (promise: Promise<unknown>, message: string) => expect(promise).rejects.toThrow(new OperationsError(message))

describe('프롬프트 새 버전', () => {
  it('본문은 그대로, 변경 메모는 다듬어 보내고 본문이 비면 보내지 않는다', async () => {
    const createPromptVersion = vi.fn(async () => {})
    await make({ createPromptVersion }).createPromptVersion('qa-answer', '  첫 줄\n둘째 줄 ', '  말투 조정 ', ' gpt-x ')
    expect(createPromptVersion).toHaveBeenCalledWith('qa-answer', { prompt: '  첫 줄\n둘째 줄 ', commitMessage: '말투 조정', model: 'gpt-x' })
    await rejects(make({ createPromptVersion }).createPromptVersion('qa-answer', '  \n ', '', ''), '프롬프트 본문을 입력해 주세요.')
    expect(createPromptVersion).toHaveBeenCalledTimes(1)
  })
})

describe('모델 등록', () => {
  it('100만 토큰당 USD로 받은 단가를 토큰당 USD로 바꿔 보낸다', async () => {
    const createModel = vi.fn(async () => {})
    await make({ createModel }).createModel({ modelName: ' gpt-x ', matchPattern: ' (?i)^gpt-x$ ', inputPerMillion: 2.5, outputPerMillion: 10 })
    expect(createModel).toHaveBeenCalledWith({ modelName: 'gpt-x', matchPattern: '(?i)^gpt-x$', inputPrice: 0.0000025, outputPrice: 0.00001 })
  })

  it('이름·패턴이 비었거나 단가가 숫자가 아니거나 음수면 보내지 않는다', async () => {
    const createModel = vi.fn(async () => {})
    const uc = make({ createModel }), ok = { modelName: 'm', matchPattern: 'm', inputPerMillion: 1, outputPerMillion: 1 }
    await rejects(uc.createModel({ ...ok, modelName: ' ' }), '모델 이름과 매칭 패턴을 입력해 주세요.')
    await rejects(uc.createModel({ ...ok, matchPattern: '' }), '모델 이름과 매칭 패턴을 입력해 주세요.')
    await rejects(uc.createModel({ ...ok, inputPerMillion: Number.NaN }), '단가는 0 이상의 숫자로 입력해 주세요.')
    await rejects(uc.createModel({ ...ok, outputPerMillion: -1 }), '단가는 0 이상의 숫자로 입력해 주세요.')
    expect(createModel).not.toHaveBeenCalled()
  })
})

describe('회귀 평가 실행', () => {
  it('데이터셋·프롬프트·버전(1 이상의 정수)을 갖춰야 요청한다', async () => {
    const runEvaluation = vi.fn(async () => {})
    const uc = make({ runEvaluation })
    await uc.runEvaluation(' qa-set ', ' qa-answer ', 3)
    expect(runEvaluation).toHaveBeenCalledWith({ dataset: 'qa-set', prompt: 'qa-answer', version: 3 })
    await rejects(uc.runEvaluation('', 'qa-answer', 3), '데이터셋과 프롬프트 이름을 입력해 주세요.')
    await rejects(uc.runEvaluation('qa-set', ' ', 3), '데이터셋과 프롬프트 이름을 입력해 주세요.')
    await rejects(uc.runEvaluation('qa-set', 'qa-answer', 0), '버전은 1 이상의 정수로 입력해 주세요.')
    await rejects(uc.runEvaluation('qa-set', 'qa-answer', 1.5), '버전은 1 이상의 정수로 입력해 주세요.')
    expect(runEvaluation).toHaveBeenCalledTimes(1)
  })
})

describe('경고 기준·표본 비율', () => {
  it('기준 창은 1 이상의 정수 분, 기준값은 비우거나 0 이상의 숫자다', async () => {
    const updateAlertRule = vi.fn(async () => {})
    const uc = make({ updateAlertRule })
    await uc.updateAlertRule('ai_failure_rate', { threshold: 0.2, windowMinutes: 60, enabled: true })
    await uc.updateAlertRule('job_failed', { threshold: null, windowMinutes: 5, enabled: false })
    expect(updateAlertRule).toHaveBeenNthCalledWith(1, 'ai_failure_rate', { threshold: 0.2, windowMinutes: 60, enabled: true })
    expect(updateAlertRule).toHaveBeenNthCalledWith(2, 'job_failed', { threshold: null, windowMinutes: 5, enabled: false })
    await rejects(uc.updateAlertRule('x', { threshold: 1, windowMinutes: 0, enabled: true }), '기준 시간(분)은 1 이상의 정수로 입력해 주세요.')
    await rejects(uc.updateAlertRule('x', { threshold: -1, windowMinutes: 5, enabled: true }), '기준값은 0 이상의 숫자로 입력해 주세요.')
    await rejects(uc.updateAlertRule('x', { threshold: Number.NaN, windowMinutes: 5, enabled: true }), '기준값은 0 이상의 숫자로 입력해 주세요.')
    expect(updateAlertRule).toHaveBeenCalledTimes(2)
  })

  it('누설 검사 표본 비율은 0~1이다', async () => {
    const updateSettings = vi.fn(async () => {})
    const uc = make({ updateSettings })
    await uc.updateSettings(0)
    await uc.updateSettings(1)
    expect(updateSettings).toHaveBeenNthCalledWith(2, { leakSampleRate: 1 })
    await rejects(uc.updateSettings(1.1), '표본 비율은 0 이상 1 이하의 숫자로 입력해 주세요.')
    await rejects(uc.updateSettings(Number.NaN), '표본 비율은 0 이상 1 이하의 숫자로 입력해 주세요.')
    expect(updateSettings).toHaveBeenCalledTimes(2)
  })
})

describe('대시보드 차트용 최근 7일 지표', () => {
  it('지금부터 7일 전까지를 날짜별(day)로 읽는다', async () => {
    const metrics = vi.fn(async () => ({ rows: [] }))
    expect(await make({ metrics }).weeklyMetrics(new Date('2026-11-19T03:00:00Z'))).toEqual({ rows: [] })
    expect(metrics).toHaveBeenCalledWith({ from: '2026-11-12T03:00:00.000Z', to: '2026-11-19T03:00:00.000Z', groupBy: 'day' })
  })

  it('조회 권한(llm)이 없으면(403) 실패가 아니라 null이고, 그 밖의 실패는 그대로 던진다', async () => {
    expect(await make({ metrics: async () => { throw new OperationsForbidden('권한 없음') } }).weeklyMetrics()).toBeNull()
    await expect(make({ metrics: async () => { throw new OperationsError('연결 실패') } }).weeklyMetrics()).rejects.toThrow('연결 실패')
  })
})

describe('LLM Ops 조회 권한', () => {
  it('조회는 권한(llm)이 없으면(403) 모두 실패가 아니라 null이고, 변경은 그대로 던진다', async () => {
    const forbidden = async () => { throw new OperationsForbidden('권한 없음') }
    const uc = make({
      traces: forbidden, trace: forbidden, metrics: forbidden, prompts: forbidden, prompt: forbidden, models: forbidden, evaluations: forbidden,
      evaluation: forbidden, leakChecks: forbidden, alertRules: forbidden, settings: forbidden, promote: forbidden, candidate: forbidden,
    })
    const traceQuery = { from: '', to: '', feature: '', status: '', userId: '', requestId: '', page: 0 }
    const reads = await Promise.all([
      uc.traces(traceQuery), uc.trace('t1'), uc.metrics({ from: '', to: '', groupBy: 'day' }), uc.prompts(), uc.prompt('qa-answer'), uc.models(),
      uc.evaluations(), uc.evaluation('run-1'), uc.leakChecks(), uc.alertRules(), uc.settings(),
    ])
    expect(reads).toEqual(Array(11).fill(null))
    await expect(uc.promote('qa-answer', 1)).rejects.toThrow(OperationsForbidden)
    await expect(uc.candidate('qa-answer', 1)).rejects.toThrow(OperationsForbidden)
  })
})

describe('AI 파이프라인(DEC-58) 조회', () => {
  const range = { from: '2026-11-14T00:00:00.000Z', to: '2026-11-21T00:00:00.000Z' }
  const recordQuery = { nodeId: 'guard', ...range, level: '', page: 0 }
  const forbidden = async () => { throw new OperationsForbidden('권한 없음') }

  it('노드 목록과 노드 기록은 저장소 결과를 그대로 준다', async () => {
    const nodes = [{ id: 'guard', label: 'Decision Guard', next: ['main'], standalone: false, count: 3, errors: 1, promptNames: [] }]
    const page = { items: [], page: 0, size: 20, total: 0, unavailable: [] }
    const pipeline = vi.fn(async () => nodes), pipelineRecords = vi.fn(async () => page)
    const uc = make({ pipeline, pipelineRecords })
    expect(await uc.pipeline(range)).toEqual(nodes)
    expect(await uc.pipelineRecords(recordQuery)).toEqual(page)
    expect(pipeline).toHaveBeenCalledWith(range)
    expect(pipelineRecords).toHaveBeenCalledWith(recordQuery)
  })

  it('조회 권한(llm)이 없으면(403) 실패가 아니라 null이고, 그 밖의 실패는 그대로 던진다', async () => {
    const uc = make({ pipeline: forbidden, pipelineRecords: forbidden })
    expect([await uc.pipeline(range), await uc.pipelineRecords(recordQuery)]).toEqual([null, null])
    await expect(make({ pipeline: async () => { throw new OperationsError('연결 실패') } }).pipeline(range)).rejects.toThrow('연결 실패')
    await expect(make({ pipelineRecords: async () => { throw new OperationsError('연결 실패') } }).pipelineRecords(recordQuery)).rejects.toThrow('연결 실패')
  })
})
