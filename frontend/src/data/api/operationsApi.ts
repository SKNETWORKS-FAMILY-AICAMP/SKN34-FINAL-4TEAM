import { z } from 'zod'

import type { AdminActivity } from '../../domain/entities/adminActivity'
import type { AdminAccount, AdminInput, MemberItem, MemberQuery } from '../../domain/entities/member'
import { OperationsError, OperationsForbidden, OperationsRejected } from '../../domain/entities/operations'
import type { OperationsComment } from '../../domain/entities/operationsComment'
import type { OperationsWork } from '../../domain/entities/operationsWork'
import type { Report, ReportInput, ReportStatus, ReviewDecision } from '../../domain/entities/report'
import type { SupportInquiry, SupportInquiryInput, SupportInquiryStatus } from '../../domain/entities/supportInquiry'
import type { AdminActivityRepository } from '../../domain/repositories/AdminActivityRepository'
import type { MemberRepository } from '../../domain/repositories/MemberRepository'
import type { OperationsCommentRepository } from '../../domain/repositories/OperationsCommentRepository'
import type { OperationsWorkRepository } from '../../domain/repositories/OperationsWorkRepository'
import { SessionExpired } from '../../domain/repositories/ProfileRepository'
import type { ReportRepository } from '../../domain/repositories/ReportRepository'
import type { SupportInquiryRepository } from '../../domain/repositories/SupportInquiryRepository'
import { authVersion, protectedRequest } from './auth'

const instant = z.string().datetime({ offset: true })
const history = z.object({ id: z.string(), type: z.string(), actorId: z.string(), body: z.string().nullable(), createdAt: instant })
const report = z.object({
  id: z.string(), kind: z.enum(['RIGHTS', 'HARMFUL']), workId: z.string(), workTitle: z.string(), workOwnerId: z.string(),
  reporterId: z.string(), reason: z.string(), evidence: z.string(), status: z.enum(['RECEIVED', 'ACCEPTED', 'REJECTED']),
  contentRestricted: z.boolean(), createdAt: instant, updatedAt: instant, history: z.array(history).optional(),
})
const member = z.object({ id: z.string(), email: z.string(), nickname: z.string(), role: z.enum(['MEMBER', 'ADMIN']), restricted: z.boolean(), createdAt: instant })
const admin = member.extend({ permissions: z.array(z.string()) })
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
const items = <T extends z.ZodType>(item: T) => z.object({ items: z.array(item) }).transform((v) => v.items)

const MESSAGES: Record<number, string> = {
  400: '입력값을 확인해 주세요.',
  403: '이 작업을 할 권한이 없어요.',
  404: '대상을 찾을 수 없어요. 목록을 새로고침해 주세요.',
  409: '다른 변경과 충돌했어요. 목록을 새로고침한 뒤 다시 시도해 주세요.',
  502: '연결된 서비스에서 처리하지 못해 반영되지 않았어요. 잠시 후 다시 시도해 주세요.',
}

/** 운영 서비스의 오류 본문 `{ code, message }`에서 안내 문구만 읽습니다. 없거나 비어 있으면 undefined입니다. */
const failureMessage = async (response: Response) => {
  const parsed = z.object({ message: z.string().trim().min(1) }).safeParse(await response.json().catch(() => undefined))
  return parsed.success ? parsed.data.message : undefined
}

/**
 * 운영 공개 API(/api/v1/operations) 공통 요청. 운영 서비스는 회원 Bearer만 확인하는 stateless API라 CSRF를 보내지 않습니다.
 * 실패 상태는 성공으로 숨기지 않고 화면에 보일 OperationsError로 바꿉니다. 403은 OperationsForbidden이고,
 * [serverMessages]에 든 상태는 서버가 보낸 안내 문구를 그대로 담은 OperationsRejected입니다(문구가 없으면 일반 문구).
 */
export async function send(fetcher: typeof fetch | undefined, path: string, method = 'GET', body?: unknown, messages: Record<number, string> = MESSAGES, serverMessages: readonly number[] = []) {
  const init: RequestInit = { method, signal: AbortSignal.timeout(15000), headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }
  let response: Response
  try {
    response = await protectedRequest('/api/v1/operations' + path, init, authVersion(), false, { fetcher, allowHttpError: true })
  } catch (error) {
    if (error instanceof SessionExpired) throw new OperationsError('로그인이 필요해요. 로그인한 뒤 다시 시도해 주세요.')
    throw error
  }
  if (!response.ok) {
    const reason = serverMessages.includes(response.status) ? await failureMessage(response) : undefined
    if (reason) throw new OperationsRejected(reason)
    const message = messages[response.status] ?? '요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.'
    throw response.status === 403 ? new OperationsForbidden(message) : new OperationsError(message)
  }
  return response
}
export async function read<T>(fetcher: typeof fetch | undefined, path: string, schema: z.ZodType<T>, serverMessages: readonly number[] = []): Promise<T> {
  const parsed = schema.safeParse(await (await send(fetcher, path, 'GET', undefined, MESSAGES, serverMessages)).json().catch(() => undefined))
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
