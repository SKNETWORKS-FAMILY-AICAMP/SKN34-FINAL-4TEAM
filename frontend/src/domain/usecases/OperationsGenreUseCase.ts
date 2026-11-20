import { GENRE_EMOJI_MAX, GENRE_NAME_MAX, type GenreInput, type GenrePatch } from '../entities/genre'
import { OperationsError, orNullIfForbidden } from '../entities/operations'
import type { OperationsGenreRepository } from '../repositories/OperationsGenreRepository'

const name = (value: string) => {
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > GENRE_NAME_MAX) throw new OperationsError(`장르 이름을 1~${GENRE_NAME_MAX}자로 적어 주세요.`)
  return trimmed
}
const emoji = (value: string) => {
  const trimmed = value.trim()
  if (trimmed.length > GENRE_EMOJI_MAX) throw new OperationsError(`아이콘은 ${GENRE_EMOJI_MAX}자 이하로 적어 주세요.`)
  return trimmed
}

/** 운영 장르 관리(DEC-56): 입력 한도만 먼저 확인하고 권한·중복·홈 노출 한도는 서버가 판단한다. */
export class OperationsGenreUseCase {
  private readonly repository: OperationsGenreRepository
  constructor(repository: OperationsGenreRepository) { this.repository = repository }

  /** 조회 권한(작품 관리)이 없으면(403) 실패가 아니라 null이라, 화면이 다시 불러오기 대신 권한 안내를 보입니다. */
  list() { return orNullIfForbidden(this.repository.list()) }

  async create(input: GenreInput) {
    const icon = input.emoji === undefined ? '' : emoji(input.emoji)
    return this.repository.create({ name: name(input.name), ...(icon ? { emoji: icon } : {}) })
  }

  /** 바꿀 값만 보낸다. 아이콘 빈 문자열은 아이콘 지우기다. */
  async update(code: string, patch: GenrePatch) {
    return this.repository.update(code, {
      ...patch,
      ...(patch.name === undefined ? {} : { name: name(patch.name) }),
      ...(patch.emoji === undefined ? {} : { emoji: emoji(patch.emoji) }),
    })
  }

  reorder(codes: string[]) { return this.repository.reorder(codes) }
}
