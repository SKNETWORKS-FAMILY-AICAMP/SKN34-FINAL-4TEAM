import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../../test/testLocks'
import { login } from '../api/auth'
import { stepText, type ChatEvent } from '../../domain/entities/writingChat'
import { HttpWritingChatRepository } from './HttpWritingChatRepository'

const input = { episode: 2, episodeVersionId: 'v2', consent: true as const, request: '길드 규칙은?' }
/** 이벤트 경계와 상관없이 잘린 조각으로 SSE를 흘린다. */
const sse = (...chunks: string[]) => new Response(new ReadableStream({
  start(controller) { chunks.forEach((c) => controller.enqueue(new TextEncoder().encode(c))); controller.close() },
}), { headers: { 'Content-Type': 'text/event-stream' } })

afterEach(() => vi.unstubAllGlobals())
beforeEach(async () => {
  vi.stubGlobal('fetch', vi.fn(async (path: string) => path.endsWith('/csrf')
    ? Response.json({ csrfToken: 'chat-csrf' })
    : Response.json({ accessToken: 'chat-bearer', user: { id: 'writer', email: 'writer@example.invalid', nickname: '작가', operator: false } })))
  await login('writer@example.invalid', 'test-password')
})

describe('집필 AI 채팅 SSE', () => {
  it('잘린 조각을 이벤트 단위로 모아 순서대로 넘기고 주석 줄은 건너뛴다', async () => {
    const fetcher = vi.fn().mockResolvedValue(sse(
      ': ping\n\nevent: plan\ndata: {"steps":[{"feature":"story_context","status":"not_started"}]}\n\nevent: sta',
      'rted\ndata: {"feature":"story_context"}\n\n',
      'event: done\ndata: {"status":"completed","steps":[],"missingInputs":[]}\n\n'))
    const events: ChatEvent[] = []
    await new HttpWritingChatRepository(fetcher).send('w1', 't1', input, (e) => events.push(e))
    expect(fetcher.mock.calls[0][0]).toBe('/api/v1/works/w1/chat/sessions/t1/messages')
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: 'POST' })
    expect(new Headers(fetcher.mock.calls[0][1].headers).get('Authorization')).toBe('Bearer chat-bearer')
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual(input)
    expect(events.map((e) => e.type)).toEqual(['plan', 'started', 'done'])
    expect(events[1]).toEqual({ type: 'started', feature: 'story_context' })
  })

  it('메시지 수정은 그 순번으로 PUT하고, 스트림 전 HTTP 오류는 서버 문구로 던진다', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ detail: '작품을 찾을 수 없어요.' }, { status: 404 }))
    await expect(new HttpWritingChatRepository(fetcher).send('w1', 't1', input, () => {}, undefined, 3)).rejects.toThrow('작품을 찾을 수 없어요.')
    expect(fetcher.mock.calls[0][0]).toBe('/api/v1/works/w1/chat/sessions/t1/messages/3')
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: 'PUT' })
  })

  it('done 없이 끊긴 스트림은 성공으로 끝내지 않고 error 이벤트로 알린다', async () => {
    const events: ChatEvent[] = []
    await new HttpWritingChatRepository(vi.fn().mockResolvedValue(sse('event: plan\ndata: {"steps":[]}\n\n'))).send('w1', 't1', input, (e) => events.push(e))
    expect(events.at(-1)).toEqual({ type: 'error', message: '응답이 중간에 끊겼어요. 대화를 다시 불러와 저장된 내용을 확인해 주세요.' })
  })
})

it('JSON이 아닌 data 줄은 그 이벤트만 형식 오류로 알리고 뒤 이벤트를 계속 읽는다', async () => {
  const events: ChatEvent[] = []
  await new HttpWritingChatRepository(vi.fn().mockResolvedValue(sse('event: plan\ndata: {oops\n\n', 'event: done\ndata: {"status":"completed","steps":[],"missingInputs":[]}\n\n')))
    .send('w1', 't1', input, (e) => events.push(e))
  expect(events.map((e) => e.type)).toEqual(['error', 'done'])
})

describe('집필 AI 채팅 세션', () => {
  it('세션 목록과 이력을 읽는다', async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json([{ threadId: 't1', title: '길드', updatedAt: '2026-11-13T01:00:00Z' }]))
      .mockResolvedValueOnce(Response.json({ threadId: 't1', title: '길드', turns: [{ request: '질문', reply: { status: 'waiting', message: '승인해 주세요', steps: [], missingInputs: [], awaitingApproval: 'writing_editing' } }] }))
    const repo = new HttpWritingChatRepository(fetcher)
    expect(await repo.sessions('w1')).toEqual([{ threadId: 't1', title: '길드', updatedAt: '2026-11-13T01:00:00Z' }])
    const history = await repo.history('w1', 't1')
    expect(fetcher.mock.calls[1][0]).toBe('/api/v1/works/w1/chat/sessions/t1')
    expect(history.turns[0].reply?.awaitingApproval).toBe('writing_editing')
  })
})

describe('인물 시뮬레이션 단계 결과(#58)', () => {
  /** 계약 'SSE·응답' JSON 그대로의 장면 하나. */
  const scene = (extra: Record<string, unknown> = {}) => ({
    mode: 'if', premise: '카엘이 성문을 열었다면?',
    beats: [{ index: 0, text: '성문 대면', status: 'done' }],
    turns: [{
      index: 0, kind: 'character', characterId: 'card-1', characterName: '카엘', prose: '카엘이 문을 열었다.\n"왔구나."',
      checks: [{ kind: 'premise', passed: true, detail: '전제를 따랐어요.' }, { kind: 'voice_mix', passed: false, detail: '말투가 섞였어요.' }],
      regenerated: 1, evidence: [{ ref: 'card-2', source: 'graph' }, { ref: '3화 발췌', source: 'manuscript' }, { ref: '설정 본문', source: 'bm25' }],
      editedByAuthor: false,
    }],
    notes: [], status: 'completed', stopReason: null, ...extra,
  })
  const simStep = (result: unknown, extra: Record<string, unknown> = {}) => ({ feature: 'character_simulation', status: 'completed', result, ...extra })
  const BAD = '인물 시뮬레이션 결과 형식을 확인할 수 없어요.'
  const stepEvent = (data: unknown) => `event: step\ndata: ${JSON.stringify(data)}\n\n`
  const run = async (...chunks: string[]) => {
    const events: ChatEvent[] = []
    await new HttpWritingChatRepository(vi.fn().mockResolvedValue(sse(...chunks))).send('w1', 't1', input, (e) => events.push(e))
    return events
  }

  it('진행 중 step 이벤트의 장면을 검증해 엔티티로 바꾸고 턴마다 새 결과로 이어 보낸다', async () => {
    const second = { ...scene().turns[0], index: 1, characterId: 'card-3', characterName: '리안', prose: '"저예요."' }
    const events = await run(
      'event: plan\ndata: {"steps":[{"feature":"character_simulation","status":"not_started"}]}\n\n',
      stepEvent(simStep(scene({ status: 'running' }), { status: 'not_started' })),
      stepEvent(simStep(scene({ status: 'running', turns: [scene().turns[0], second] }))),
      'event: done\ndata: {"status":"completed","steps":[],"missingInputs":[]}\n\n')
    const steps = events.flatMap((e) => (e.type === 'step' ? [e.step] : []))
    expect(steps).toHaveLength(2)
    expect(steps[0].simulation).toEqual(scene({ status: 'running' }))
    expect(steps[0]).toMatchObject({ feature: 'character_simulation', status: 'not_started' })
    expect(steps[1].simulation?.turns.map((t) => t.characterName)).toEqual(['카엘', '리안'])
    expect(steps[1].simulation?.status).toBe('running')
    expect(steps[1].result).toBeUndefined()
  })

  it('저장된 대화의 승인 대기 응답에서도 같은 장면을 읽고, 흐름 모드의 null 전제·멈춤 사유도 받는다', async () => {
    const stopped = scene({ mode: 'flow', premise: null, beats: [{ index: 0, text: '성문 대면', status: 'rejected' }], status: 'stopped', stopReason: '카엘이 비트를 거부했어요.' })
    const fetcher = vi.fn().mockResolvedValue(Response.json({ threadId: 't1', title: '대화', turns: [{ request: '시뮬레이션', reply: {
      status: 'waiting', steps: [simStep(stopped)], missingInputs: [], awaitingApproval: 'character_simulation', approvalEpisode: 3,
    } }] }))
    const reply = (await new HttpWritingChatRepository(fetcher).history('w1', 't1')).turns[0].reply
    expect(reply?.approvalEpisode).toBe(3)
    expect(reply?.steps[0].simulation).toEqual(stopped)
  })

  it.each([
    ['턴에 지문(prose)이 없다', scene({ turns: [{ ...scene().turns[0], prose: undefined }] })],
    ['모드가 계약에 없다', scene({ mode: 'chaos' })],
    ['상태가 계약에 없다', scene({ status: 'sleeping' })],
    ['턴 종류가 계약에 없다', scene({ turns: [{ ...scene().turns[0], kind: 'chorus' }] })],
    ['끼어들기 기록의 턴 번호가 숫자가 아니다', scene({ notes: [{ afterTurn: '첫 턴', text: '문이 열린다' }] })],
    ['인물 줄에 인물 이름이 없다', scene({ turns: [{ ...scene().turns[0], characterName: undefined }] })],
    ['검사 종류가 계약에 없다', scene({ turns: [{ ...scene().turns[0], checks: [{ kind: 'mood', passed: true, detail: '' }] }] })],
    ['근거 출처가 계약에 없다', scene({ turns: [{ ...scene().turns[0], evidence: [{ ref: 'x', source: 'web' }] }] })],
    ['턴 목록이 배열이 아니다', scene({ turns: '카엘이 문을 열었다.' })],
    ['결과가 없다', null],
  ])('형식이 어긋난 결과(%s)는 가짜 장면을 만들지 않고 일반 단계처럼 실패로 알린다', async (_name, result) => {
    const events = await run(stepEvent(simStep(result)), 'event: done\ndata: {"status":"completed","steps":[],"missingInputs":[]}\n\n')
    const step = events.flatMap((e) => (e.type === 'step' ? [e.step] : []))[0]
    expect(step.status).toBe('failed')
    expect(step.error).toBe(BAD)
    expect(step.simulation).toBeUndefined()
    expect(step.result).toBeUndefined()
    expect(stepText(step)).toBe(`실패: ${BAD}`)
    expect(events.at(-1)?.type).toBe('done') // 한 단계의 형식 오류가 대화 전체를 못 읽게 만들지 않는다.
  })

  it('서버가 이미 실패로 보낸 단계는 결과 형식이 어긋나도 서버 사유를 지키고, 결과 없는 대기 단계는 그대로 둔다', async () => {
    const events = await run(
      stepEvent(simStep({}, { status: 'failed', error: '모델 호출에 실패했어요.' })),
      'event: plan\ndata: {"steps":[{"feature":"character_simulation","status":"not_started"}]}\n\n',
      'event: done\ndata: {"status":"completed","steps":[],"missingInputs":[]}\n\n')
    expect(events[0]).toMatchObject({ type: 'step', step: { status: 'failed', error: '모델 호출에 실패했어요.' } })
    expect(events[1]).toEqual({ type: 'plan', steps: [{ feature: 'character_simulation', status: 'not_started' }] })
  })

  it('다른 단계의 결과 모양은 그대로 읽는다', async () => {
    const events = await run(stepEvent({ feature: 'story_context', status: 'completed', result: { claims: [{ text: '밤에 닫는다' }] } }), 'event: done\ndata: {"status":"completed","steps":[],"missingInputs":[]}\n\n')
    expect(events[0]).toEqual({ type: 'step', step: { feature: 'story_context', status: 'completed', result: { claims: [{ text: '밤에 닫는다' }] } } })
  })
})

describe('시뮬레이션 무대(#58) 응답·요청', () => {
  const rawScene = (extra: Record<string, unknown> = {}) => ({
    mode: 'flow', premise: null, beats: [{ index: 0, text: '성문 대면', status: 'pending' }],
    turns: [
      { index: 0, kind: 'narration', characterId: null, characterName: '나레이션', prose: '성문은 닫혀 있었다.', checks: [], regenerated: 0, evidence: [], editedByAuthor: false },
      { index: 1, kind: 'character', characterId: 'card-1', characterName: '카엘', prose: '"열어라."', checks: [], regenerated: 0, evidence: [], editedByAuthor: true },
    ],
    notes: [{ afterTurn: 0, text: '비가 쏟아진다' }], status: 'paused', stopReason: null, ...extra,
  })
  const stepEvent = (data: unknown) => `event: step\ndata: ${JSON.stringify(data)}\n\n`
  const done = 'event: done\ndata: {"status":"completed","steps":[],"missingInputs":[]}\n\n'
  const run = async (...chunks: string[]) => {
    const events: ChatEvent[] = []
    await new HttpWritingChatRepository(vi.fn().mockResolvedValue(sse(...chunks))).send('w1', 't1', input, (e) => events.push(e))
    return events
  }
  const firstScene = (events: ChatEvent[]) => events.flatMap((e) => (e.type === 'step' ? [e.step] : []))[0].simulation

  it('턴 사이 대기(paused)·나레이션 줄(인물 없음)·작가가 고친 줄·끼어들기 기록을 그대로 읽는다', async () => {
    const events = await run(stepEvent({ feature: 'character_simulation', status: 'not_started', result: rawScene() }), done)
    const sim = firstScene(events)
    expect(sim?.status).toBe('paused')
    expect(sim?.turns[0]).toMatchObject({ kind: 'narration', characterId: null, characterName: '나레이션', editedByAuthor: false })
    expect(sim?.turns[1]).toMatchObject({ kind: 'character', characterId: 'card-1', editedByAuthor: true })
    expect(sim?.notes).toEqual([{ afterTurn: 0, text: '비가 쏟아진다' }])
  })

  it('무대 필드가 없는 이전 체크포인트의 결과는 고치지 않은 인물 줄·끼어들기 없음으로 읽는다', async () => {
    const { notes: _notes, ...old } = rawScene({ status: 'completed' })
    const turn = { index: 0, characterId: 'card-1', characterName: '카엘', prose: '"왔구나."', checks: [], regenerated: 0, evidence: [] }
    const sim = firstScene(await run(stepEvent({ feature: 'character_simulation', status: 'completed', result: { ...old, turns: [turn] } }), done))
    expect(sim?.turns).toEqual([{ ...turn, kind: 'character', editedByAuthor: false }])
    expect(sim?.notes).toEqual([])
  })

  it('waiting 이벤트와 저장된 대화의 응답이 awaitingScene을 알려 준다', async () => {
    const waiting = { steps: [{ feature: 'character_simulation', status: 'completed', result: rawScene() }], missingInputs: [], awaitingScene: 'character_simulation' }
    const events = await run(`event: waiting\ndata: ${JSON.stringify(waiting)}\n\n`, done)
    expect(events[0]).toMatchObject({ type: 'waiting', awaitingScene: 'character_simulation' })
    const fetcher = vi.fn().mockResolvedValue(Response.json({ threadId: 't1', title: '대화', turns: [{ request: '시뮬레이션', reply: { status: 'waiting', ...waiting } }] }))
    expect((await new HttpWritingChatRepository(fetcher).history('w1', 't1')).turns[0].reply?.awaitingScene).toBe('character_simulation')
  })

  it('awaitingScene이 없는 대기·승인 응답은 그대로 읽는다', async () => {
    const events = await run('event: waiting\ndata: {"steps":[],"awaitingApproval":"character_simulation"}\n\n', done)
    expect(events[0]).toEqual({ type: 'waiting', steps: [], missingInputs: [], awaitingApproval: 'character_simulation' })
  })

  it('operation과 장면 조작(resume.scene)을 본문 그대로 POST한다', async () => {
    const send = async (body: object) => {
      const fetcher = vi.fn().mockResolvedValue(sse(done))
      await new HttpWritingChatRepository(fetcher).send('w1', 't1', { ...input, ...body } as never, () => {})
      return JSON.parse(fetcher.mock.calls[0][1].body)
    }
    expect(await send({ request: '만약 카엘이 성문을 열었다면?', operation: 'character_simulation' }))
      .toMatchObject({ request: '만약 카엘이 성문을 열었다면?', operation: 'character_simulation', consent: true })
    expect(await send({ resume: { approved: true, scene: { action: 'edit', turn: 1, text: '"열어라."' } } }))
      .toMatchObject({ resume: { approved: true, scene: { action: 'edit', turn: 1, text: '"열어라."' } } })
  })
})

