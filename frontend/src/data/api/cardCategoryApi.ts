import { z } from 'zod'

import { CARD_CATEGORY_MESSAGES, CARD_CATEGORY_ORDER_MESSAGE, type CardCategoryInput, type CardCategoryPatch, type OperationsCardCategory } from '../../domain/entities/cardCategory'
import type { OperationsCardCategoryRepository } from '../../domain/repositories/OperationsCardCategoryRepository'
import { cardCategoryRow } from '../content/HttpCardCategoryRepository'
import { MESSAGES, read, send, type ServerReason } from './operationsApi'

const operationsCategory: z.ZodType<OperationsCardCategory> = cardCategoryRow.extend({ cardCount: z.number().int().nonnegative() })

/** 입력을 서버가 거절(400·422)하는 변경은 같은 안내이고, 순서 저장의 422는 목록이 낡았다는 안내다. */
const INPUT_MESSAGES = { ...MESSAGES, 422: MESSAGES[400] }
const ORDER_MESSAGES = { ...MESSAGES, 422: CARD_CATEGORY_ORDER_MESSAGE }
/**
 * 이름 중복 409는 서버의 문구 대신 code로 정한 한국어 안내를 보인다(모르는 409는 일반 충돌 안내).
 * 입력 오류 422는 Content가 한글 안내를 주면 그대로, 영문 고정 문구면 일반 안내(입력값 확인)로 바꾼다.
 */
const conflictReason: ServerReason = (status, error) => {
  if (status === 409 && error.code && Object.hasOwn(CARD_CATEGORY_MESSAGES, error.code)) return CARD_CATEGORY_MESSAGES[error.code]
  if (status === 422 && error.message && /[가-힣]/.test(error.message)) return error.message
  return undefined
}

/** 운영 카드 카테고리 관리: 목록은 숨긴 카테고리를 포함한 전체이고, 변경 응답은 쓰지 않고 화면이 목록을 다시 읽는다. */
export class HttpOperationsCardCategoryRepository implements OperationsCardCategoryRepository {
  private readonly fetcher?: typeof fetch
  constructor(fetcher?: typeof fetch) { this.fetcher = fetcher }

  list(): Promise<OperationsCardCategory[]> { return read(this.fetcher, '/card-categories', z.array(operationsCategory)) }
  async create(input: CardCategoryInput) { await send(this.fetcher, '/card-categories', 'POST', input, INPUT_MESSAGES, conflictReason) }
  async update(code: string, patch: CardCategoryPatch) { await send(this.fetcher, `/card-categories/${encodeURIComponent(code)}`, 'PATCH', patch, INPUT_MESSAGES, conflictReason) }
  async reorder(codes: string[]) { await send(this.fetcher, '/card-categories/order', 'PUT', { codes }, ORDER_MESSAGES) }
}
