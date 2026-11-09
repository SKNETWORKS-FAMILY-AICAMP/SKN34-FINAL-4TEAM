import { z } from 'zod'

import type { AdminAccount, AdminInput, MemberItem, MemberQuery } from '../../domain/entities/member'
import { OperationsError } from '../../domain/entities/operations'
import type { Report, ReportInput, ReportStatus, ReviewDecision } from '../../domain/entities/report'
import type { MemberRepository } from '../../domain/repositories/MemberRepository'
import { SessionExpired } from '../../domain/repositories/ProfileRepository'
import type { ReportRepository } from '../../domain/repositories/ReportRepository'
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
const items = <T extends z.ZodType>(item: T) => z.object({ items: z.array(item) }).transform((v) => v.items)

const MESSAGES: Record<number, string> = {
  400: '입력값을 확인해 주세요.',
  403: '이 작업을 할 권한이 없어요.',
  404: '대상을 찾을 수 없어요. 목록을 새로고침해 주세요.',
  409: '다른 변경과 충돌했어요. 목록을 새로고침한 뒤 다시 시도해 주세요.',
  502: '연결된 서비스에서 처리하지 못해 반영되지 않았어요. 잠시 후 다시 시도해 주세요.',
}

/**
 * 운영 공개 API(/api/v1/operations) 공통 요청. 운영 서비스는 회원 Bearer만 확인하는 stateless API라 CSRF를 보내지 않습니다.
 * 실패 상태는 성공으로 숨기지 않고 화면에 보일 OperationsError로 바꿉니다.
 */
export async function send(fetcher: typeof fetch | undefined, path: string, method = 'GET', body?: unknown, messages: Record<number, string> = MESSAGES) {
  const init: RequestInit = { method, signal: AbortSignal.timeout(15000), headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }
  let response: Response
  try {
    response = await protectedRequest('/api/v1/operations' + path, init, authVersion(), false, { fetcher, allowHttpError: true })
  } catch (error) {
    if (error instanceof SessionExpired) throw new OperationsError('로그인이 필요해요. 로그인한 뒤 다시 시도해 주세요.')
    throw error
  }
  if (!response.ok) throw new OperationsError(messages[response.status] ?? '요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.')
  return response
}
export async function read<T>(fetcher: typeof fetch | undefined, path: string, schema: z.ZodType<T>): Promise<T> {
  const parsed = schema.safeParse(await (await send(fetcher, path)).json().catch(() => undefined))
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
