package ai.storyfork.content.world.service.dto

/** 카드 생성·수정 선택지가 읽는 공개 카테고리다. 숨긴 카테고리도 담고(이미 쓰는 카드의 이름 표시용) 화면이 [active]로 새로 고를 것만 거른다. */
data class PublicCardCategoryResponse(val code: String, val name: String, val icon: String?, val position: Int, val active: Boolean)

/** 운영 카테고리 표의 한 행(숨김 포함)이다. [cardCount]는 지우지 않은 세계관의 활성 카드 초안 수다. */
data class CardCategoryResponse(val code: String, val name: String, val icon: String?, val active: Boolean, val position: Int, val cardCount: Int)

/** 새 카테고리다. 코드와 순서는 서버가 정한다. */
data class CardCategoryCreateRequest(val name: String? = null, val icon: String? = null)

/** 보낸 필드만 바꾼다. `icon`은 빈 문자열이면 지운다. */
data class CardCategoryUpdateRequest(val name: String? = null, val icon: String? = null, val active: Boolean? = null)

/** 전체 카테고리 코드를 새 순서대로 한 번씩 담는다. */
data class CardCategoryOrderRequest(val codes: List<String>? = null)
