import { CARD_CATEGORY_MESSAGES, CARD_CATEGORY_ORDER_MESSAGE, type CardCategory, type CardCategoryInput, type CardCategoryPatch, type OperationsCardCategory } from '../../domain/entities/cardCategory'
import { OperationsError, OperationsRejected } from '../../domain/entities/operations'
import { cardTypes } from '../../domain/entities/studioCards'
import type { CardCategoryRepository } from '../../domain/repositories/CardCategoryRepository'
import type { OperationsCardCategoryRepository } from '../../domain/repositories/OperationsCardCategoryRepository'
import { MESSAGES } from '../api/operationsApi'

const byPosition = (a: OperationsCardCategory, b: OperationsCardCategory) => a.position - b.position

/**
 * 서버 없는 시연(`--mode mockup`)·렌더 테스트용 운영 카드 카테고리 관리. Content `card_category` 시드와 같은 기본 8종으로 시작하고
 * 서버와 같은 규칙(이름 중복·순서 전체 교체)으로 답하며 카드 수는 세지 않아 늘 0이다. 새로 만든 카테고리의 코드는 서버처럼 `category-NN`이다.
 * 공개 목록(`InMemoryCardCategoryRepository`)이 이 목록을 읽으므로 숨기기·이름 변경이 작가 선택지에 바로 이어진다.
 */
export class InMemoryOperationsCardCategoryRepository implements OperationsCardCategoryRepository {
  private readonly rows: OperationsCardCategory[] = cardTypes.map((type, i) => ({ code: type.id, name: type.label, icon: null, position: i + 1, active: true, cardCount: 0 }))

  async list() { return this.rows.toSorted(byPosition).map((row) => ({ ...row })) }

  private assertFree(name: string, except?: string) {
    if (this.rows.some((row) => row.name === name && row.code !== except)) throw new OperationsRejected(CARD_CATEGORY_MESSAGES.CARD_CATEGORY_NAME_TAKEN)
  }

  async create({ name, icon }: CardCategoryInput) {
    const trimmed = name.trim()
    this.assertFree(trimmed)
    const position = Math.max(...this.rows.map((row) => row.position)) + 1
    this.rows.push({ code: `category-${String(position).padStart(2, '0')}`, name: trimmed, icon: icon?.trim() || null, position, active: true, cardCount: 0 })
  }

  async update(code: string, patch: CardCategoryPatch) {
    const row = this.rows.find((candidate) => candidate.code === code)
    if (!row) throw new OperationsError(MESSAGES[404])
    const name = patch.name?.trim()
    if (name !== undefined) this.assertFree(name, code)
    if (name !== undefined) row.name = name
    if (patch.icon !== undefined) row.icon = patch.icon.trim() || null
    if (patch.active !== undefined) row.active = patch.active
  }

  async reorder(codes: string[]) {
    const known = new Set(this.rows.map((row) => row.code))
    if (codes.length !== known.size || new Set(codes).size !== codes.length || codes.some((code) => !known.has(code))) throw new OperationsError(CARD_CATEGORY_ORDER_MESSAGE)
    codes.forEach((code, i) => { this.rows.find((row) => row.code === code)!.position = i + 1 })
  }
}

/** 메모리 공개 카드 카테고리 목록: 운영 목록에서 숨긴 것까지(active 플래그) 표시 순서대로 읽는다. */
export class InMemoryCardCategoryRepository implements CardCategoryRepository {
  private readonly operations: OperationsCardCategoryRepository
  constructor(operations: OperationsCardCategoryRepository) { this.operations = operations }

  async list(): Promise<CardCategory[]> {
    return (await this.operations.list()).map(({ code, name, icon, position, active }) => ({ code, name, icon, position, active }))
  }
}
