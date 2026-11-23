import { CARD_CATEGORY_ICON_MAX, CARD_CATEGORY_NAME_MAX, type CardCategoryInput, type CardCategoryPatch } from '../entities/cardCategory'
import { OperationsError, orNullIfForbidden } from '../entities/operations'
import type { OperationsCardCategoryRepository } from '../repositories/OperationsCardCategoryRepository'

const name = (value: string) => {
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > CARD_CATEGORY_NAME_MAX) throw new OperationsError(`카테고리 이름을 1~${CARD_CATEGORY_NAME_MAX}자로 적어 주세요.`)
  return trimmed
}
const icon = (value: string) => {
  const trimmed = value.trim()
  // 서버는 글자(코드 포인트) 수로 센다. 이모지는 UTF-16 길이로 2라서 [...]로 센다.
  if ([...trimmed].length > CARD_CATEGORY_ICON_MAX) throw new OperationsError(`아이콘은 ${CARD_CATEGORY_ICON_MAX}자 이하로 적어 주세요.`)
  return trimmed
}

/** 운영 카드 카테고리 관리: 입력 한도만 먼저 확인하고 권한·이름 중복·코드 검사는 서버가 판단한다. */
export class OperationsCardCategoryUseCase {
  private readonly repository: OperationsCardCategoryRepository
  constructor(repository: OperationsCardCategoryRepository) { this.repository = repository }

  /** 조회 권한(작품 관리)이 없으면(403) 실패가 아니라 null이라, 화면이 다시 불러오기 대신 권한 안내를 보입니다. */
  list() { return orNullIfForbidden(this.repository.list()) }

  async create(input: CardCategoryInput) {
    const mark = input.icon === undefined ? '' : icon(input.icon)
    return this.repository.create({ name: name(input.name), ...(mark ? { icon: mark } : {}) })
  }

  /** 바꿀 값만 보낸다. 아이콘 빈 문자열은 아이콘 지우기다. */
  async update(code: string, patch: CardCategoryPatch) {
    return this.repository.update(code, {
      ...patch,
      ...(patch.name === undefined ? {} : { name: name(patch.name) }),
      ...(patch.icon === undefined ? {} : { icon: icon(patch.icon) }),
    })
  }

  reorder(codes: string[]) { return this.repository.reorder(codes) }
}
