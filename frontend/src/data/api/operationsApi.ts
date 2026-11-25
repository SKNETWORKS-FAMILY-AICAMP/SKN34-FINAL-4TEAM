import { z } from 'zod'

import type { AdminActivity } from '../../domain/entities/adminActivity'
import type { AdminAccount, AdminInput, MemberItem, MemberQuery } from '../../domain/entities/member'
import { OperationsError, OperationsForbidden, OperationsRejected } from '../../domain/entities/operations'
import type { OperationsComment } from '../../domain/entities/operationsComment'
import type { OperationsEpisode, OperationsWork } from '../../domain/entities/operationsWork'
import { EPISODE_INHERITED_MESSAGE } from '../../domain/entities/operationsWork'
import type { OperationsWorld } from '../../domain/entities/operationsWorld'
import type { Report, ReportInput, ReportStatus, ReviewDecision } from '../../domain/entities/report'
import type { SupportInquiry, SupportInquiryInput, SupportInquiryStatus } from '../../domain/entities/supportInquiry'
import type { AdminActivityRepository } from '../../domain/repositories/AdminActivityRepository'
import type { MemberRepository } from '../../domain/repositories/MemberRepository'
import type { OperationsCommentRepository } from '../../domain/repositories/OperationsCommentRepository'
import type { OperationsWorkRepository } from '../../domain/repositories/OperationsWorkRepository'
import type { OperationsWorldRepository } from '../../domain/repositories/OperationsWorldRepository'
import { SessionExpired } from '../../domain/repositories/ProfileRepository'
import type { ReportRepository } from '../../domain/repositories/ReportRepository'
import type { SupportInquiryRepository } from '../../domain/repositories/SupportInquiryRepository'
import { authVersion, protectedRequest } from './auth'

const instant = z.string().datetime({ offset: true })
const history = z.object({ id: z.string(), type: z.string(), actorId: z.string(), body: z.string().nullable(), createdAt: instant })
// 신고 대상 종류(결정 D): 종류가 없는 옛 응답은 작품 신고이고, 세계관 신고는 작품 필드가 비어 올 수 있어 null로 통일한다.
const nullable = <T extends z.ZodType>(schema: T) => schema.nullish().transform((value) => value ?? null)
const report = z.object({
  id: z.string(), kind: z.enum(['RIGHTS', 'HARMFUL']), targetType: z.enum(['work', 'episode', 'world']).default('work'),
  workId: nullable(z.string()), workTitle: nullable(z.string()), workOwnerId: nullable(z.string()),
  episodeNumber: nullable(z.number().int().positive()), worldId: nullable(z.string()), worldName: nullable(z.string()),
  reporterId: z.string(), reason: z.string(), evidence: z.string(), status: z.enum(['RECEIVED', 'ACCEPTED', 'REJECTED']),
  contentRestricted: z.boolean(), createdAt: instant, updatedAt: instant, history: z.array(history).optional(),
})
const member = z.object({ id: z.string(), email: z.string(), nickname: z.string(), role: z.enum(['MEMBER', 'ADMIN']), restricted: z.boolean(), createdAt: instant })
const admin = member.extend({ permissions: z.array(z.string()) })
// 운영 세계관(결정 B): 응답은 맨 배열이고 닉네임·장르·연결 작품이 없으면 null이다(연결 작품은 계약 보완 1).
const operationsWorld: z.ZodType<OperationsWorld> = z.object({
  worldId: z.string(), ownerId: z.string(), ownerName: nullable(z.string()), name: z.string(),
  visibility: z.enum(['public', 'private']), published: z.boolean(), restricted: z.boolean(),
  genre: nullable(z.string()), createdAt: instant, linkedWorkId: nullable(z.string()),
})
const operationsEpisode: z.ZodType<OperationsEpisode> = z.object({
  number: z.number().int().positive(), title: z.string(), publicationStatus: z.string(), restricted: z.boolean(), inherited: z.boolean(),
})
const forkIntegrity = z.object({
  basisEpisode: z.number().int().positive(),
  forkHash: z.string().regex(/^[0-9a-f]{64}$/),
  sourceHash: z.string().regex(/^[0-9a-f]{64}$/),
  matches: z.boolean(),
  characterStateStatus: z.literal('unavailable'),
})
const operationsWork = z.object({
  workId: z.string(), ownerId: z.string(), title: z.string(), authorName: z.string(),
  originKind: z.enum(['original', 'fork']), creationType: z.enum(['original', 'external_derivative']),
  rightsConfirmed: z.boolean(), visibility: z.enum(['public', 'private']), restricted: z.boolean(),
})
// 운영 DTO는 commentId·workId·authorId를 모두 문자열로 받습니다(비 UUID 한 행이 목록 전체를 깨뜨리지 않게).
const operationsComment = z.object({
  commentId: z.string(), workId: z.string(), workTitle: z.string(), episodeNumber: z.number().int().positive(),
  authorId: z.string(), authorName: z.string(), body: z.string(), likeCount: z.number().int().nonnegative(),
  hidden: z.boolean(), createdAt: instant,
})
const adminActivity = z.object({
  id: z.string(), actorId: z.string(), actorNickname: z.string().nullable(), action: z.string(), targetType: z.string(),
  targetId: z.string(), detail: z.string().nullable(), createdAt: instant,
})
const supportReply = z.object({ id: z.string(), body: z.string(), createdAt: instant, updatedAt: instant })
const supportInquiry = z.object({
  id: z.string(), memberId: z.string(), category: z.string(), title: z.string(), body: z.string(), status: z.enum(['WAITING', 'ANSWERED']),
  createdAt: instant, updatedAt: instant, replies: z.array(supportReply),
})
export const items = <T extends z.ZodType>(item: T) => z.object({ items: z.array(item) }).transform((v) => v.items)

export const MESSAGES: Record<number, string> = {
  400: '입력값을 확인해 주세요.',
  403: '이 작업을 할 권한이 없어요.',
  404: '대상을 찾을 수 없어요. 목록을 새로고침해 주세요.',
  409: '다른 변경과 충돌했어요. 목록을 새로고침한 뒤 다시 시도해 주세요.',
  502: '연결된 서비스에서 처리하지 못해 반영되지 않았어요. 잠시 후 다시 시도해 주세요.',
}

/** 운영 서비스의 오류 본문 `{ code, message }`(줄별 검사 오류는 `errors: [{line, message}]`, #868). 없거나 형식이 다르면 빈 객체입니다. */
const failureBody = async (response: Response) => {
  const lines = z.array(z.object({ line: z.number(), message: z.string() })).optional().catch(undefined)
  const parsed = z.object({ code: z.string().optional(), message: z.string().trim().min(1).optional(), errors: lines }).safeParse(await response.json().catch(() => undefined))
  return parsed.success ? parsed.data : {}
}
/** 실패 상태와 오류 본문으로 화면에 그대로 보일 문구를 정합니다. 보이지 않을 오류면 undefined(상태별 일반 문구)이고, 오류 객체를 주면 그대로 던집니다(줄 목록을 든 오류 등). */
export type ServerReason = (status: number, error: { code?: string; message?: string; errors?: { line: number; message: string }[] }) => string | OperationsError | undefined

/**
 * 운영 공개 API(/api/v1/operations) 공통 요청. 운영 서비스는 회원 Bearer만 확인하는 stateless API라 CSRF를 보내지 않습니다.
 * 실패 상태는 성공으로 숨기지 않고 화면에 보일 OperationsError로 바꿉니다. 403은 OperationsForbidden이고,
 * [serverMessages]에 든 상태는 서버가 보낸 안내 문구를 그대로 담은 OperationsRejected입니다(문구가 없으면 일반 문구).
 * 함수를 주면 상태·code·message를 보고 보일 문구를 정합니다(돌려준 문구가 없으면 일반 문구).
 */
export async function send(fetcher: typeof fetch | undefined, path: string, method = 'GET', body?: unknown, messages: Record<number, string> = MESSAGES, serverMessages: readonly number[] | ServerReason = []) {
  // multipart(FormData)는 Content-Type을 브라우저가 경계와 함께 붙이도록 두지 않는다.
  const raw = body === undefined || body instanceof FormData
  const init: RequestInit = { method, signal: AbortSignal.timeout(15000), headers: raw ? {} : { 'Content-Type': 'application/json' }, body: raw ? (body as FormData | undefined) : JSON.stringify(body) }
  let response: Response
  try {
    response = await protectedRequest('/api/v1/operations' + path, init, authVersion(), false, { fetcher, allowHttpError: true })
  } catch (error) {
    if (error instanceof SessionExpired) throw new OperationsError('로그인이 필요해요. 로그인한 뒤 다시 시도해 주세요.')
    throw error
  }
  if (!response.ok) {
    const reason = typeof serverMessages === 'function' ? serverMessages(response.status, await failureBody(response))
      : serverMessages.includes(response.status) ? (await failureBody(response)).message : undefined
    if (reason instanceof OperationsError) throw reason
    if (reason) throw new OperationsRejected(reason)
    const message = messages[response.status] ?? '요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.'
    throw response.status === 403 ? new OperationsForbidden(message) : new OperationsError(message)
  }
  return response
}
export async function read<T>(fetcher: typeof fetch | undefined, path: string, schema: z.ZodType<T>, serverMessages: readonly number[] = [], messages: Record<number, string> = MESSAGES): Promise<T> {
  const parsed = schema.safeParse(await (await send(fetcher, path, 'GET', undefined, messages, serverMessages)).json().catch(() => undefined))
  if (!parsed.success) throw new OperationsError('서버 응답 형식을 확인할 수 없어요.')
  return parsed.data
}
const id = encodeURIComponent

export class HttpReportRepository implements ReportRepository {
  private readonly fetcher?: typeof fetch
  constructor(fetcher?: typeof fetch) { this.fetcher = fetcher }
  private async send(path: string, method: string, body?: unknown) { await send(this.fetcher, path, method, body) }

  listAll(status: ReportStatus | null): Promise<Report[]> { return read(this.fetcher, '/reports' + (status ? `?status=${status}` : ''), items(report)) }
  listMine(): Promise<Report[]> { return read(this.fetcher, '/reports/mine', items(report)) }
  get(reportId: string): Promise<Report> { return read(this.fetcher, `/reports/${id(reportId)}`, report) }
  submit(input: ReportInput) { return this.send('/reports', 'POST', input) }
  addEvidence(reportId: string, body: string) { return this.send(`/reports/${id(reportId)}/evidence`, 'POST', { body }) }
  addExplanation(reportId: string, body: string) { return this.send(`/reports/${id(reportId)}/explanations`, 'POST', { body }) }
  review(reportId: string, decision: ReviewDecision, note: string) { return this.send(`/reports/${id(reportId)}/review`, 'POST', { decision, note }) }
  setContentRestriction(reportId: string, restricted: boolean) { return this.send(`/reports/${id(reportId)}/restriction`, restricted ? 'POST' : 'DELETE') }
  requestEvidence(reportId: string, body: string) { return this.send(`/reports/${id(reportId)}/evidence-requests`, 'POST', { body }) }
}

export class HttpMemberRepository implements MemberRepository {
  private readonly fetcher?: typeof fetch
  constructor(fetcher?: typeof fetch) { this.fetcher = fetcher }

  list(query: MemberQuery): Promise<MemberItem[]> { return read(this.fetcher, `/members?${new URLSearchParams(query)}`, items(member)) }
  async setRestriction(memberId: string, restricted: boolean) { await send(this.fetcher, `/members/${id(memberId)}/restriction`, restricted ? 'PUT' : 'DELETE') }
  listAdmins(): Promise<AdminAccount[]> { return read(this.fetcher, '/admins', items(admin)) }
  async createAdmin(input: AdminInput) { await send(this.fetcher, '/admins', 'POST', input, { ...MESSAGES, 409: '이미 등록된 이메일이에요.' }) }
}

/** 운영 작품(74): 목록은 Content의 전체 작품이고, 제한·해제 응답(ContentWork)은 쓰지 않고 화면이 목록을 다시 조회합니다. */
export class HttpOperationsWorkRepository implements OperationsWorkRepository {
  private readonly fetcher?: typeof fetch
  constructor(fetcher?: typeof fetch) { this.fetcher = fetcher }

  list(): Promise<OperationsWork[]> { return read(this.fetcher, '/works', items(operationsWork)) }
  /** 점검 대상 포크가 없거나 원작의 고정 기준 기록이 없으면(404·409) Content의 안내 문구가 OperationsRejected로 옵니다. */
  forkIntegrity(workId: string) { return read(this.fetcher, `/works/${id(workId)}/fork-integrity`, forkIntegrity, [404, 409]) }
  async setRestriction(workId: string, restricted: boolean) { await send(this.fetcher, `/works/${id(workId)}/restriction`, restricted ? 'PUT' : 'DELETE') }
  /** 작품 상세 드로어의 회차 목록(본문 없음, 번호순 맨 배열). */
  episodes(workId: string): Promise<OperationsEpisode[]> { return read(this.fetcher, `/works/${id(workId)}/episodes`, z.array(operationsEpisode)) }
  /** 상속 회차 409(EPISODE_INHERITED)는 서버 code로 정한 한국어 안내를 OperationsRejected로 던진다(서버 문구는 영문 고정). */
  async setEpisodeRestriction(workId: string, number: number, restricted: boolean) {
    const inherited: ServerReason = (status, error) => status === 409 && error.code === 'EPISODE_INHERITED' ? EPISODE_INHERITED_MESSAGE : undefined
    await send(this.fetcher, `/works/${id(workId)}/episodes/${number}/restriction`, restricted ? 'PUT' : 'DELETE', undefined, MESSAGES, inherited)
  }
}

/** 운영 세계관(결정 B): 지우지 않은 전체 세계관(최신순)과 공개 경로 제한·해제. 제한·해제 응답(세계관 한 건)은 쓰지 않고 화면이 목록을 다시 조회합니다. */
export class HttpOperationsWorldRepository implements OperationsWorldRepository {
  private readonly fetcher?: typeof fetch
  constructor(fetcher?: typeof fetch) { this.fetcher = fetcher }

  list(): Promise<OperationsWorld[]> { return read(this.fetcher, '/world-studios', z.array(operationsWorld)) }
  async setRestriction(worldId: string, restricted: boolean) { await send(this.fetcher, `/world-studios/${id(worldId)}/restriction`, restricted ? 'PUT' : 'DELETE') }
}

/** 운영 댓글(75): 목록은 Content의 삭제되지 않은 전체 댓글(숨김 포함)이고, 숨김·복구 응답(OperationsComment)은 쓰지 않고 화면이 목록을 다시 조회합니다. */
export class HttpOperationsCommentRepository implements OperationsCommentRepository {
  private readonly fetcher?: typeof fetch
  constructor(fetcher?: typeof fetch) { this.fetcher = fetcher }

  list(): Promise<OperationsComment[]> { return read(this.fetcher, '/comments', items(operationsComment)) }
  async hide(commentId: string) { await send(this.fetcher, `/comments/${id(commentId)}/hidden`, 'PUT') }
  async unhide(commentId: string) { await send(this.fetcher, `/comments/${id(commentId)}/hidden`, 'DELETE') }
}

/** 관리자 활동 기록(72): 운영 서비스가 남긴 관리자 변경 조치 최신 100개. 수행자 닉네임은 서버가 채우며 없으면 null입니다. */
export class HttpAdminActivityRepository implements AdminActivityRepository {
  private readonly fetcher?: typeof fetch
  constructor(fetcher?: typeof fetch) { this.fetcher = fetcher }

  list(): Promise<AdminActivity[]> { return read(this.fetcher, '/admin/activities', items(adminActivity)) }
}

/** 고객지원 문의(67): 변경 응답의 SupportInquiry는 쓰지 않고, 화면이 목록·상세를 다시 조회합니다. */
export class HttpSupportInquiryRepository implements SupportInquiryRepository {
  private readonly fetcher?: typeof fetch
  constructor(fetcher?: typeof fetch) { this.fetcher = fetcher }
  private async send(path: string, method: string, body?: unknown) { await send(this.fetcher, path, method, body) }

  listMine(): Promise<SupportInquiry[]> { return read(this.fetcher, '/support/inquiries/mine', items(supportInquiry)) }
  create(input: SupportInquiryInput) { return this.send('/support/inquiries', 'POST', input) }
  listAll(status: SupportInquiryStatus | null): Promise<SupportInquiry[]> { return read(this.fetcher, '/support/inquiries' + (status ? `?status=${status}` : ''), items(supportInquiry)) }
  get(inquiryId: string): Promise<SupportInquiry> { return read(this.fetcher, `/support/inquiries/${id(inquiryId)}`, supportInquiry) }
  addReply(inquiryId: string, body: string) { return this.send(`/support/inquiries/${id(inquiryId)}/replies`, 'POST', { body }) }
  updateReply(inquiryId: string, replyId: string, body: string) { return this.send(`/support/inquiries/${id(inquiryId)}/replies/${id(replyId)}`, 'PUT', { body }) }
  deleteReply(inquiryId: string, replyId: string) { return this.send(`/support/inquiries/${id(inquiryId)}/replies/${id(replyId)}`, 'DELETE') }
}
