import { z } from 'zod'

import { INSUFFICIENT_CREDIT_MESSAGE, type ProposalRequest, type SerialScheduleInput } from '../../domain/entities/aiSerial'
import type { SerialRepository } from '../../domain/repositories/SerialRepository'
import { getAccessToken } from '../api/auth'
import { HttpEpisodeRepository } from './HttpEpisodeRepository'

const instant = z.iso.datetime({ offset: true })
const day = z.enum(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'])
const settings = z.object({ enabled: z.boolean(), days: z.array(day), time: z.string().regex(/^\d{2}:\d{2}$/), direction: z.string() })
const record = z.object({
  id: z.string(), episodeNumber: z.number().int().positive(), status: z.enum(['open', 'queued', 'running', 'published', 'failed']),
  publishedEpisodeNumber: z.number().int().positive().nullable(), failureReason: z.string().nullable(), closedAt: instant.nullable(),
})
const choice = z.object({ id: z.string(), position: z.number().int().positive(), text: z.string(), votes: z.number().int().nonnegative() })
const proposal = z.object({
  id: z.string(), authorName: z.string(), kind: z.enum(['general', 'simulation']), title: z.string(), body: z.string(),
  simulation: z.object({ premise: z.string(), beats: z.array(z.string()), scene: z.string().nullable() }).nullable(),
  likes: z.number().int().nonnegative(), likedByMe: z.boolean(), mine: z.boolean(), createdAt: instant,
})
const boardView = z.object({
  enabled: z.boolean(),
  board: z.object({ id: z.string(), episodeNumber: z.number().int().positive() }).nullable(),
  choices: z.array(choice), myChoiceId: z.string().nullable(), proposals: z.array(proposal), summary: z.string().nullable(),
})

const serial = (workId: string) => `/works/${encodeURIComponent(workId)}/ai-serial`
const board = (workId: string) => `/works/${encodeURIComponent(workId)}/serial-board`
const proposalPath = (workId: string, proposalId: string) => `${board(workId)}/proposals/${encodeURIComponent(proposalId)}`

/** 시뮬레이션 제안 글은 서버가 AI 장면 미리보기를 기다린다(Content의 AI 읽기 75초 + 저장·정산 여유): 공용 기본값(80초)보다 길게 기다린다. */
const SIMULATION_TIMEOUT_MS = 150_000

/** 크레딧 부족(409 INSUFFICIENT_CREDIT)만 정해 둔 문구로 바꾸고, 나머지 오류는 서버가 준 한국어 문구 그대로 던진다. */
const described = (error: unknown) => (error instanceof Error && error.cause === 'INSUFFICIENT_CREDIT' ? new Error(INSUFFICIENT_CREDIT_MESSAGE) : error)

/**
 * AI 자율 연재 API([계약](../../../../docs/design/ai-serial-contract.md)). Bearer·CSRF·응답 검증은 HttpEpisodeRepository.request를 그대로 쓴다.
 * 쓰기 응답 본문은 모양에 기대지 않고 쓰지 않는다(2xx면 성공, 화면은 성공 뒤 서버 값을 다시 읽는다).
 * 게시판 읽기는 누구나 하지만 로그인했으면 Bearer를 실어 내 투표·내 글·내 추천을 받는다.
 */
export class HttpSerialRepository implements SerialRepository {
  private readonly api: HttpEpisodeRepository
  constructor(fetcher?: typeof fetch) { this.api = new HttpEpisodeRepository(fetcher) }

  private async call<T>(path: string, schema: z.ZodType<T>, method: string, body?: unknown, signal?: AbortSignal, anonymous?: boolean, timeoutMs?: number) {
    try {
      return await this.api.request(path, schema, method, body, signal, anonymous, timeoutMs)
    } catch (error) {
      throw described(error)
    }
  }

  settings(workId: string, signal?: AbortSignal) { return this.call(serial(workId), settings, 'GET', undefined, signal) }
  async saveSettings(workId: string, input: SerialScheduleInput, signal?: AbortSignal) { await this.call(serial(workId), z.unknown(), 'PUT', input, signal) }
  async run(workId: string, signal?: AbortSignal) { await this.call(serial(workId) + '/run', z.unknown(), 'POST', undefined, signal) }
  boards(workId: string, signal?: AbortSignal) { return this.call(serial(workId) + '/boards', z.array(record), 'GET', undefined, signal) }
  board(workId: string, signal?: AbortSignal) { return this.call(board(workId), boardView, 'GET', undefined, signal, !getAccessToken()) }
  async vote(workId: string, choiceId: string, signal?: AbortSignal) { await this.call(board(workId) + '/vote', z.unknown(), 'PUT', { choiceId }, signal) }
  async cancelVote(workId: string, signal?: AbortSignal) { await this.call(board(workId) + '/vote', z.unknown(), 'DELETE', undefined, signal) }
  async submitProposal(workId: string, request: ProposalRequest, signal?: AbortSignal) {
    await this.call(board(workId) + '/proposals', z.unknown(), 'POST', request, signal, undefined, request.kind === 'simulation' ? SIMULATION_TIMEOUT_MS : undefined)
  }
  async likeProposal(workId: string, proposalId: string, signal?: AbortSignal) { await this.call(proposalPath(workId, proposalId) + '/like', z.unknown(), 'PUT', undefined, signal) }
  async unlikeProposal(workId: string, proposalId: string, signal?: AbortSignal) { await this.call(proposalPath(workId, proposalId) + '/like', z.unknown(), 'DELETE', undefined, signal) }
  async hideProposal(workId: string, proposalId: string, signal?: AbortSignal) { await this.call(proposalPath(workId, proposalId) + '/hide', z.unknown(), 'POST', undefined, signal) }
}
