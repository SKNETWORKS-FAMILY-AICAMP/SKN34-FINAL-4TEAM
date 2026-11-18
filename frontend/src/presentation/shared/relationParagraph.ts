import type { PublicWorldRelationship } from '../../domain/entities/publicWorld'

/*
 * 관계의 위키 문단(DEC-54)이 두 화면(독자 설정 위키·공개 카드 페이지)에서 같은 규칙을 쓰게 하는 순수 함수.
 * 관계 `A → B 「관계명」`은 "B는 A의 관계명"으로 읽는다. 보내는 쪽(A) 페이지에는 `B — 관계명` 문단(관계 설명 포함)이 보이고,
 * 받는 쪽(B) 페이지에는 단방향이면 '이 설정을 가리키는 관계'의 `A(관계명)` 링크만, 대칭·방향 미상이면 문단이 보인다.
 */

/** 문단을 가진 카드([ownerCardId])와 관계 id로 정하는 문단의 DOM id. 받는 쪽 링크는 보내는 쪽 카드의 앵커로 간다. 대칭·미상 관계는 양쪽 문단이 한 페이지에 함께 있어도(독자 위키) 서로 다르다. */
export const relationAnchor = (ownerCardId: string, relationId: string) => `rel-${ownerCardId}-${relationId}`

/** 이 관계가 이 카드 페이지에 문단으로 보이는가. [sends]는 이 카드가 보내는 쪽(source)인지다. 단방향(`directed`)은 받는 쪽에 문단이 없고 링크뿐이다. */
export const showsParagraph = (direction: PublicWorldRelationship['direction'], sends: boolean) => sends || direction !== 'directed'

/** 관계명. 「동일 인물」(`identity`)은 저장된 label과 상관없이 늘 '동일 인물'이고 그 밖은 label이다. */
export const relationName = (category: PublicWorldRelationship['category'], label: string) => (category === 'identity' ? '동일 인물' : label)

/**
 * 문단 소제목 옆에 작은 글자로 붙는 부가 표시: 구조·감정 관계, 대칭·방향 미상, 부정된 관계. 단방향과 확인된 관계는 적지 않는다(문단이 어느 쪽에 있는지가 방향이다).
 * 「동일 인물」은 종류와 방향을 적지 않고 부정된 경우만 알린다.
 */
export const relationNote = ({ category, direction, polarity }: Pick<PublicWorldRelationship, 'category' | 'direction' | 'polarity'>) => [
  category === 'emotional' ? '감정 관계' : category === 'structural' ? '구조 관계' : '',
  category === 'identity' || direction === 'directed' ? '' : direction === 'symmetric' ? '대칭 관계' : '방향 미상',
  polarity === 'denied' ? '부정된 관계' : '',
].filter(Boolean).join(' · ')
