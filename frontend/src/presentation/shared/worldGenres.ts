import { emojiName, type Genre } from '../../domain/entities/genre'

/*
 * 공개 세계관 화면의 장르(DEC-56): 세계관의 `genre`는 장르 코드(`genre-01` …)이고, 이름은 `PublicWorldUseCase`가 공개 장르 목록(활성 장르)으로 붙인 `genreName`이다.
 * 이름을 알 수 없는 세계관(장르 없음·숨긴 장르)은 코드를 보이지 않고 '미지정'(장르 없음)처럼 그린다.
 */

/** 장르가 없거나 이름을 알 수 없는 세계관의 화면 라벨. 칩에는 없다. */
export const UNSET_GENRE = '미지정' as const
/** 세계관의 화면 라벨: 장르 이름, 알 수 없으면 '미지정'. */
export const genreLabel = (world: { genreName?: string | null }) => world.genreName ?? UNSET_GENRE
/** 지도의 장르 노드·색·하이라이트가 쓰는 구분 키: 이름을 아는 장르의 코드, 장르 없음·숨긴 장르는 ''. */
export const genreKey = (world: { genre: string | null; genreName?: string | null }) => (world.genre && world.genreName ? world.genre : '')

/** 장르 없음의 색. 어두운 캔버스 위에서 읽히는 밝은 회청색이다. */
export const UNSET_COLOR = '#9AA7BD'
/**
 * 장르 색(지도·범례·상세 그래프가 함께 쓴다): 코드 번호로 황금각(137.5°)씩 돌린 밝은 색이라 장르가 늘어도 표 없이 서로 떨어지고 같은 장르는 늘 같은 색이다.
 * ponytail: 장르가 수십 개로 늘면 색이 비슷한 장르가 생긴다(범례가 이름을 함께 보여 준다).
 */
export const genreColor = (key: string) => {
  const number = Number(/\d+/.exec(key)?.[0])
  return key && Number.isFinite(number) ? hslHex((number * 137.508) % 360, 0.85, 0.72) : UNSET_COLOR
}
/** HSL(색상 0~360, 채도·명도 0~1)을 #rrggbb로 바꾼다. */
function hslHex(hue: number, saturation: number, lightness: number) {
  const a = saturation * Math.min(lightness, 1 - lightness)
  const channel = (n: number) => {
    const k = (n + hue / 30) % 12
    return Math.round(255 * (lightness - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, '0')
  }
  return `#${channel(0)}${channel(8)}${channel(4)}`
}

/** 홈 장르 칩 줄의 첫 칩과 같은 이름. 장르를 거르지 않고 모두 보인다. */
export const ALL_CHIP = '추천'
export type WorldChip = { label: string; genre: string }
/**
 * 세계관 목록의 칩 줄: 추천 + 세계관이 하나 이상 있는 활성 장르(공개 장르 목록 순서, 라벨은 아이콘 이름).
 * 칩의 `genre`는 장르 이름이고(서버가 이름을 유일하게 지켜, 지도 노드의 장르와 같은 값이다) 추천 칩은 ALL_CHIP이다. 고를 때는 라벨이 아니라 `genre` 값을 쓴다.
 */
export const worldChips = (genres: readonly Genre[], worlds: readonly { genre: string | null }[]): WorldChip[] => [
  { label: ALL_CHIP, genre: ALL_CHIP },
  ...genres.filter((genre) => worlds.some((w) => w.genre === genre.code)).map((genre) => ({ label: emojiName(genre), genre: genre.name })),
]
/** 칩의 장르 값(이름) → 목록 쿼리의 장르 코드. 추천 칩과 목록에 없는 값은 장르를 거르지 않는다(undefined). */
export const genreCode = (genres: readonly Genre[], chip: string) => genres.find((genre) => genre.name === chip)?.code
