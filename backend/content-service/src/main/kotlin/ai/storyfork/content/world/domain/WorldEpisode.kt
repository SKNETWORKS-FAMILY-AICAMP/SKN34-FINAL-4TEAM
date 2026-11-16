package ai.storyfork.content.world.domain

/** 관계를 기록·조회하는 회차는 연결된 소설의 회차 순번이라 1 이상이다(DEC-51). null은 '최신 회차'다. 값 오류는 [IllegalArgumentException]이며 소유자 API가 422로 바꾼다. */
fun validEpisode(episode: Int?): Int? = episode?.also { require(it >= 1) { "회차는 1 이상의 정수여야 합니다." } }

/** 쿼리·도구 인자로 받은 회차 글자를 읽는다. 숫자 타입으로 받으면 Spring 변환 실패가 400이라 문자열로 받아 여기서 읽는다. */
fun episodeFromText(code: String?): Int? = code?.let { validEpisode(requireNotNull(it.toIntOrNull()) { "회차는 1 이상의 정수여야 합니다." }) }
