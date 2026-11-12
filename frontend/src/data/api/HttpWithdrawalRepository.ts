import { z } from 'zod'

import type { WithdrawalState } from '../../domain/entities/withdrawal'
import { WithdrawalConflict, WithdrawalWrongPassword, type WithdrawalRepository } from '../../domain/repositories/WithdrawalRepository'
import { authVersion, forgetSession, protectedRequest } from './auth'
import { csrf } from './csrf'

const at = z.string().datetime({ offset: true })
const stateSchema = z.union([
  z.object({ status: z.literal('NONE') }),
  z.object({ status: z.literal('PENDING'), requestedAt: at, dueAt: at }),
])
const path = '/api/v1/me/withdrawal'

/** 인증된 Core 탈퇴 API(/api/v1/me/withdrawal) 구현. */
export class HttpWithdrawalRepository implements WithdrawalRepository {
  private readonly fetcher?: typeof fetch
  constructor(fetcher?: typeof fetch) { this.fetcher = fetcher }

  private async send(method: string, body?: unknown, signal?: AbortSignal) {
    const version = authVersion()
    const limited = signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000)
    const headers: Record<string, string> = {}
    if (method !== 'GET') headers['X-CSRF-TOKEN'] = await csrf(limited)
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    return protectedRequest(path, { method, signal: limited, headers, body: body === undefined ? undefined : JSON.stringify(body) }, version, false, { fetcher: this.fetcher, allowHttpError: true })
  }

  async status(signal?: AbortSignal): Promise<WithdrawalState> {
    const response = await this.send('GET', undefined, signal)
    if (!response.ok) throw new Error('탈퇴 상태를 불러오지 못했어요.')
    return stateSchema.parse(await response.json())
  }

  async request(password: string, reason: string | null): Promise<WithdrawalState> {
    const response = await this.send('POST', reason === null ? { password } : { password, reason })
    if (response.status === 403) throw new WithdrawalWrongPassword()
    if (response.status === 409) throw new WithdrawalConflict()
    if (response.status !== 202) throw new Error('탈퇴를 요청하지 못했어요.')
    const state = stateSchema.parse(await response.json())
    // 서버가 이 회원의 모든 로그인 세션을 끊었으므로 이 브라우저의 접근 토큰도 지웁니다.
    forgetSession()
    return state
  }

  async restore(): Promise<void> {
    const response = await this.send('DELETE')
    // 이미 복구됐거나 요청이 없으면(404) 원하는 상태와 같습니다.
    if (response.status === 204 || response.status === 404) return
    if (response.status === 409) throw new WithdrawalConflict()
    throw new Error('탈퇴 요청을 취소하지 못했어요.')
  }
}
