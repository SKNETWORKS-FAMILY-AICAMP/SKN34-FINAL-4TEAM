package ai.storyfork.content.work.domain

import ai.storyfork.content._common.exception.checkContent

/** 홈 장르 칩에 보이는 장르(활성이면서 홈 노출을 켠 장르)의 최대 수다(DEC-56). */
const val MAX_FEATURED_GENRES = 6
const val MAX_GENRE_NAME = 30
const val MAX_GENRE_EMOJI = 8

private val GENRE_NUMBER = Regex("genre-(\\d+)")

/** 장르 이름이다. 앞뒤 공백을 자르고 1~30자(코드 포인트)여야 하며 어긋나면 422다. */
fun genreName(raw: String?): String {
    val name = raw?.trim().orEmpty()
    checkContent(name.codePointCount(0, name.length) in 1..MAX_GENRE_NAME, message = "장르 이름은 1~${MAX_GENRE_NAME}자로 입력해 주세요.")
    return name
}

/** 칩 앞 아이콘이다. 앞뒤 공백을 자르며 비면 없음(null)이고 8자(코드 포인트)를 넘으면 422다. */
fun genreEmoji(raw: String?): String? {
    val emoji = raw?.trim()?.takeIf { it.isNotEmpty() } ?: return null
    checkContent(emoji.codePointCount(0, emoji.length) <= MAX_GENRE_EMOJI, message = "아이콘은 ${MAX_GENRE_EMOJI}자 이하로 입력해 주세요.")
    return emoji
}

/** 새 장르의 코드다. 기존 `genre-NN` 번호의 최댓값 다음 번호이며 중간의 빈 번호는 채우지 않는다. */
fun nextGenreCode(codes: Collection<String>): String {
    val last = codes.mapNotNull { GENRE_NUMBER.matchEntire(it)?.groupValues?.get(1)?.toIntOrNull() }.maxOrNull() ?: 0
    return "genre-" + (last + 1).toString().padStart(2, '0')
}
