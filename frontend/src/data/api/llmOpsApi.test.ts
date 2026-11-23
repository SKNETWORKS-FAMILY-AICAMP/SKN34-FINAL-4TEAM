import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import '../../test/testLocks'
import { OperationsError, OperationsForbidden, OperationsRejected } from '../../domain/entities/operations'
import { login } from './auth'
import { HttpJobMonitorRepository, HttpLlmOpsRepository, HttpOperationsDashboardRepository } from './llmOpsApi'

type Call = [string, { method?: string; body?: string; headers: Record<string, string> }]
const callsOf = (f: { mock: { calls: unknown[] } }) => f.mock.calls as Call[]
const ok = (value: unknown, status = 200) => vi.fn(async () => Response.json(value, { status }))
const fail = (status: number, body: unknown = { code: 'X', message: '서버 문구' }) => vi.fn(async () => Response.json(body, { status }))
const FORMAT = '서버 응답 형식을 확인할 수 없어요.'
const AT = '2026-11-19T01:02:03Z'

beforeEach(async () => {
  vi.stubGlobal('fetch', vi.fn(async (path: string) => path.endsWith('/csrf') ? Response.json({ csrfToken: 'l-csrf' }) : Response.json({ accessToken: 'l-bearer', user: { id: 'u1', email: 'u1@example.invalid', nickname: 'U', operator: true } })))
  await login('u1@example.invalid', 'test-password')
})
afterEach(() => vi.unstubAllGlobals())

const summary = { requests: 12, failed: 3, timeouts: 1, failureRate: 0.25, costUser: 0, costPlatform: 0.0123 }
const alert = { id: 'a1', ruleKey: 'ai_failure_rate', status: 'open', message: '실패율 초과', value: 0.3, targetRef: null, createdAt: AT }

describe('HttpOperationsDashboardRepository', () => {
  it('대시보드는 Bearer로 읽고, 출처가 실패해 빠진 칸과 일부만 빈 칸은 null로 두며 unavailable을 그대로 준다', async () => {
    const fetcher = ok({ members: null, ai: { today: summary, last7Days: summary }, jobs: { running: 2 }, pending: { inquiries: 4, reports: 1 }, openAlerts: 0, unavailable: ['core'] })
    const d = await new HttpOperationsDashboardRepository(fetcher).dashboard()
    const [[url, init]] = callsOf(fetcher)
    expect(url).toBe('/api/v1/operations/dashboard')
    expect(init.headers.Authorization).toBe('Bearer l-bearer')
    expect(d.members).toBeNull()
    expect(d.ai?.today.requests).toBe(12)
    expect(d.jobs).toEqual({ running: 2 })
    expect(d.pending?.authorReviews).toBeUndefined()
    expect(d.openAlerts).toBe(0)
    expect(d.unavailable).toEqual(['core'])
    // unavailable이 없으면 빈 목록이다.
    expect((await new HttpOperationsDashboardRepository(ok({ openAlerts: 1 })).dashboard()).unavailable).toEqual([])
  })

  it('알 수 없는 모양은 거부한다', async () => {
    await expect(new HttpOperationsDashboardRepository(ok({ ai: { today: { requests: '많음' } } })).dashboard()).rejects.toThrow(FORMAT)
  })

  const funnel = {
    readers: { viewed: 400, readAny: 160, readNext: 40 },
    reactions: { publishedEpisodes: 40, likes: 130, interests: 60, comments: 10 },
    forks: { readers: 160, readerForked: 16, baseEpisodes: [{ bucket: '1', count: 5 }, { bucket: '2', count: 3 }, { bucket: '3', count: 0 }, { bucket: '4-5', count: 2 }, { bucket: '6-10', count: 1 }, { bucket: '11+', count: 4 }] },
    writers: { forks: 25, saved: 20, published: 5, medianHoursToPublish: 12.5 },
    proposals: { adopted: 30, total: 120 },
    feedback: { approved: 8, decided: 16 },
  }

  it('서비스 지표(funnel)는 그대로 읽고, Content 실패로 null이거나 생략돼도 0으로 채우지 않는다', async () => {
    expect((await new HttpOperationsDashboardRepository(ok({ funnel, unavailable: [] })).dashboard()).funnel).toEqual(funnel)
    const failed = await new HttpOperationsDashboardRepository(ok({ funnel: null, unavailable: ['content'] })).dashboard()
    expect([failed.funnel, failed.unavailable]).toEqual([null, ['content']])
    expect((await new HttpOperationsDashboardRepository(ok({ openAlerts: 1 })).dashboard()).funnel).toBeUndefined()
    // 직접 발행한 Fork가 없으면 중앙값이 null이다.
    const none = { ...funnel, writers: { ...funnel.writers, published: 0, medianHoursToPublish: null } }
    expect((await new HttpOperationsDashboardRepository(ok({ funnel: none })).dashboard()).funnel?.writers.medianHoursToPublish).toBeNull()
  })

  it('funnel이 계약과 다른 모양이면(구간 분포가 객체이거나 수가 글자) 거부한다', async () => {
    const wrong = [
      { ...funnel, forks: { ...funnel.forks, baseEpisodes: { '1': 5 } } },
      { ...funnel, readers: { ...funnel.readers, viewed: '400' } },
      { ...funnel, proposals: { adopted: 30 } },
    ]
    for (const bad of wrong) await expect(new HttpOperationsDashboardRepository(ok({ funnel: bad })).dashboard()).rejects.toThrow(FORMAT)
  })

  it('경고는 상태만 query로 보내고(전체는 생략) 확인·조치 완료는 PUT으로 상태와 메모를 보낸다', async () => {
    const fetcher = ok({ items: [alert], page: 0, size: 100, total: 1 })
    const repo = new HttpOperationsDashboardRepository(fetcher)
    expect(await repo.alerts('open')).toEqual([alert])
    await repo.alerts(null)
    await repo.updateAlert('a 1', 'resolved', '재시작')
    expect(callsOf(fetcher).map(([url, init]) => [url, init.method, init.body])).toEqual([
      ['/api/v1/operations/alerts?status=open', 'GET', undefined],
      ['/api/v1/operations/alerts', 'GET', undefined],
      ['/api/v1/operations/alerts/a%201', 'PUT', JSON.stringify({ status: 'resolved', note: '재시작' })],
    ])
  })

  it('권한이 없으면 OperationsForbidden이다', async () => {
    await expect(new HttpOperationsDashboardRepository(fail(403)).alerts(null)).rejects.toThrow(OperationsForbidden)
  })
})

const trace = {
  id: 't1', timestamp: AT, feature: 'qa', status: 'failed', latencyMs: 820, inputTokens: 100, outputTokens: 20, cost: 0.001,
  userId: 'm1', workId: null,
}

describe('HttpLlmOpsRepository 추적·지표', () => {
  it('추적 목록은 채운 조건만 query로 보내고 요청 ID도 보낸다', async () => {
    const fetcher = ok({ items: [trace], page: 1, size: 20, total: 41 })
    const repo = new HttpLlmOpsRepository(fetcher)
    const page = await repo.traces({ from: '2026-11-18T00:00:00.000Z', to: '2026-11-19T00:00:00.000Z', feature: 'qa', status: 'failed', userId: 'm1', requestId: 'req-9', page: 1 })
    expect(page).toEqual({ items: [trace], page: 1, size: 20, total: 41, unavailable: [] })
    // 호출자가 조건에 여분 값(기간 시간 등)을 얹어도 계약에 없는 query는 보내지 않는다.
    await repo.traces({ from: '', to: '', feature: '', status: '', userId: '', requestId: '', page: 0, hours: 168 } as Parameters<typeof repo.traces>[0])
    const [[first], [second]] = callsOf(fetcher)
    expect(first).toBe('/api/v1/operations/llmops/traces?from=2026-11-18T00%3A00%3A00.000Z&to=2026-11-19T00%3A00%3A00.000Z&feature=qa&status=failed&userId=m1&requestId=req-9&page=1')
    expect(second).toBe('/api/v1/operations/llmops/traces?page=0')
  })

  it('목록 합계는 total이고 Spring PageResponse의 totalElements도 받으며 둘 다 없으면 거부한다', async () => {
    const body = { items: [], page: 0, size: 20 }
    expect((await new HttpLlmOpsRepository(ok({ ...body, totalElements: 7, totalPages: 1 })).traces({ from: '', to: '', feature: '', status: '', userId: '', requestId: '', page: 0 })).total).toBe(7)
    await expect(new HttpLlmOpsRepository(ok(body)).traces({ from: '', to: '', feature: '', status: '', userId: '', requestId: '', page: 0 })).rejects.toThrow(FORMAT)
  })

  it('Langfuse 화면 주소(traceUrl)는 화면 값으로 받지 않는다: 서버가 보내도 버린다', async () => {
    const page = await new HttpLlmOpsRepository(ok({ items: [{ ...trace, traceUrl: 'http://localhost:3000/project/p/traces/t1' }], page: 0, size: 20, total: 1 })).traces({ from: '', to: '', feature: '', status: '', userId: '', requestId: '', page: 0 })
    expect(page.items[0]).toEqual(trace)
    expect(page.items[0]).not.toHaveProperty('traceUrl')
  })

  it('추적 상세는 id를 인코딩해 읽고 입력·출력과 단계를 그대로 준다', async () => {
    const observation = { id: 'o1', name: 'retrieve', type: 'SPAN', startTime: AT, endTime: AT, latencyMs: 30, model: null, inputTokens: null, outputTokens: null, level: 'ERROR', statusMessage: '시간 초과', promptName: 'qa', promptVersion: 3 }
    const fetcher = ok({ ...trace, input: { q: '질문' }, output: '답', observations: [observation] })
    const detail = await new HttpLlmOpsRepository(fetcher).trace('t/1')
    expect(callsOf(fetcher)[0][0]).toBe('/api/v1/operations/llmops/traces/t%2F1')
    expect(detail.input).toEqual({ q: '질문' })
    expect(detail.output).toBe('답')
    expect(detail.observations).toEqual([observation])
  })

  it('계약상 선택 값인 입력·출력이 없고 실행 단계의 시작 시각이 비어 와도 추적 상세를 거절하지 않는다', async () => {
    const observation = { id: 'o1', name: 'retrieve', type: 'SPAN', startTime: null, endTime: null, latencyMs: null, level: 'DEFAULT' }
    const detail = await new HttpLlmOpsRepository(ok({ ...trace, observations: [observation] })).trace('t1')
    expect(detail.observations.map((o) => o.startTime ?? null)).toEqual([null])
  })

  it('지표는 기간·묶음을 query로 보내고 데이터가 없는 비율은 null로 둔다', async () => {
    const row = { key: '2026-11-19', requests: 5, failureRate: 0.2, timeoutRate: 0, p50LatencyMs: 300, p95LatencyMs: 900, inputTokens: 10, outputTokens: 5, costUser: 0, costPlatform: 0.01 }
    const fetcher = ok({ rows: [row], adoptionRate: 0.5, approvalRate: null, filterRestoreRate: null })
    const metrics = await new HttpLlmOpsRepository(fetcher).metrics({ from: '2026-11-12T00:00:00.000Z', to: '2026-11-19T00:00:00.000Z', groupBy: 'model' })
    expect(callsOf(fetcher)[0][0]).toBe('/api/v1/operations/llmops/metrics?from=2026-11-12T00%3A00%3A00.000Z&to=2026-11-19T00%3A00%3A00.000Z&groupBy=model')
    expect(metrics).toEqual({ rows: [row], adoptionRate: 0.5, approvalRate: null, filterRestoreRate: null })
  })
})

describe('HttpLlmOpsRepository 프롬프트·모델·평가·설정', () => {
  const version = { version: 2, labels: ['production'], createdAt: AT, evaluation: { runId: 'r1', passed: true, createdAt: AT } }

  it('프롬프트 목록·상세·새 버전 등록은 이름을 인코딩해 보낸다', async () => {
    const fetcher = ok({ items: [{ name: 'qa answer' }], page: 0, size: 100, total: 1 })
    const repo = new HttpLlmOpsRepository(fetcher)
    // 목록은 버전을 안 줘도 읽는다(상세가 채운다).
    expect(await repo.prompts()).toEqual([{ name: 'qa answer', versions: [] }])
    const detail = new HttpLlmOpsRepository(ok({ name: 'qa answer', versions: [version] }))
    expect(await detail.prompt('qa answer')).toEqual({ name: 'qa answer', versions: [version] })
    await repo.createPromptVersion('qa answer', { prompt: '본문', commitMessage: '메모' })
    expect(callsOf(fetcher).map(([url, init]) => [url, init.method, init.body])).toEqual([
      ['/api/v1/operations/llmops/prompts', 'GET', undefined],
      ['/api/v1/operations/llmops/prompts/qa%20answer', 'POST', JSON.stringify({ prompt: '본문', commitMessage: '메모' })],
    ])
  })

  it('프롬프트 버전의 등록 시각이 비어 와도(Langfuse에 값이 없을 때) 상세를 거절하지 않는다', async () => {
    const versions = [{ version: 1, labels: [], createdAt: null }, { version: 2, labels: ['production'] }]
    const detail = await new HttpLlmOpsRepository(ok({ name: 'qa', versions })).prompt('qa')
    expect(detail.versions.map((v) => v.createdAt ?? null)).toEqual([null, null])
  })

  it('production 승격은 PUT으로 버전을 보내고, 평가 미통과 409(EVALUATION_REQUIRED)는 서버의 영문 문구 대신 정해진 한국어 문구로 알린다', async () => {
    const fetcher = ok({})
    await new HttpLlmOpsRepository(fetcher).promote('qa', 3)
    expect(callsOf(fetcher)[0].slice(0, 2).map((v) => typeof v === 'string' ? v : [v.method, v.body])).toEqual(['/api/v1/operations/llmops/prompts/qa/production', ['PUT', JSON.stringify({ version: 3 })]])
    const rejected = new HttpLlmOpsRepository(fail(409, { code: 'EVALUATION_REQUIRED', message: 'A passing regression evaluation is required for this prompt version.' })).promote('qa', 3)
    await expect(rejected).rejects.toThrow(new OperationsRejected('회귀 평가를 통과한 버전만 production으로 올릴 수 있어요.'))
    // 다른 409(영문 고정 문구)나 본문이 없는 409는 일반 충돌 안내다.
    await expect(new HttpLlmOpsRepository(fail(409, { code: 'CONFLICT', message: 'Resource conflicts with its current state.' })).promote('qa', 3)).rejects.toThrow(new OperationsError('다른 변경과 충돌했어요. 목록을 새로고침한 뒤 다시 시도해 주세요.'))
    await expect(new HttpLlmOpsRepository(fail(409, {})).promote('qa', 3)).rejects.toThrow(new OperationsError('다른 변경과 충돌했어요. 목록을 새로고침한 뒤 다시 시도해 주세요.'))
  })

  it.each([
    [400, 'INVALID_REQUEST', 'Invalid request.', '입력값을 확인해 주세요.'],
    [404, 'NOT_FOUND', 'Resource not found.', '대상을 찾을 수 없어요. 목록을 새로고침해 주세요.'],
    [409, 'CONFLICT', 'Resource conflicts with its current state.', '다른 변경과 충돌했어요. 목록을 새로고침한 뒤 다시 시도해 주세요.'],
    [422, 'REQUEST_FAILED', 'Request could not be completed.', '입력값을 확인해 주세요.'],
  ])('변경 요청의 %s 응답이 서버의 영문 고정 문구면 한국어 안내로 바꾼다', async (status, code, message, korean) => {
    const body = { code, message }
    await expect(new HttpLlmOpsRepository(fail(status, body)).updateSettings({ leakSampleRate: 0.5 })).rejects.toThrow(new OperationsError(korean))
    await expect(new HttpOperationsDashboardRepository(fail(status, body)).updateAlert('a1', 'resolved', '')).rejects.toThrow(new OperationsError(korean))
    await expect(new HttpJobMonitorRepository(fail(status, body)).cancelSchedule('s1')).rejects.toThrow(new OperationsError(korean))
  })

  it('상위 서비스가 준 안내(code UPSTREAM…이거나 한글로 쓴 문구)는 그대로 보이고, 502 연결 실패는 한국어 안내다', async () => {
    const retry = (status: number, body: unknown) => new HttpJobMonitorRepository(fail(status, body)).retry('j1')
    // 서버는 상위 서비스 거절을 일반 오류와 같은 code로 주되 문구만 상위 서비스의 한글 안내로 바꾼다.
    await expect(retry(409, { code: 'CONFLICT', message: '이미 다시 실행한 기록이에요.' })).rejects.toThrow(new OperationsRejected('이미 다시 실행한 기록이에요.'))
    await expect(retry(409, { code: 'UPSTREAM_REJECTED', message: 'Content refused the request.' })).rejects.toThrow(new OperationsRejected('Content refused the request.'))
    await expect(retry(502, { code: 'UPSTREAM_FAILED', message: 'Upstream service request failed.' })).rejects.toThrow(new OperationsError('연결된 서비스(Langfuse·AI·Core·Content)에서 처리하지 못했어요. 잠시 후 다시 시도해 주세요.'))
  })

  it('연결된 서비스 실패(502)는 반영 여부를 단정하지 않는 안내로 바꾼다', async () => {
    const message = '연결된 서비스(Langfuse·AI·Core·Content)에서 처리하지 못했어요. 잠시 후 다시 시도해 주세요.'
    await expect(new HttpLlmOpsRepository(fail(502, { code: 'UPSTREAM_FAILED', message: 'langfuse down' })).models()).rejects.toThrow(new OperationsError(message))
    await expect(new HttpLlmOpsRepository(fail(502)).createModel({ modelName: 'm', matchPattern: 'm', inputPrice: 0, outputPrice: 0 })).rejects.toThrow(new OperationsError(message))
  })

  it('모델은 목록을 읽고 토큰당 단가로 등록한다', async () => {
    const model = { id: 'm1', modelName: 'gpt-x', matchPattern: '^gpt-x$', inputPrice: 0.0000025, outputPrice: 0.00001 }
    const fetcher = ok({ items: [model], page: 0, size: 100, total: 1 })
    const repo = new HttpLlmOpsRepository(fetcher)
    expect(await repo.models()).toEqual([model])
    await repo.createModel({ modelName: 'gpt-x', matchPattern: '^gpt-x$', inputPrice: 0.0000025, outputPrice: 0.00001 })
    expect(callsOf(fetcher).map(([url, init]) => [url, init.method, init.body])[1]).toEqual(['/api/v1/operations/llmops/models', 'POST', JSON.stringify({ modelName: 'gpt-x', matchPattern: '^gpt-x$', inputPrice: 0.0000025, outputPrice: 0.00001 })])
  })

  it('평가는 목록·상세를 읽고 실행은 데이터셋·프롬프트·버전을 POST한다', async () => {
    const run = { runId: 'r1', dataset: 'qa-set', prompt: 'qa', version: 2, status: 'completed', passed: false, createdAt: AT, metrics: [{ name: 'faithfulness', score: 0.8, baseline: 0.9, delta: -0.1 }] }
    const fetcher = ok({ items: [{ ...run, metrics: undefined }], page: 0, size: 100, total: 1 })
    const repo = new HttpLlmOpsRepository(fetcher)
    expect((await repo.evaluations())[0].metrics).toEqual([])
    expect(await new HttpLlmOpsRepository(ok(run)).evaluation('r 1')).toEqual(run)
    await repo.runEvaluation({ dataset: 'qa-set', prompt: 'qa', version: 2 })
    expect(callsOf(fetcher).map(([url, init]) => [url, init.method, init.body])[1]).toEqual(['/api/v1/operations/llmops/evaluations', 'POST', JSON.stringify({ dataset: 'qa-set', prompt: 'qa', version: 2 })])
    await expect(new HttpLlmOpsRepository(ok({ ...run, status: undefined })).evaluation('r1')).rejects.toThrow(FORMAT)
  })

  it('누설 검사·경고 기준·표본 비율은 계약 경로와 본문을 쓴다', async () => {
    const check = { id: 'c1', traceId: 't1', workId: 'w1', checkedAt: AT, matched: ['비공개 카드 제목'], suspected: true, reason: '제목이 답변에 그대로 나옴' }
    const rule = { key: 'ai_failure_rate', metric: 'failure_rate', threshold: null, windowMinutes: 60, enabled: false, updatedAt: AT }
    const fetcher = vi.fn(async (url: RequestInfo | URL) => Response.json(
      String(url).endsWith('/leak-checks') ? { items: [check], page: 0, size: 100, total: 1 } : String(url).endsWith('/rules') ? { items: [rule], page: 0, size: 100, total: 1 } : { leakSampleRate: 0.1 }))
    const repo = new HttpLlmOpsRepository(fetcher)
    expect(await repo.leakChecks()).toEqual([check])
    expect(await repo.alertRules()).toEqual([rule])
    expect(await repo.settings()).toEqual({ leakSampleRate: 0.1 })
    await repo.updateAlertRule('ai_failure_rate', { threshold: 0.2, windowMinutes: 30, enabled: true })
    await repo.updateSettings({ leakSampleRate: 0.5 })
    expect(callsOf(fetcher).map(([url, init]) => [url, init.method, init.body])).toEqual([
      ['/api/v1/operations/llmops/leak-checks', 'GET', undefined],
      ['/api/v1/operations/alerts/rules', 'GET', undefined],
      ['/api/v1/operations/llmops/settings', 'GET', undefined],
      ['/api/v1/operations/alerts/rules/ai_failure_rate', 'PUT', JSON.stringify({ threshold: 0.2, windowMinutes: 30, enabled: true })],
      ['/api/v1/operations/llmops/settings', 'PUT', JSON.stringify({ leakSampleRate: 0.5 })],
    ])
  })
})

describe('HttpJobMonitorRepository', () => {
  const run = { id: 'j1', kind: 'content_preprocessing', source: 'content-preprocessing', status: 'running', trigger: 'user', progress: { done: 3, total: 12 }, startedAt: AT, finishedAt: null, error: null, targetId: 'w1' }

  it('실행 기록은 채운 조건만 query로 보내고 전처리 출처 실패(unavailable)를 그대로 준다', async () => {
    const fetcher = ok({ items: [run], page: 0, size: 20, total: 1, unavailable: ['content-preprocessing'] })
    const repo = new HttpJobMonitorRepository(fetcher)
    expect(await repo.runs({ status: 'failed', kind: '', page: 2 })).toEqual({ items: [run], page: 0, size: 20, total: 1, unavailable: ['content-preprocessing'] })
    await repo.runs({ status: '', kind: 'regression_eval', page: 0 })
    expect(callsOf(fetcher).map(([url]) => url)).toEqual(['/api/v1/operations/jobs/runs?status=failed&page=2', '/api/v1/operations/jobs/runs?kind=regression_eval&page=0'])
    await expect(new HttpJobMonitorRepository(ok({ items: [{ ...run, status: undefined }], page: 0, size: 20, total: 1 })).runs({ status: '', kind: '', page: 0 })).rejects.toThrow(FORMAT)
  })

  it('실패 재실행(202)은 POST, 진행 중·이미 재실행된 기록의 거절(409)은 서버 문구를 그대로 알린다', async () => {
    const fetcher = ok({}, 202)
    await new HttpJobMonitorRepository(fetcher).retry('j 1')
    expect(callsOf(fetcher).map(([url, init]) => [url, init.method])).toEqual([['/api/v1/operations/jobs/runs/j%201/retry', 'POST']])
    await expect(new HttpJobMonitorRepository(fail(409, { code: 'NOT_FAILED', message: '실패한 작업만 다시 실행할 수 있어요.' })).retry('j1')).rejects.toThrow(new OperationsRejected('실패한 작업만 다시 실행할 수 있어요.'))
  })

  it('일정 등록의 종류 미등록·cron 오류(422)는 서버 문구를 그대로 알리고, 문구가 없으면 입력 확인 안내다', async () => {
    const input = { kind: 'nope', cron: 'x', enabled: true, params: {} }
    await expect(new HttpJobMonitorRepository(fail(422, { code: 'UNKNOWN_KIND', message: '등록되지 않은 작업 종류예요.' })).createSchedule(input)).rejects.toThrow(new OperationsRejected('등록되지 않은 작업 종류예요.'))
    await expect(new HttpJobMonitorRepository(fail(422, {})).createSchedule(input)).rejects.toThrow(new OperationsError('입력값을 확인해 주세요.'))
  })

  it('일정은 목록을 읽고 등록·변경·취소는 계약 경로와 본문을 쓴다', async () => {
    const schedule = { id: 's1', kind: 'alert_cleanup', cron: '0 0 4 * * *', enabled: true, params: { days: 90 }, createdAt: AT, updatedAt: AT, lastRun: null }
    // 등록은 201+Location, 변경·취소는 본문 없는 성공이다.
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => init?.method === 'GET' ? Response.json({ items: [{ ...schedule, params: null }], page: 0, size: 100, total: 1 }) : init?.method === 'POST' ? new Response(null, { status: 201, headers: { Location: '/api/v1/operations/jobs/schedules/s2' } }) : new Response(null, { status: 204 }))
    const repo = new HttpJobMonitorRepository(fetcher)
    // jsonb params가 비어 오면 빈 객체다.
    expect(await repo.schedules()).toEqual([{ ...schedule, params: {} }])
    await repo.createSchedule({ kind: 'alert_cleanup', cron: '0 0 4 * * *', enabled: true, params: { days: 90 } })
    await repo.updateSchedule('s 1', { kind: 'alert_cleanup', cron: '0 0 5 * * *', enabled: false, params: {} })
    await repo.cancelSchedule('s 1')
    expect(callsOf(fetcher).map(([url, init]) => [url, init.method, init.body])).toEqual([
      ['/api/v1/operations/jobs/schedules', 'GET', undefined],
      ['/api/v1/operations/jobs/schedules', 'POST', JSON.stringify({ kind: 'alert_cleanup', cron: '0 0 4 * * *', enabled: true, params: { days: 90 } })],
      ['/api/v1/operations/jobs/schedules/s%201', 'PUT', JSON.stringify({ kind: 'alert_cleanup', cron: '0 0 5 * * *', enabled: false, params: {} })],
      ['/api/v1/operations/jobs/schedules/s%201', 'DELETE', undefined],
    ])
  })
})

describe('HttpLlmOpsRepository AI 파이프라인(DEC-58)', () => {
  const range = { from: '2026-11-14T00:00:00.000Z', to: '2026-11-21T00:00:00.000Z' }
  const node = { id: 'guard', label: 'Decision Guard', next: ['main'], standalone: false, count: 12, errors: 1, p95LatencyMs: 820, promptNames: ['decision_guard.judge'] }
  const record = {
    id: 'o1', traceId: 't1', name: 'decision_guard', type: 'SPAN', startTime: AT, latencyMs: 120, level: 'DEFAULT',
    input: { request: '질문' }, output: { allowed: true, reason: null, capabilities: ['qa'] }, metadata: { source: 'writing' },
  }
  const recordsOf = (items: unknown[]) => ({ items, page: 1, size: 20, total: 41 })
  const q = { nodeId: 'qa/1', ...range, level: 'ERROR', page: 1 }

  it('노드 목록은 기간을 query로 보내 {nodes}에서 꺼내고, p95 지연과 프롬프트 이름이 비어 와도 받는다', async () => {
    const apply = { ...node, id: 'apply', next: [], standalone: true, p95LatencyMs: null, promptNames: [] }
    const mcp = { id: 'mcp', label: 'Content MCP 도구', next: [], standalone: false, count: 0, errors: 0 }
    const fetcher = ok({ nodes: [node, apply, mcp] })
    const nodes = await new HttpLlmOpsRepository(fetcher).pipeline(range)
    expect(callsOf(fetcher)[0][0]).toBe('/api/v1/operations/llmops/pipeline?from=2026-11-14T00%3A00%3A00.000Z&to=2026-11-21T00%3A00%3A00.000Z')
    expect(nodes).toEqual([node, apply, { ...mcp, promptNames: [] }])
  })

  it('노드가 계약과 다른 모양이면(건수가 글자, next가 배열이 아님, standalone 없음, nodes 없음) 거부한다', async () => {
    const wrong = [{ nodes: [{ ...node, count: '12' }] }, { nodes: [{ ...node, next: 'main' }] }, { nodes: [{ ...node, standalone: undefined }] }, { items: [node] }]
    for (const bad of wrong) await expect(new HttpLlmOpsRepository(ok(bad)).pipeline(range)).rejects.toThrow(FORMAT)
  })

  it('노드 기록은 노드 id를 인코딩하고 채운 조건만 query로 보내며, 입력·출력·메타데이터는 모양을 가리지 않고 그대로 준다', async () => {
    const failed = { id: 'o2', traceId: 't2', name: 'main_agent', type: 'GENERATION', startTime: AT, latencyMs: null, level: 'ERROR', statusMessage: '실패', model: 'm', promptName: 'main', promptVersion: 3, output: '글' }
    const fetcher = ok(recordsOf([record, failed]))
    const repo = new HttpLlmOpsRepository(fetcher)
    const page = await repo.pipelineRecords(q)
    await repo.pipelineRecords({ nodeId: 'guard', from: '', to: '', level: '', page: 0 })
    expect(callsOf(fetcher).map(([url]) => url)).toEqual([
      '/api/v1/operations/llmops/pipeline/qa%2F1/records?from=2026-11-14T00%3A00%3A00.000Z&to=2026-11-21T00%3A00%3A00.000Z&level=ERROR&page=1',
      '/api/v1/operations/llmops/pipeline/guard/records?page=0',
    ])
    expect(page).toMatchObject({ page: 1, size: 20, total: 41, unavailable: [] })
    expect(page.items[0]).toEqual(record)
    expect(page.items[1]).toMatchObject({ latencyMs: null, level: 'ERROR', statusMessage: '실패', promptName: 'main', promptVersion: 3, output: '글' })
  })

  it('기록의 모양이 다르면 거부한다(수준이 글자가 아님, 합계 없음)', async () => {
    await expect(new HttpLlmOpsRepository(ok(recordsOf([{ ...record, level: 3 }]))).pipelineRecords(q)).rejects.toThrow(FORMAT)
    await expect(new HttpLlmOpsRepository(ok({ items: [record], page: 0, size: 20 })).pipelineRecords(q)).rejects.toThrow(FORMAT)
  })

  it('권한 없음(403)은 OperationsForbidden이고 Langfuse 같은 연결 서비스 실패(502)는 반영 여부를 단정하지 않는 안내다', async () => {
    await expect(new HttpLlmOpsRepository(fail(403)).pipeline(range)).rejects.toThrow(OperationsForbidden)
    await expect(new HttpLlmOpsRepository(fail(403)).pipelineRecords(q)).rejects.toThrow(OperationsForbidden)
    await expect(new HttpLlmOpsRepository(fail(502, { code: 'UPSTREAM_FAILED', message: 'Upstream failed.' })).pipeline(range))
      .rejects.toThrow(new OperationsError('연결된 서비스(Langfuse·AI·Core·Content)에서 처리하지 못했어요. 잠시 후 다시 시도해 주세요.'))
  })

  it('추적 상세의 단계는 부모 단계와 입력·출력·메타데이터까지 준다(실행 흐름 트리)', async () => {
    const root = { id: 'o1', name: 'orchestration', type: 'SPAN', startTime: AT, level: 'DEFAULT' }
    const step = {
      id: 'o2', parentObservationId: 'o1', name: 'decision_guard.generation', type: 'GENERATION', startTime: AT, endTime: AT, latencyMs: 80, model: 'gpt', level: 'DEFAULT',
      input: [{ role: 'user', content: '질문' }], output: { answers: [] }, metadata: { turn: 1 },
    }
    const detail = await new HttpLlmOpsRepository(ok({ ...trace, observations: [root, step, { ...root, id: 'o3', parentObservationId: null }] })).trace('t1')
    expect(detail.observations.map((o) => [o.id, o.parentObservationId ?? null])).toEqual([['o1', null], ['o2', 'o1'], ['o3', null]])
    expect(detail.observations[1]).toMatchObject({ input: [{ role: 'user', content: '질문' }], output: { answers: [] }, metadata: { turn: 1 } })
  })
})
