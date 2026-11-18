import type { CardType } from './studioCards'

/*
 * 공개 세계관([계약](../../../../docs/design/public-world-contract.md)): 소유자가 공개로 바꾼 세계관의 마지막 저장 버전(설정 카드)과 현재 관계.
 * 비로그인도 읽기 전용으로 본다. 아래 "데모 전용" 선택 필드는 서버 계약에 없다(파생·조합은 서버에 없고 `works`는 실제 작품이 아니다. DEC-35·46).
 * 실제 모드 응답에는 없고 메모리 데모(`--mode mockup`)만 채우며, 화면은 값이 없으면 빈 상태·숨김으로 그린다. 연결된 소설(`linkedWork`)은 반대로 서버가 주는 값이다.
 */

/** 서버 장르 코드. 미지정은 `null`이다. 화면 라벨은 presentation의 `worldGenres.ts`가 정한다. */
export const PUBLIC_WORLD_GENRES = ['fantasy', 'sf', 'wuxia', 'romance', 'modern', 'classic', 'mystery'] as const
export type PublicWorldGenre = (typeof PUBLIC_WORLD_GENRES)[number]

/** `imageId`는 카드 대표 이미지(#401)다. 있으면 공개 주소(`/api/v1/public/world-studios/{id}/card-images/{imageId}`)가 이미지를 주고, 없거나 null이면(데모 포함) 이미지 없는 카드다. */
export type PublicWorldCard = { id: string; title: string; text: string; cardType: CardType; aliases: string[]; tags: string[]; imageId?: string | null }
/** 이 세계관에 연결된 소설(1:1, DEC-46)의 최소 정보. 서버는 그 소설이 공개 작품일 때만 준다. `hasCover`이면 공개 작품 표지 주소(`/api/v1/public/works/{id}/cover/content`)가 이미지를 준다. */
export type PublicWorldLinkedWork = { id: string; title: string; authorNickname: string; hasCover: boolean }
/** 현재 관계(Neo4j) 한 줄. 양 끝 카드는 같은 응답의 `cards`에 있고 선택적 속성이 없으면 값을 알 수 없다. */
export type PublicWorldRelationship = { id: string; sourceCardId: string; targetCardId: string; label: string; category?: 'structural' | 'emotional' | null; direction?: 'directed' | 'symmetric' | null; body?: string | null; polarity?: 'asserted' | 'denied' | null }

export type PublicWorldSummary = {
  id: string
  name: string
  description: string
  genre: PublicWorldGenre | null
  authorNickname: string
  cardCount: number
  relationshipCount: number | null
  /** ISO-8601. 목록은 이 값의 최신 순이다. */
  publishedAt: string
  /** 소유자가 올린 표지가 있는지. 있으면 공개 cover 주소(`/api/v1/public/world-studios/{id}/cover`)가 이미지를 주고, 없거나 값이 없으면(데모) 기본 표지를 쓴다. */
  hasCover?: boolean
  /** 데모 전용: 파생 원본 세계관 id */
  derivedFrom?: string
  /** 데모 전용: 조합 원본 세계관 id들(둘 이상) */
  combinedFrom?: readonly string[]
  /** 데모 전용: 설정 카드 요약. 지도가 카드 점을 그린다(목록 응답에는 카드가 없고 `cardCount`만 있다). */
  cards?: readonly Pick<PublicWorldCard, 'id' | 'title' | 'cardType'>[]
}

/** `total`은 서버가 센 전체 수라 `items`보다 클 수 있다. */
export type PublicWorldPage = { items: PublicWorldSummary[]; page: number; size: number; total: number; demo?: true }

/**
 * 데모 전용: 한 세계관의 유효한 원본(파생 하나 → 조합 원본들, 적힌 순서). `known`(목록에 있는 세계관 id)에 없는 id와 자기 자신은 버리고 조합 안의 중복 원본은 한 번만 센다.
 * 지도(presentation)의 링크와 메모리 저장소의 계보가 같은 규칙을 쓰도록 한 곳에 둔다.
 */
export function lineageOrigins(w: Pick<PublicWorldSummary, 'id' | 'derivedFrom' | 'combinedFrom'>, known: ReadonlySet<string>) {
  const pick = (id: string, kind: 'derive' | 'combine') => (id !== w.id && known.has(id) ? [{ id, kind }] : [])
  return [...(w.derivedFrom ? pick(w.derivedFrom, 'derive') : []), ...[...new Set(w.combinedFrom)].flatMap((id) => pick(id, 'combine'))]
}

/** 데모 전용: 계보·작품 선반이 그리는 세계관 한 줄 */
export type PublicWorldRef = Pick<PublicWorldSummary, 'id' | 'name' | 'genre' | 'authorNickname' | 'cardCount'>
/** 데모 전용: 이 세계관이 파생·조합된 출처(`derivedFrom`·`combinedFrom`)와 이 세계관에서 나온 세계관(`children`) */
export type PublicWorldLineage = {
  derivedFrom?: PublicWorldRef
  combinedFrom: PublicWorldRef[]
  children: (PublicWorldRef & { kind: 'derive' | 'combine' })[]
}
/** 데모 전용: 이 세계관으로 쓴 작품(실제 작품이 아니다) */
export type PublicWorldWork = { title: string; author: string; episodes: number; genre: PublicWorldGenre | null }

export type PublicWorld = {
  id: string
  name: string
  description: string
  genre: PublicWorldGenre | null
  authorNickname: string
  publishedAt: string
  /** 올린 표지가 있는지(목록 항목과 같다). */
  hasCover?: boolean
  revisionNo: number
  cards: PublicWorldCard[]
  relationships: PublicWorldRelationship[]
  /** `unavailable`이면 관계를 불러오지 못한 것이다(카드는 그대로). 관계가 없는 `current`와 구분한다. */
  relationshipStatus: 'current' | 'unavailable'
  /** 연결된 공개 소설. 연결이 없거나 소설이 공개가 아니면 서버가 null로 알려 존재를 드러내지 않는다(#329). 메모리 데모 응답에는 없다. */
  linkedWork?: PublicWorldLinkedWork | null
  /** 데모 전용: 메모리 데모 응답 표시. 이 값이 있으면 화면이 "데모" 안내를 보인다. */
  demo?: true
  /** 데모 전용: 상세 제목 아래 한 줄 소개(서버에는 설명만 있다) */
  hook?: string
  lineage?: PublicWorldLineage
  works?: readonly PublicWorldWork[]
}
