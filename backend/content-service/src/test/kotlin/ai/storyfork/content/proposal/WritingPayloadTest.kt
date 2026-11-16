package ai.storyfork.content.proposal

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.proposal.client.dto.WritingDraftPayload
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Test

class WritingPayloadTest {
    @Test
    fun `AI 문맥 한도를 넘는 새 원고 요청은 호출 전에 422로 거절한다`() {
        WritingDraftPayload(1, "계획", "x".repeat(60000))
        val failure = assertThrows(ContentFailure::class.java) { WritingDraftPayload(1, "계획", "x".repeat(60001)) }
        assertEquals(422, failure.status)
    }
}
