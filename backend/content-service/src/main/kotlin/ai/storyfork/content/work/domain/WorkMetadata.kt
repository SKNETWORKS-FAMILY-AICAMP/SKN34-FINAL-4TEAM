package ai.storyfork.content.work.domain

import ai.storyfork.content._common.exception.checkContent

/** 작품 등록 시 고르는 유형. 외부 2차 창작물은 무료 공개만 가능하다(UC-23, BR-09). Fork는 별도 경로다. */
enum class CreationType(val code: String) {
    ORIGINAL("original"),
    EXTERNAL_DERIVATIVE("external_derivative"),
}

const val MAX_WORK_GENRES = 2
const val MAX_WORK_HASHTAGS = 10

data class WorkMetadata(val type: CreationType, val genres: List<String>, val hashtags: List<String>)

/**
 * 작품 등록 입력을 검증한다(#49). 하나라도 어긋나면 ContentFailure(422)를 던지고 아무것도 만들지 않는다.
 * 권리 확인은 등록 요건이며 플랫폼이 작품별 권리를 직접 검증했다는 뜻이 아니다(DEC-38).
 * 해시태그의 유해 콘텐츠 1차 필터(UC-14)와 글자 수 제한은 정책이 정해지지 않아 여기서 다루지 않는다.
 * [selectable]은 지금 고를 수 있는 장르 이름이다([validateWorkGenres]).
 */
fun validateWorkMetadata(typeName: String?, genres: List<String>, hashtags: List<String>, rightsConfirmed: Boolean, selectable: Set<String>): WorkMetadata {
    val type = CreationType.entries.firstOrNull { it.name == typeName }
    checkContent(type != null, message = "작품 유형을 선택해 주세요.")
    validateWorkGenres(genres, selectable)
    val tags = validateWorkHashtags(hashtags)
    checkContent(rightsConfirmed, message = "작품 등록을 위해 권리 확인이 필요해요.")
    return WorkMetadata(type!!, genres, tags)
}

/**
 * 장르를 검증한다. 서로 다른 장르 1~2개가 모두 [selectable](지금 고를 수 있는 장르 이름)에 있어야 하며 어긋나면 422다.
 * 등록은 활성 장르만, 수정은 활성 장르에 그 작품에 이미 붙은 장르(숨긴 것 포함)를 더해 넘긴다(DEC-56). 숨긴 장르를 새로 붙이는 것만 막는다.
 * 작품 수정이 등록과 같은 규칙을 장르만 따로 쓸 때도 부른다.
 */
fun validateWorkGenres(genres: List<String>, selectable: Set<String>) {
    checkContent(genres.size in 1..MAX_WORK_GENRES, message = "장르는 1개 이상 2개 이하로 선택해 주세요.")
    checkContent(genres.all { it in selectable } && genres.toSet().size == genres.size, message = "고를 수 있는 장르 목록에서 서로 다른 장르를 골라 주세요.")
}

/** 해시태그를 검증하고 앞뒤 공백을 자른 목록을 돌려준다. 0~10개이며 빈 태그는 거절하고 어긋나면 422다. */
fun validateWorkHashtags(hashtags: List<String>): List<String> {
    val tags = hashtags.map { it.trim() }
    checkContent(tags.size <= MAX_WORK_HASHTAGS, message = "해시태그는 최대 ${MAX_WORK_HASHTAGS}개까지 등록할 수 있어요.")
    checkContent(tags.none { it.isEmpty() }, message = "비어 있는 해시태그는 등록할 수 없어요.")
    return tags
}
