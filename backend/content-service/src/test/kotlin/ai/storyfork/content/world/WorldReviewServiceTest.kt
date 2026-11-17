package ai.storyfork.content.world

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.world.client.InitialWorldCallFailure
import ai.storyfork.content.world.client.InitialWorldExtractionClient
import ai.storyfork.content.world.domain.WorldNotFound
import ai.storyfork.content.world.domain.WorldStudioFailure
import ai.storyfork.content.world.domain.WorldConflict
import ai.storyfork.content.world.service.WorldReviewInput
import ai.storyfork.content.world.service.WorldReviewService
import ai.storyfork.content.world.service.WorldStudioService
import ai.storyfork.content.world.service.dto.CardPayload
import ai.storyfork.content.world.service.dto.WorldDraftResponse
import ai.storyfork.content.world.service.dto.WorldReviewFinding
import ai.storyfork.content.world.service.dto.WorldReviewResponse
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import org.mockito.Mockito.*

/** 설정집 검토의 순서와 실패 변환: 동의 → 소유자 초안 읽기 → (보낼 카드가 있을 때만) AI 호출 → 응답 검증. 저장소·AI는 대역이다. */
class WorldReviewServiceTest {
    private val studio = mock(WorldStudioService::class.java)
    private val ai = mock(InitialWorldExtractionClient::class.java)
    private val service = WorldReviewService(studio, ai)
    private val world = UUID.randomUUID()
    private val owner = UUID.randomUUID()
    private val hero = CardPayload(UUID.randomUUID(), "영웅", "본문", "character", "basic")
    private val huge = CardPayload(UUID.randomUUID(), "너무 큼", "가".repeat(4001), "rule", "basic")
    private val oneFinding = """{"findings":[{"cardIds":["${hero.id}"],"kind":"doc_role","message":"SOUL에 목표가 섞여 있어요."}],"reviewedCards":1,"model":"gpt-6-luna"}"""

    private fun saved(vararg cards: CardPayload): WorldDraftResponse {
        val draft = WorldDraftResponse(world, 12, null, null, "세계", "설명", cards.toList(), emptyList())
        `when`(studio.draftForReview(world, owner)).thenReturn(draft)
        return draft
    }

    @Test fun `without a true consent nothing is read and nothing is sent`() {
        for (consent in listOf(null, false)) {
            val failure = assertThrows<ContentFailure> { service.review(world, owner, consent) }
            assertEquals(422, failure.status)
            assertEquals("AI_CONSENT_REQUIRED", failure.code)
        }
        verifyNoInteractions(studio, ai)
    }

    @Test fun `reviews the saved draft and counts both what was sent and what exists`() {
        val draft = saved(hero, huge)
        `when`(ai.review(WorldReviewInput.fromDraft(draft))).thenReturn(oneFinding)

        val result = service.review(world, owner, true)

        assertEquals(WorldReviewResponse(12, 1, 2, listOf(WorldReviewFinding(listOf(hero.id.toString()), "doc_role", "SOUL에 목표가 섞여 있어요.")), "gpt-6-luna"), result)
    }

    @Test fun `with no card to send the AI is not called and the review is empty`() {
        saved()
        assertEquals(WorldReviewResponse(12, 0, 0, emptyList(), ""), service.review(world, owner, true))
        saved(huge)
        assertEquals(WorldReviewResponse(12, 0, 1, emptyList(), ""), service.review(world, owner, true))
        verifyNoInteractions(ai)
    }

    @Test fun `AI failures keep their kind with 503 for not configured, 504 for timeout and 502 for the rest, each with its own code`() {
        val request = WorldReviewInput.fromDraft(saved(hero))
        val table = listOf("AI_NOT_CONFIGURED" to 503, "AI_TIMEOUT" to 504, "AI_OUTPUT_INVALID" to 502, "AI_REQUEST_REJECTED" to 502, "AI_RESPONSE_UNCONFIRMED" to 502)
        for ((code, status) in table) {
            doThrow(InitialWorldCallFailure(code, code == "AI_TIMEOUT")).`when`(ai).review(request)
            val failure = assertThrows<ContentFailure>(code) { service.review(world, owner, true) }
            assertEquals(status, failure.status, code)
            assertEquals(code, failure.code, code)
        }
    }

    @Test fun `an answer that breaks the contract is a 502 AI_OUTPUT_INVALID, never an empty success`() {
        val request = WorldReviewInput.fromDraft(saved(hero))
        val unknownCard = """{"findings":[{"cardIds":["${UUID.randomUUID()}"],"kind":"other","message":"모르는 카드"}],"model":"m"}"""
        for (answer in listOf("not json", unknownCard)) {
            doReturn(answer).`when`(ai).review(request)
            val failure = assertThrows<ContentFailure>(answer) { service.review(world, owner, true) }
            assertEquals(502, failure.status, answer)
            assertEquals("AI_OUTPUT_INVALID", failure.code, answer)
        }
    }

    @Test fun `a world the caller cannot read is never sent to the AI`() {
        doThrow(WorldNotFound()).`when`(studio).draftForReview(world, owner)
        assertThrows<WorldNotFound> { service.review(world, owner, true) }
        doThrow(WorldStudioFailure.incomplete()).`when`(studio).draftForReview(world, owner)
        assertEquals("RELATIONSHIP_WRITE_INCOMPLETE", assertThrows<WorldStudioFailure> { service.review(world, owner, true) }.code)
        verifyNoInteractions(ai)
    }
    @Test fun `unfinished expansion blocks AI and completed expansion can be reviewed`() {
        val draft=WorldDraftResponse(world,12,null,null,"세계","설명",listOf(hero),emptyList())
        doThrow(WorldConflict()).doReturn(draft).`when`(studio).draftForReview(world,owner)
        `when`(ai.review(WorldReviewInput.fromDraft(draft))).thenReturn(oneFinding)
        assertThrows<WorldConflict> { service.review(world,owner,true) }
        verifyNoInteractions(ai)
        assertEquals(1,service.review(world,owner,true).reviewedCards)
        verify(ai).review(WorldReviewInput.fromDraft(draft))
    }
}
