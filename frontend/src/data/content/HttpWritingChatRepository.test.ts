import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import '../../test/testLocks'
import { login } from '../api/auth'
import type { ChatEvent } from '../../domain/entities/writingChat'
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
