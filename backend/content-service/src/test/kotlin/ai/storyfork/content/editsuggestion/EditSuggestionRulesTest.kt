package ai.storyfork.content.editsuggestion

import ai.storyfork.content.editsuggestion.domain.DraftReplacement
import ai.storyfork.content.editsuggestion.domain.EditSuggestionRules
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/** 승인 반영의 초안 문자열 1회 치환 규칙을 DB 없이 검증한다. 상태 전이(편집안 저장·승인·거절·보류)는 EditSuggestionServiceTest가 같은 전이로 검증한다. */
class EditSuggestionRulesTest {
    @Test fun `a sentence found exactly once is replaced in place and nothing else changes`() {
        val body = "그는 문을 열었다.\n않 된다고 말했다.\n\n끝."

        val result = EditSuggestionRules.replaceOnce(body, "않 된다고", "안 된다고")

        assertEquals(DraftReplacement.Replaced("그는 문을 열었다.\n안 된다고 말했다.\n\n끝."), result)
    }

    @Test fun `a sentence missing from the draft fails with the not found reason`() {
        val result = EditSuggestionRules.replaceOnce("전혀 다른 본문", "없는 문장", "고친 문장")

        assertEquals(DraftReplacement.Failed(EditSuggestionRules.NOT_FOUND_IN_DRAFT), result)
    }

    @Test fun `a sentence found more than once fails and the draft is left alone`() {
        val result = EditSuggestionRules.replaceOnce("같은 문장. 중간. 같은 문장.", "같은 문장.", "고친 문장.")

        assertEquals(DraftReplacement.Failed(EditSuggestionRules.AMBIGUOUS_IN_DRAFT), result)
    }

    @Test fun `overlapping matches count as more than one so the target stays unambiguous`() {
        assertEquals(DraftReplacement.Failed(EditSuggestionRules.AMBIGUOUS_IN_DRAFT), EditSuggestionRules.replaceOnce("aaa", "aa", "b"))
        assertEquals(DraftReplacement.Replaced("ab"), EditSuggestionRules.replaceOnce("aa", "aa", "ab"))
    }

    @Test fun `the replacement is literal text and the new text is not searched again`() {
        // 정규식 치환 표기($1·\)가 아니라 글자 그대로 넣고, 바꾼 글에 원래 문장이 들어 있어도 한 번만 바꾼다.
        assertEquals(DraftReplacement.Replaced("나\$1\\가다"), EditSuggestionRules.replaceOnce("나가다", "가", "\$1\\가"))
        assertEquals(DraftReplacement.Replaced("나가가다"), EditSuggestionRules.replaceOnce("나가다", "가", "가가"))
    }

    @Test fun `the failure reasons are complete sentences that point the owner to the writing room`() {
        for (reason in listOf(EditSuggestionRules.NOT_FOUND_IN_DRAFT, EditSuggestionRules.AMBIGUOUS_IN_DRAFT)) {
            assertTrue(reason.endsWith("."), reason)
            assertTrue("집필실" in reason, reason)
        }
        assertFalse(EditSuggestionRules.NOT_FOUND_IN_DRAFT == EditSuggestionRules.AMBIGUOUS_IN_DRAFT)
    }
}
