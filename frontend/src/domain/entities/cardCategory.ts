import { cardTypes } from './studioCards'

/*
 * 세계관 카드 카테고리(운영자 콘텐츠 관리 결정 E): 장르(DEC-56)와 같은 패턴이다. 정본은 Content `card_category`이고 운영자가
 * 추가·이름·아이콘·숨김·순서를 관리한다(삭제 없음). 카드의 `cardType`은 카테고리 코드이고 기본 8종은 코드가 고정이다.
 */

/**
 * 공개 카테고리 한 줄(`GET /public/card-categories`): 숨긴 것까지 모두, position 순서로 온다(계약 보완 2).
 * 작가 선택지는 활성(`active`)만 쓰고, 이미 쓰던 숨긴 카테고리는 카드에 이름이 그대로 보이게 한다.
 */
export type CardCategory = { code: string; name: string; icon: string | null; position: number; active: boolean }
/** 운영 화면의 한 줄: 이 카테고리를 쓰는 카드 수가 붙는다. */
export type OperationsCardCategory = CardCategory & { cardCount: number }
export type CardCategoryInput = { name: string; icon?: string }
/** 바꿀 값만 담는다. `icon: ''`는 아이콘을 지운다. */
export type CardCategoryPatch = { name?: string; icon?: string; active?: boolean }

/** 이름은 1~30자, 아이콘은 최대 8자(장르와 같은 한도). 최종 검증은 서버가 한다. */
export const CARD_CATEGORY_NAME_MAX = 30
export const CARD_CATEGORY_ICON_MAX = 8

/** 카드 카테고리 관리는 `works`(화면 이름 '작품 관리') 권한이 있어야 한다. 403이면 다시 시도 대신 이 안내만 보인다. */
export const CARD_CATEGORY_FORBIDDEN = "카드 카테고리를 관리하려면 '작품 관리' 권한이 필요해요."
/** 서버가 `{code, message}`로 거절하는 카드 카테고리 오류 code → 화면에 그대로 보일 한국어 안내(서버 문구는 영문 고정이다). */
export const CARD_CATEGORY_MESSAGES: Record<string, string> = {
  CARD_CATEGORY_NAME_TAKEN: '이미 같은 이름의 카드 카테고리가 있어요.',
}
/** 순서 저장(PUT order)이 현재 목록과 맞지 않을 때(422)의 안내. */
export const CARD_CATEGORY_ORDER_MESSAGE = '순서가 목록과 맞지 않아요. 목록을 새로고침한 뒤 다시 시도해 주세요.'

/** 목록에서도 기본 8종 이름에서도 찾지 못한 카테고리(운영자가 만든 뒤 지워진 값)에 코드 대신 보이는 이름. */
const HIDDEN_CATEGORY_NAME = '숨긴 분류'

/** 카테고리 이름: 목록(숨긴 것 포함)이 먼저고, 없으면 기본 8종 이름, 그것도 없으면 `숨긴 분류`다. 코드(`cc-07` 같은 값)는 화면에 보이지 않는다. */
export const categoryName = (categories: readonly Pick<CardCategory, 'code' | 'name'>[], code: string) =>
  categories.find((c) => c.code === code)?.name ?? cardTypes.find((t) => t.id === code)?.label ?? HIDDEN_CATEGORY_NAME

/** 메뉴·칩에 쓰는 이름: 아이콘이 있으면 `📖 이름`, 없으면 이름만. */
export const categoryIcon = (c: Pick<CardCategory, 'name' | 'icon'>) => (c.icon ? `${c.icon} ${c.name}` : c.name)

/**
 * 카드 생성·수정 선택지: 활성 카테고리를 position 순서로 두고, 이미 고른 값(`current`)이 숨긴 카테고리면 그것도 그대로 남긴다
 * (숨긴 카테고리는 새로 붙일 수 없지만 이미 쓰던 값을 바꾸지 않으면 통과한다). 목록에 없는 값은 만들어 내지 않는다.
 */
export const categoryChoices = (categories: readonly CardCategory[], current?: string): CardCategory[] =>
  categories.filter((c) => c.active || c.code === current).toSorted((a, b) => a.position - b.position)
