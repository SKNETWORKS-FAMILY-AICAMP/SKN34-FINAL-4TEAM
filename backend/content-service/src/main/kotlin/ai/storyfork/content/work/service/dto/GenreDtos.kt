package ai.storyfork.content.work.service.dto

/** 작품·세계관 장르 선택지와 홈 칩이 읽는 공개 장르(활성만)다. */
data class PublicGenreResponse(val code: String, val name: String, val emoji: String?, val featured: Boolean)

/** 운영 장르 표의 한 행(숨김 포함)이다. 사용 수는 지우지 않은 작품·세계관 수다. */
data class GenreResponse(
    val code: String, val name: String, val emoji: String?, val active: Boolean, val featured: Boolean, val position: Int,
    val workCount: Int, val worldCount: Int,
)

/** 새 장르다. 코드와 순서는 서버가 정한다. */
data class GenreCreateRequest(val name: String? = null, val emoji: String? = null)

/** 보낸 필드만 바꾼다. `emoji`는 빈 문자열이면 지운다. */
data class GenreUpdateRequest(val name: String? = null, val emoji: String? = null, val active: Boolean? = null, val featured: Boolean? = null)

/** 전체 장르 코드를 새 순서대로 한 번씩 담는다. */
data class GenreOrderRequest(val codes: List<String>? = null)
