import { z } from 'zod'

import { getCoreApiBaseUrl } from './coreApiConfig'
import { coreApiHealthSchema, type CoreApiHealth } from './coreApiHealth'

export class CoreApiRequestError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CoreApiRequestError'
  }
}

async function fetchHealth(path: string, service: string, signal?: AbortSignal): Promise<CoreApiHealth> {
  const response = await fetch(`${getCoreApiBaseUrl()}${path}`, {
    signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(20_000)]),
  })

  if (!response.ok) {
    throw new CoreApiRequestError(`연결 확인 API가 HTTP ${response.status} 응답을 반환했습니다.`)
  }

  return coreApiHealthSchema.extend({
    status: z.literal('up'),
    service: z.literal(service),
  }).parse(await response.json())
}

export function fetchCoreApiHealth(signal?: AbortSignal) {
  return fetchHealth('/api/v1/health', 'storyfork-core-api', signal)
}

/** AI Service도 반드시 Core의 공개 API를 통해서만 확인합니다. */
export function fetchAiServiceHealth(signal?: AbortSignal) {
  return fetchHealth('/api/v1/health/ai-service', 'storyfork-ai-service', signal)
}
