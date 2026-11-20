/*
 * 장르(DEC-56, [계약](../../../../docs/design/genre-management-contract.md)): 작품과 공개 세계관이 함께 쓰는 하나의 목록이다.
 * 정본은 Content의 `genre`이고 운영 관리자 화면이 추가·이름·아이콘·숨김·홈 노출·순서를 관리한다. 작가는 목록 중에서 고르기만 한다.
 * 작품의 장르 값은 장르 이름이고, 세계관의 장르 값은 장르 코드(`genre-01` …)다.
 */

/** 공개 장르(`GET /public/genres`): 활성 장르만, 표시 순서대로다. 아이콘이 없으면 `emoji`는 null이다. */
export type Genre = { code: string; name: string; emoji: string | null; featured: boolean }
/** 운영 화면의 장르 한 줄: 숨긴 장르(`active: false`)도 들어 있고 이 장르를 쓰는 작품·세계관 수가 붙는다. */
export type OperationsGenre = Genre & { active: boolean; position: number; workCount: number; worldCount: number }
export type GenreInput = { name: string; emoji?: string }
/** 바꿀 값만 담는다. `emoji: ''`는 아이콘을 지운다. */
export type GenrePatch = { name?: string; emoji?: string; active?: boolean; featured?: boolean }

/** 이름은 1~30자, 아이콘은 최대 8자(계약). */
export const GENRE_NAME_MAX = 30
export const GENRE_EMOJI_MAX = 8
/** 홈 장르 칩에 보이는 장르 수의 상한. 서버는 7번째 노출을 409 `GENRE_FEATURED_LIMIT`로 거절한다. */
export const HOME_GENRE_LIMIT = 6

/** 장르 관리는 `works`(화면 이름 '작품 관리') 권한이 있어야 합니다. 403이면 다시 시도 대신 이 안내만 보입니다. */
export const GENRE_FORBIDDEN = "장르를 관리하려면 '작품 관리' 권한이 필요해요."

/** 서버가 `{code, message}`로 거절하는 장르 오류 code → 화면에 그대로 보일 한국어 안내(서버 문구는 영문 고정이다). */
export const GENRE_MESSAGES: Record<string, string> = {
  GENRE_NAME_TAKEN: '이미 같은 이름의 장르가 있어요.',
  GENRE_FEATURED_LIMIT: `홈에 보이는 장르는 최대 ${HOME_GENRE_LIMIT}개예요. 다른 장르의 홈 노출을 먼저 꺼 주세요.`,
}

/** 순서 저장(PUT order)이 현재 목록과 맞지 않을 때(422)의 안내. */
export const GENRE_ORDER_MESSAGE = '순서가 목록과 맞지 않아요. 목록을 새로고침한 뒤 다시 시도해 주세요.'

/** 칩·표에 쓰는 이름: 아이콘이 있으면 `✨ 판타지`, 없으면 이름만. */
export const emojiName = (g: Pick<Genre, 'name' | 'emoji'>) => (g.emoji ? `${g.emoji} ${g.name}` : g.name)

/**
 * 작품 장르 선택지(이름): 활성 장르를 서버 순서대로 두고, 이미 고른 값이 목록에 없으면(숨긴 장르) 맨 앞에 더해 그대로 보이게 한다.
 * 숨긴 장르는 새로 붙일 수 없지만 이미 붙은 값을 바꾸지 않으면 통과한다(DEC-56).
 */
export const genreOptions = (genres: readonly Pick<Genre, 'name'>[], selected: readonly string[]) =>
  [...new Set([...selected.filter((name) => name && !genres.some((g) => g.name === name)), ...genres.map((g) => g.name)])]

/** 코드의 장르 이름. 목록(활성 장르)에 없는 코드(숨긴 장르)와 장르 없음(null)은 이름을 알 수 없어 null이다. */
export const genreNameOf = (genres: readonly Pick<Genre, 'code' | 'name'>[], code: string | null) => genres.find((g) => g.code === code)?.name ?? null

export const HOME_CHIP_ALL = '추천'
export const HOME_CHIP_FREE = '🆓 무료'
export const HOME_CHIP_FORKS = '✎ 포크 많은'
/** 홈 칩 줄: 추천 · 홈에 보이는 장르(`featured`, 서버 순서, 최대 `HOME_GENRE_LIMIT`개) · 무료 · 포크 많은. `genres`는 공개 목록(활성 장르, 표시 순서)이다. */
export const homeChips = (genres: readonly Genre[]) => [
  HOME_CHIP_ALL, ...genres.filter((g) => g.featured).slice(0, HOME_GENRE_LIMIT).map(emojiName), HOME_CHIP_FREE, HOME_CHIP_FORKS,
]

/** `codes`에서 `code`를 한 칸 옮긴 전체 순서(원본은 그대로). 맨 앞을 위로·맨 뒤를 아래로 옮기거나 없는 코드면 null이다. */
export function moveCode(codes: readonly string[], code: string, delta: -1 | 1): string[] | null {
  const from = codes.indexOf(code), to = from + delta
  if (from < 0 || to < 0 || to >= codes.length) return null
  const next = [...codes]
  ;[next[from], next[to]] = [next[to], next[from]]
  return next
}
