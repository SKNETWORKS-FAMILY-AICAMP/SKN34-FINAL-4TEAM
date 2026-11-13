import { z } from 'zod'

import type { ChatEvent, ChatHistory, ChatMessageInput, ChatReply, ChatSession, ChatStep } from '../../domain/entities/writingChat'
import type { WritingChatRepository } from '../../domain/repositories/WritingChatRepository'
import { SessionExpired } from '../../domain/repositories/ProfileRepository'
import { authVersion, protectedRequest } from '../api/auth'
import { csrf } from '../api/csrf'
import { HttpEpisodeRepository } from './HttpEpisodeRepository'

const step: z.ZodType<ChatStep> = z.object({
  feature: z.string(),
  status: z.enum(['completed', 'failed', 'not_started']),
  result: z.object({
    claims: z.array(z.object({ text: z.string() })).optional(),
    gaps: z.array(z.string()).optional(),
    text: z.string().optional(),
    before: z.string().optional(),
    after: z.string().optional(),
    findings: z.array(z.object({ text: z.string(), verdict: z.string(), sourceUrls: z.array(z.string()) })).optional(),
  }).nullish(),
  error: z.string().nullish(),
  approval: z.enum(['approved', 'declined']).nullish(),
  applied: z.object({ episode: z.number().int(), revision: z.number().int() }).nullish(),
})
const reply: z.ZodType<ChatReply> = z.object({
  status: z.enum(['completed', 'failed', 'clarify', 'rejected', 'unsupported', 'needs_input', 'waiting', 'cancelled']),
  message: z.string().nullish(),
  steps: z.array(step),
  missingInputs: z.array(z.string()),
  awaitingApproval: z.string().nullish(),
})
const session: z.ZodType<ChatSession> = z.object({ threadId: z.string(), title: z.string(), updatedAt: z.string() })
const history: z.ZodType<ChatHistory> = z.object({
  threadId: z.string(), title: z.string(), turns: z.array(z.object({ request: z.string(), reply: reply.nullable() })),
})
const events = {
  plan: z.object({ steps: z.array(step) }).transform((d) => ({ type: 'plan' as const, ...d })),
  started: z.object({ feature: z.string() }).transform((d) => ({ type: 'started' as const, ...d })),
  step: step.transform((s) => ({ type: 'step' as const, step: s })),
  waiting: z.object({ steps: z.array(step), missingInputs: z.array(z.string()).default([]), awaitingApproval: z.string().nullish() })
    .transform((d) => ({ type: 'waiting' as const, ...d })),
  done: reply.transform((r) => ({ type: 'done' as const, reply: r })),
  error: z.object({ message: z.string() }).transform((d) => ({ type: 'error' as const, ...d })),
}
const CUT = '응답이 중간에 끊겼어요. 대화를 다시 불러와 저장된 내용을 확인해 주세요.'
// 오케스트레이션 상한(3분)보다 조금 길게 기다린다. 넘으면 끊고 저장 여부는 이력으로 확인한다.
const STREAM_TIMEOUT = 200_000

const sessions = (workId: string) => `/works/${encodeURIComponent(workId)}/chat/sessions`
const one = (workId: string, threadId: string) => `${sessions(workId)}/${encodeURIComponent(threadId)}`

/** SSE 블록 하나(`event:`·`data:` 줄)를 이벤트로. `:` 주석(연결 유지)과 모르는 이벤트는 버린다. */
function parse(block: string): ChatEvent | null {
  let name = 'message'
  const data: string[] = []
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith('event:')) name = line.slice(6).trim()
    else if (line.startsWith('data:')) data.push(line.slice(5).trimStart())
  }
  const schema = events[name as keyof typeof events]
  if (!schema || !data.length) return null
  let value: unknown
  try { value = JSON.parse(data.join('\n')) } catch { value = undefined }
  const parsed = schema.safeParse(value)
  return parsed.success ? parsed.data : { type: 'error', message: '서버 응답 형식을 확인할 수 없어요.' }
}

/** 집필 AI 채팅 세션 API. 일반 요청은 HttpEpisodeRepository.request(Bearer·CSRF·오류 문구)를, 전송은 fetch 스트림을 쓴다. */
export class HttpWritingChatRepository implements WritingChatRepository {
  private readonly api: HttpEpisodeRepository
  private readonly fetcher?: typeof fetch
  constructor(fetcher?: typeof fetch) { this.fetcher = fetcher; this.api = new HttpEpisodeRepository(fetcher) }

  sessions(workId: string, signal?: AbortSignal) { return this.api.request(sessions(workId), z.array(session), 'GET', undefined, signal) }
  async open(workId: string, signal?: AbortSignal) {
    return (await this.api.request(sessions(workId), z.object({ threadId: z.string() }), 'POST', undefined, signal)).threadId
  }
  history(workId: string, threadId: string, signal?: AbortSignal) { return this.api.request(one(workId, threadId), history, 'GET', undefined, signal) }
  rename(workId: string, threadId: string, title: string) { return this.api.request(one(workId, threadId), z.undefined(), 'PATCH', { title }) }
  remove(workId: string, threadId: string) { return this.api.request(one(workId, threadId), z.undefined(), 'DELETE') }
  truncate(workId: string, threadId: string, index: number) {
    return this.api.request(`${one(workId, threadId)}/messages/${index}`, z.undefined(), 'DELETE')
  }

  async send(workId: string, threadId: string, input: ChatMessageInput, onEvent: (event: ChatEvent) => void, signal?: AbortSignal, editIndex?: number) {
    const version = authVersion()
    const requestSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(STREAM_TIMEOUT)]) : AbortSignal.timeout(STREAM_TIMEOUT)
    const method = editIndex === undefined ? 'POST' : 'PUT'
    const path = `/api/v1${one(workId, threadId)}/messages${editIndex === undefined ? '' : `/${editIndex}`}`
    let response: Response
    try {
      response = await protectedRequest(path, {
        method, signal: requestSignal, body: JSON.stringify(input),
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', 'X-CSRF-TOKEN': await csrf(requestSignal) },
      }, version, false, { fetcher: this.fetcher, allowHttpError: true })
    } catch (error) {
      if (error instanceof SessionExpired) throw new SessionExpired('서버 인증이 필요합니다. 로그인한 뒤 다시 시도해 주세요.')
      throw error
    }
    if (!response.ok || !response.body) {
      const detail = z.object({ detail: z.string() }).safeParse(await response.json().catch(() => undefined))
      throw new Error(detail.success ? detail.data.detail : '집필 AI에 보내지 못했어요. 잠시 후 다시 시도해 주세요.')
    }
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
    let buffer = '', finished = false
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += value
      const blocks = buffer.split(/\r?\n\r?\n/)
      buffer = blocks.pop() ?? ''
      for (const block of blocks) {
        const event = parse(block)
        if (!event) continue
        finished ||= event.type === 'done' || event.type === 'error'
        onEvent(event)
      }
    }
    if (!finished) onEvent({ type: 'error', message: CUT })
  }
}
