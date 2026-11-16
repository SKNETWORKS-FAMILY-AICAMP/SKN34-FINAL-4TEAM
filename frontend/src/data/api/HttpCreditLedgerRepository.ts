import { z } from 'zod'

import type { CreditBalance, CreditHistoryItem } from '../../domain/entities/creditLedger'
import type { CreditLedgerRepository } from '../../domain/repositories/CreditLedgerRepository'
import { authVersion, protectedRequest } from './auth'

const at = z.string().datetime({ offset: true })
const balanceSchema = z.object({ total: z.number(), items: z.array(z.object({ kind: z.string(), remaining: z.number(), expiresAt: at })) })
const historySchema = z.object({ items: z.array(z.object({ type: z.enum(['grant', 'spend', 'expire']), kind: z.string(), amount: z.number(), occurredAt: at })) })

/** 인증된 Core 크레딧 API(/api/v1/me/credits·history) 구현. 데모 크레딧은 섞지 않습니다. */
export class HttpCreditLedgerRepository implements CreditLedgerRepository {
  private readonly fetcher?: typeof fetch
  constructor(fetcher?: typeof fetch) { this.fetcher = fetcher }

  private async read(path: string, signal?: AbortSignal): Promise<unknown> {
    const version = authVersion()
    const limited = signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000)
    return (await protectedRequest(path, { signal: limited }, version, false, { fetcher: this.fetcher })).json()
  }

  async balance(signal?: AbortSignal): Promise<CreditBalance> { return balanceSchema.parse(await this.read('/api/v1/me/credits', signal)) }
  async history(signal?: AbortSignal): Promise<CreditHistoryItem[]> { return historySchema.parse(await this.read('/api/v1/me/credits/history', signal)).items }
}
