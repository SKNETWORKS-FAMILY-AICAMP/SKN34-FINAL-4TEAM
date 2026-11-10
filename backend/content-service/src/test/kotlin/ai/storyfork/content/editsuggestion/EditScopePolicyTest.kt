package ai.storyfork.content.editsuggestion

import ai.storyfork.content.editsuggestion.domain.EditScopePolicy
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Test

/** 자동 표기 교정 범위 검사(계약 2절)를 DB 없이 검증한다. 판정은 표시 전용이며 변경 전·후 문자열만으로 정한다. */
class EditScopePolicyTest {
    private fun check(before: String, after: String) = EditScopePolicy.check(before, after)
    private fun scope(before: String, after: String) = check(before, after).scope

    @Test fun `only spacing or punctuation differing is auto with the contract sentence`() {
        val spacing = check("안녕 하세요", "안녕하세요")
        assertEquals("auto", spacing.scope)
        assertEquals(listOf("띄어쓰기·문장부호만 바뀌어요."), spacing.reasons)

        assertEquals("auto", scope("그가 말했다.", "그가 말했다!"))
        assertEquals("auto", scope("“안녕”이라고 했다", "안녕이라고 했다"))
        assertEquals("auto", scope("가  나\n다", "가 나 다"))
        assertEquals("auto", scope("그렇게… 말했다", "그렇게 말했다"))
    }

    @Test fun `digits are compared as written so a comma inside a number is only punctuation`() {
        assertEquals("auto", scope("1,000명이 왔다", "1000명이 왔다"))
    }

    @Test fun `a changed number is review even when it is a one character edit`() {
        for ((before, after) in listOf("3명이 왔다" to "4명이 왔다", "100명" to "1000명", "3월 5일" to "3월 15일")) {
            val result = check(before, after)
            assertEquals("review", result.scope, "$before -> $after")
            assertEquals(listOf("숫자가 바뀌어요."), result.reasons, "$before -> $after")
        }
    }

    @Test fun `a one character typo in each changed word is auto`() {
        val typo = check("되뇌였다", "되뇌었다")
        assertEquals("auto", typo.scope)
        assertEquals(listOf("단어마다 한 글자 오탈자 수준만 바뀌어요."), typo.reasons)

        assertEquals("auto", scope("않 된다", "안 된다"))
        // 삽입·삭제도 편집 거리 1이다.
        assertEquals("auto", scope("하늘이 푸르다", "하늘이 푸르르다"))
        assertEquals("auto", scope("하늘이 푸르르다", "하늘이 푸르다"))
        // 바뀐 단어가 둘이어도 각각 한 글자면 auto, 같은 단어는 건너뛴다.
        assertEquals("auto", scope("않 된다 그리고 갔다", "안 됀다 그리고 갔다"))
    }

    @Test fun `replacing a word is review`() {
        val replaced = check("개를 보았다", "고양이를 보았다")
        assertEquals("review", replaced.scope)
        assertEquals(listOf("단어가 다른 말로 바뀌어요."), replaced.reasons)
        // 같은 단어 수에서 한 단어만 두 글자 이상 다르면 검토다.
        assertEquals("review", scope("그는 갔다", "그는 떠났다"))
        assertEquals("review", scope("않 된다 갔다", "안 된다 떠났다"))
    }

    @Test fun `adding or removing a word is review`() {
        val added = check("그는 갔다", "그는 먼저 갔다")
        assertEquals("review", added.scope)
        assertEquals(listOf("단어가 추가되거나 빠져요."), added.reasons)
        assertEquals("review", scope("그는 먼저 갔다", "그는 갔다"))
        // 띄어쓰기와 오탈자가 함께 바뀌어 단어 수가 달라져도 검토다.
        assertEquals("review", scope("않 된다", "안된다"))
    }

    @Test fun `an identical text is auto and says nothing changed`() {
        val same = check("그대로", "그대로")
        assertEquals("auto", same.scope)
        assertEquals(listOf("바뀐 내용이 없어요."), same.reasons)
    }

    @Test fun `digits take priority over the word rules and the reasons are not mixed`() {
        val result = check("3명이 갔다", "4명이 떠났다")
        assertEquals("review", result.scope)
        assertEquals(listOf("숫자가 바뀌어요."), result.reasons)
    }
}
