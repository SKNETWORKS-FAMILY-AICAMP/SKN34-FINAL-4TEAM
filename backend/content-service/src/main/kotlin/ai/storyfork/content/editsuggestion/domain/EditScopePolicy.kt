package ai.storyfork.content.editsuggestion.domain

import kotlin.math.abs

/** 변경 전·후를 비교한 범위 검사 결과다. [scope]는 `auto`(자동 처리 가능)·`review`(작가 검토 필요)이고 [reasons]는 판정 사유 문장이다. */
data class ScopeCheck(val scope: String, val reasons: List<String>)

/**
 * 자동 표기 교정 범위 검사. 변경 전·후 문자열만 보고 판정하며 표시 전용이다(자동 승인·발행은 기능 30).
 * 위에서부터 처음 맞는 규칙을 따른다: 같은 글 → 공백·문장부호만 다름(auto) → 숫자가 바뀜(review)
 * → 단어 수가 같고 바뀐 단어마다 글자 편집 거리 1 이하(auto) → 그 밖의 단어 교체·추가·삭제(review).
 * ponytail: 고유명사를 알지 못한다. 한 글자만 다른 이름 교체는 auto로 보일 수 있어 표시 전용으로만 쓴다. 자동 반영 전에 세계관 인물·장소 이름 대조를 더한다.
 */
object EditScopePolicy {
    const val AUTO = "auto"
    const val REVIEW = "review"

    private val SPACE = Regex("[\\s\\p{Z}]+")
    private val SPACE_OR_PUNCTUATION = Regex("[\\s\\p{Z}\\p{P}]")

    fun check(before: String, after: String): ScopeCheck {
        if (before == after) return ScopeCheck(AUTO, listOf("바뀐 내용이 없어요."))
        if (before.replace(SPACE_OR_PUNCTUATION, "") == after.replace(SPACE_OR_PUNCTUATION, "")) return ScopeCheck(AUTO, listOf("띄어쓰기·문장부호만 바뀌어요."))
        if (before.filter(Char::isDigit) != after.filter(Char::isDigit)) return ScopeCheck(REVIEW, listOf("숫자가 바뀌어요."))
        val old = words(before)
        val new = words(after)
        if (old.size != new.size) return ScopeCheck(REVIEW, listOf("단어가 추가되거나 빠져요."))
        return if (old.zip(new).all { (a, b) -> a == b || withinOneEdit(a, b) }) ScopeCheck(AUTO, listOf("단어마다 한 글자 오탈자 수준만 바뀌어요."))
        else ScopeCheck(REVIEW, listOf("단어가 다른 말로 바뀌어요."))
    }

    private fun words(text: String) = text.split(SPACE).filter { it.isNotEmpty() }

    /** 서로 다른 두 단어의 글자 편집 거리(치환·삽입·삭제)가 1 이하인지 본다. */
    private fun withinOneEdit(a: String, b: String): Boolean {
        if (abs(a.length - b.length) > 1) return false
        val same = a.commonPrefixWith(b).length
        return when {
            a.length == b.length -> a.substring(same + 1) == b.substring(same + 1)
            a.length > b.length -> a.substring(same + 1) == b.substring(same)
            else -> a.substring(same) == b.substring(same + 1)
        }
    }
}
