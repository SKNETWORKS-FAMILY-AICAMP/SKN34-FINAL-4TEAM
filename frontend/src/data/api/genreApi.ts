import { z } from 'zod'

import { GENRE_MESSAGES, GENRE_ORDER_MESSAGE, type GenreInput, type GenrePatch, type OperationsGenre } from '../../domain/entities/genre'
import type { OperationsGenreRepository } from '../../domain/repositories/OperationsGenreRepository'
import { genreRow } from '../content/HttpGenreRepository'
import { MESSAGES, read, send, type ServerReason } from './operationsApi'

const count = z.number().int().nonnegative()
const operationsGenre: z.ZodType<OperationsGenre> = genreRow.extend({ active: z.boolean(), position: z.number().int(), workCount: count, worldCount: count })

/** 입력을 서버가 거절(400·422)하는 변경은 같은 안내이고, 순서 저장의 422는 목록이 낡았다는 안내다. */
const INPUT_MESSAGES = { ...MESSAGES, 422: MESSAGES[400] }
const ORDER_MESSAGES = { ...MESSAGES, 422: GENRE_ORDER_MESSAGE }
/**
 * 이름 중복·홈 노출 한도 409는 서버의 문구 대신 code로 정한 한국어 안내를 보인다(모르는 409는 일반 충돌 안내).
 * 입력 오류 422는 Content가 한글 안내를 주면 그대로, 영문 고정 문구면 일반 안내(입력값 확인)로 바꾼다.
 */
const conflictReason: ServerReason = (status, error) => {
  if (status === 409 && error.code && Object.hasOwn(GENRE_MESSAGES, error.code)) return GENRE_MESSAGES[error.code]
  if (status === 422 && error.message && /[가-힣]/.test(error.message)) return error.message
  return undefined
}

/** 운영 장르 관리(DEC-56): 목록은 숨긴 장르를 포함한 전체이고, 변경 응답은 쓰지 않고 화면이 목록을 다시 읽는다. */
export class HttpOperationsGenreRepository implements OperationsGenreRepository {
  private readonly fetcher?: typeof fetch
  constructor(fetcher?: typeof fetch) { this.fetcher = fetcher }

  list(): Promise<OperationsGenre[]> { return read(this.fetcher, '/genres', z.array(operationsGenre)) }
  async create(input: GenreInput) { await send(this.fetcher, '/genres', 'POST', input, INPUT_MESSAGES, conflictReason) }
  async update(code: string, patch: GenrePatch) { await send(this.fetcher, `/genres/${encodeURIComponent(code)}`, 'PATCH', patch, INPUT_MESSAGES, conflictReason) }
  async reorder(codes: string[]) { await send(this.fetcher, '/genres/order', 'PUT', { codes }, ORDER_MESSAGES) }
}
