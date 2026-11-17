import type { PublicWorldGenre } from '../../domain/entities/publicWorld'

/*
 * 공개 세계관 화면의 장르: 서버 장르 코드(`PublicWorldGenre`)와 화면 라벨·칩. 서버는 코드만 주고(미지정은 null) 라벨은 화면이 정한다.
 */

export const WORLD_GENRES = ['판타지', 'SF', '무협', '로맨스', '현대', '고전', '미스터리'] as const
export type WorldGenre = (typeof WORLD_GENRES)[number]
/** 장르가 정해지지 않은 세계관(서버 genre가 null)의 화면 라벨. 칩에는 없다. */
export const UNSET_GENRE = '미지정' as const
export type GenreLabel = WorldGenre | typeof UNSET_GENRE

const CODES: Record<WorldGenre, PublicWorldGenre> = { 판타지: 'fantasy', SF: 'sf', 무협: 'wuxia', 로맨스: 'romance', 현대: 'modern', 고전: 'classic', 미스터리: 'mystery' }
/** 장르 라벨(칩의 `genre` 값) → 서버 코드. 목록 쿼리가 쓰고, 추천 칩(장르를 거르지 않음)·칩 라벨·미지정·모르는 글자는 undefined다. */
export const genreCode = (label: string): PublicWorldGenre | undefined => (Object.hasOwn(CODES, label) ? CODES[label as WorldGenre] : undefined)
/** 서버 코드 → 장르 라벨. 장르가 없는 세계관(null)은 '미지정'이다. */
export const genreLabel = (code: PublicWorldGenre | null): GenreLabel => WORLD_GENRES.find((label) => CODES[label] === code) ?? UNSET_GENRE

/** 홈 장르 칩 줄의 첫 칩과 같은 이름. 장르를 거르지 않고 모두 보인다. */
export const ALL_CHIP = '추천'

const GENRE_EMOJI: Record<WorldGenre, string> = { 판타지: '✨', SF: '🛰️', 무협: '⚔️', 로맨스: '💌', 현대: '🏙️', 고전: '📜', 미스터리: '🔎' }
/** 홈 장르 칩 줄과 같은 모양의 칩. 라벨에는 이모지를 붙이고, 고를 때는 라벨이 아니라 `genre` 값을 쓴다. */
export const WORLD_CHIPS: readonly { label: string; genre: string }[] = [
  { label: ALL_CHIP, genre: ALL_CHIP },
  ...WORLD_GENRES.map((genre) => ({ label: `${GENRE_EMOJI[genre]} ${genre}`, genre })),
]
