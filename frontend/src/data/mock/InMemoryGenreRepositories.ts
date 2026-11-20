import { GENRE_MESSAGES, GENRE_ORDER_MESSAGE, HOME_GENRE_LIMIT, type Genre, type GenreInput, type GenrePatch, type OperationsGenre } from '../../domain/entities/genre'
import { OperationsError, OperationsRejected } from '../../domain/entities/operations'
import type { GenreRepository } from '../../domain/repositories/GenreRepository'
import type { OperationsGenreRepository } from '../../domain/repositories/OperationsGenreRepository'
import { MESSAGES } from '../api/operationsApi'

/** Content `genre` 시드(`work/V1`)와 같은 30개. 코드는 순서대로 `genre-01` …이다. */
const NAMES = ['판타지', '현대판타지', '무협', '선협', '퓨전', '로맨스', '로맨스판타지', 'BL', 'GL', '현대', '시대물', '역사', '대체역사', 'SF', '게임', '스포츠', '드라마', '미스터리', '추리', '스릴러', '공포', '오컬트', '액션', '전쟁·밀리터리', '라이트노벨', '학원', '일상', '고전', '일반소설', '기타']
/** 기존 고정 홈 칩에 맞춰 판타지·SF·고전만 홈에 보이고 아이콘이 있다(서버 V42 시드와 같다). */
const FEATURED_ICONS: Record<string, string> = { 판타지: '✨', SF: '🛰', 고전: '📜' }
const codeOf = (number: number) => `genre-${String(number).padStart(2, '0')}`
const byPosition = (a: OperationsGenre, b: OperationsGenre) => a.position - b.position

/**
 * 서버 없는 시연(`--mode mockup`)·렌더 테스트용 운영 장르 관리. 서버와 같은 규칙(이름 중복·홈 노출 한도·순서 전체 교체)으로 답하고 사용 수는 세지 않아 늘 0이다.
 * 공개 목록(`InMemoryGenreRepository`)이 이 목록을 읽으므로 숨기기·이름 변경이 작가 선택지에 바로 이어진다. 새로 고치면 처음 상태다.
 */
export class InMemoryOperationsGenreRepository implements OperationsGenreRepository {
  private readonly rows: OperationsGenre[] = NAMES.map((name, i) => ({
    code: codeOf(i + 1), name, emoji: Object.hasOwn(FEATURED_ICONS, name) ? FEATURED_ICONS[name] : null, active: true,
    featured: Object.hasOwn(FEATURED_ICONS, name), position: i + 1, workCount: 0, worldCount: 0,
  }))

  async list() { return this.rows.toSorted(byPosition).map((row) => ({ ...row })) }

  private assertFree(name: string, except?: string) {
    if (this.rows.some((row) => row.name === name && row.code !== except)) throw new OperationsRejected(GENRE_MESSAGES.GENRE_NAME_TAKEN)
  }

  async create({ name, emoji }: GenreInput) {
    const trimmed = name.trim()
    this.assertFree(trimmed)
    const next = Math.max(...this.rows.map((row) => Number(row.code.slice('genre-'.length)))) + 1
    this.rows.push({ code: codeOf(next), name: trimmed, emoji: emoji?.trim() || null, active: true, featured: false, position: Math.max(...this.rows.map((row) => row.position)) + 1, workCount: 0, worldCount: 0 })
  }

  async update(code: string, patch: GenrePatch) {
    const row = this.rows.find((candidate) => candidate.code === code)
    if (!row) throw new OperationsError(MESSAGES[404])
    const name = patch.name?.trim()
    if (name !== undefined) this.assertFree(name, code)
    // 홈에 보이는(활성) 장르는 최대 `HOME_GENRE_LIMIT`개다. 이미 보이는 장르를 다시 켜는 것은 늘리지 않는다.
    if (patch.featured && !row.featured && this.rows.filter((candidate) => candidate.active && candidate.featured).length >= HOME_GENRE_LIMIT) throw new OperationsRejected(GENRE_MESSAGES.GENRE_FEATURED_LIMIT)
    if (name !== undefined) row.name = name
    if (patch.emoji !== undefined) row.emoji = patch.emoji.trim() || null
    if (patch.active !== undefined) row.active = patch.active
    if (patch.featured !== undefined) row.featured = patch.featured
  }

  async reorder(codes: string[]) {
    const known = new Set(this.rows.map((row) => row.code))
    if (codes.length !== known.size || new Set(codes).size !== codes.length || codes.some((code) => !known.has(code))) throw new OperationsError(GENRE_ORDER_MESSAGE)
    codes.forEach((code, i) => { this.rows.find((row) => row.code === code)!.position = i + 1 })
  }
}

/** 메모리 공개 장르 목록: 운영 목록에서 활성 장르만 표시 순서대로 읽는다. */
export class InMemoryGenreRepository implements GenreRepository {
  private readonly operations: OperationsGenreRepository
  constructor(operations: OperationsGenreRepository) { this.operations = operations }

  async list(): Promise<Genre[]> {
    return (await this.operations.list()).filter((row) => row.active).map(({ code, name, emoji, featured }) => ({ code, name, emoji, featured }))
  }
}
