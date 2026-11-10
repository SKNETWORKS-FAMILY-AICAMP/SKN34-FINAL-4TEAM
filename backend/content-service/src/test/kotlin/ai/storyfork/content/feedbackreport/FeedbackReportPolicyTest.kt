package ai.storyfork.content.feedbackreport

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.feedbackreport.domain.*
import java.time.Instant
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test

/** 제보의 입력 정리·상태 전이·열람 권한·정정/철회 가능 여부 규칙을 DB·Spring 없이 검증한다(계약 1절 규칙). */
class FeedbackReportPolicyTest {
    private fun status(block: () -> Any?) = assertThrows(ContentFailure::class.java) { block() }.status

    @Test fun `kind accepts exactly the four reader choices`() {
        listOf("typo", "story", "question", "suggestion").forEach { assertEquals(it, reportKind(it)) }
        listOf("", "TYPO", "comment", "typo ").forEach { assertEquals(422, status { reportKind(it) }) }
    }

    @Test fun `visibility defaults to private and rejects unknown values`() {
        assertEquals("private", reportVisibility(null))
        assertEquals("public", reportVisibility("public"))
        assertEquals("private", reportVisibility("private"))
        assertEquals(422, status { reportVisibility("friends") })
    }

    @Test fun `an author can set checked answered resolved or closed but never back to unchecked`() {
        listOf("checked", "answered", "resolved", "closed").forEach { assertEquals(it, settableStatus(it)) }
        assertEquals(422, status { settableStatus("unchecked") })
        assertEquals(422, status { settableStatus("done") })
    }

    @Test fun `body is trimmed and must be 1 to 500 non blank characters without NUL`() {
        assertEquals("오탈자", reportBody("  오탈자  "))
        assertEquals(500, reportBody("가".repeat(500)).length)
        assertEquals(422, status { reportBody("가".repeat(501)) })
        assertEquals(422, status { reportBody("   ") })
        // Kotlin trim·isNotBlank는 NBSP도 공백으로 본다.
        assertEquals(422, status { reportBody("\u00A0\u00A0") })
        assertEquals(422, status { reportBody("가\u0000나") })
    }

    @Test fun `quote is optional trimmed up to 500 characters and blank means none`() {
        assertNull(reportQuote(null))
        assertNull(reportQuote("   "))
        assertEquals("선택한 문장", reportQuote("  선택한 문장 "))
        assertEquals(500, reportQuote("가".repeat(500))!!.length)
        assertEquals(422, status { reportQuote("가".repeat(501)) })
        assertEquals(422, status { reportQuote("가\u0000나") })
    }

    @Test fun `correction body follows the report body limits`() {
        assertEquals("고침", correctionBody(" 고침 "))
        assertEquals(422, status { correctionBody("") })
        assertEquals(422, status { correctionBody("가".repeat(501)) })
    }

    @Test fun `author response is 1 to 2000 characters`() {
        assertEquals("답변", responseBody(" 답변 "))
        assertEquals(2000, responseBody("가".repeat(2000)).length)
        assertEquals(422, status { responseBody("가".repeat(2001)) })
        assertEquals(422, status { responseBody("  ") })
        assertEquals(422, status { responseBody("가\u0000") })
    }

    @Test fun `author check only moves unchecked to checked`() {
        assertEquals("checked", statusAfterCheck("unchecked"))
        listOf("checked", "answered", "resolved", "closed").forEach { assertEquals(it, statusAfterCheck(it)) }
    }

    @Test fun `an answer moves unchecked or checked to answered and keeps finished states`() {
        assertEquals("answered", statusAfterResponse("unchecked"))
        assertEquals("answered", statusAfterResponse("checked"))
        listOf("answered", "resolved", "closed").forEach { assertEquals(it, statusAfterResponse(it)) }
    }

    @Test fun `correction and withdrawal are blocked after withdrawal with 409`() {
        ensureCanCorrect(null)
        ensureCanWithdraw(null)
        val at = Instant.parse("2026-11-10T00:00:00Z")
        assertEquals(409, status { ensureCanCorrect(at) })
        assertEquals(409, status { ensureCanWithdraw(at) })
    }

    @Test fun `public reports are fully visible and private ones only to the reporter and the owner`() {
        // 공개 제보는 누구나 원문까지 본다.
        assertEquals(ReportView.FULL, reportView("public", mine = false, owner = false, hasPublicResponse = false))
        // 비공개 제보는 제보자·작품 소유자만 원문을 본다.
        assertEquals(ReportView.FULL, reportView("private", mine = true, owner = false, hasPublicResponse = false))
        assertEquals(ReportView.FULL, reportView("private", mine = false, owner = true, hasPublicResponse = false))
        assertEquals(ReportView.FULL, reportView("private", mine = true, owner = true, hasPublicResponse = true))
        // 그 외에는 공개 답변이 있을 때만 원문 없이 답변만 보이고, 없으면 존재 자체가 숨겨진다.
        assertEquals(ReportView.ANSWERS_ONLY, reportView("private", mine = false, owner = false, hasPublicResponse = true))
        assertEquals(ReportView.HIDDEN, reportView("private", mine = false, owner = false, hasPublicResponse = false))
    }
}
