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
import ai.storyfork.content.world.studio.entity.StudioWorld
import ai.storyfork.content.world.studio.entity.WorldReviewResult
import ai.storyfork.content.world.studio.repository.StudioWorldRepository
import ai.storyfork.content.world.studio.repository.WorldReviewResultRepository
import java.time.Instant
import java.time.OffsetDateTime
import java.time.temporal.ChronoUnit
import java.util.Optional
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import org.mockito.ArgumentMatchers.any
import org.mockito.Mockito.*
import org.springframework.transaction.PlatformTransactionManager
import org.springframework.transaction.support.SimpleTransactionStatus
import tools.jackson.databind.json.JsonMapper
import tools.jackson.module.kotlin.KotlinModule

/**
 * 설정집 검토의 순서·실패 변환·결과 저장: 동의 → 소유자 초안 읽기 → (보낼 카드가 있을 때만) AI 호출 → 응답 검증 → 짧은 트랜잭션에서 마지막 결과 덮어쓰기.
 * AI 호출은 트랜잭션 밖이고, 실패·검증 실패는 아무것도 저장하지 않는다. 저장소·AI는 대역이다.
 */
class WorldReviewServiceTest {
    private val studio = mock(WorldStudioService::class.java)
    private val ai = mock(InitialWorldExtractionClient::class.java)
    private val worlds = mock(StudioWorldRepository::class.java)
    private val results = mock(WorldReviewResultRepository::class.java)
    private val manager = mock(PlatformTransactionManager::class.java).also {
        `when`(it.getTransaction(any())).thenAnswer { SimpleTransactionStatus() }
    }
    private val mapper = JsonMapper.builder().addModule(KotlinModule.Builder().build()).build()
    private val service = WorldReviewService(studio, ai, worlds, results, manager, mapper)
    private val world = UUID.randomUUID()
    private val owner = UUID.randomUUID()
    private val link = "[승상](card:${UUID.randomUUID()})"
    private val hero = CardPayload(UUID.randomUUID(), "영웅", "본문 $link", "character", "basic", semanticMetadata = mapOf(
        "characterDocs" to mapOf("soul" to "느긋한 말투 $link", "goal" to "복수", "episodes" to mapOf("0" to "비밀"))))
    private val rule = CardPayload(UUID.randomUUID(), "규칙", "규칙 본문", "rule", "basic")
    private val huge = CardPayload(UUID.randomUUID(), "너무 큼", "가".repeat(4001), "rule", "basic")
    private val oneFinding = """{"findings":[{"cardIds":["${hero.id}"],"kind":"doc_role","message":"SOUL에 목표가 섞여 있어요."}],"reviewedCards":1,"model":"gpt-6-luna"}"""
    private val goalFix = """{"cardId":"${hero.id}","target":"goal","text":"새 목표"}"""
    private val fixedFinding = """{"cardIds":["${hero.id}"],"kind":"doc_role","message":"GOAL이 비어 있어요.","fix":$goalFix}"""
    private val plainFinding = """{"cardIds":["${rule.id}"],"kind":"other","message":"참고만 해요."}"""
    private val withFix = """{"findings":[$fixedFinding,$plainFinding],"reviewedCards":2,"model":"gpt-6-luna"}"""

    private fun owned() { `when`(worlds.lockOwned(world, owner)).thenReturn(StudioWorld(world, owner)) }

    private fun saved(vararg cards: CardPayload): WorldDraftResponse {
        val draft = WorldDraftResponse(world, 12, null, null, "세계", "설명", cards.toList(), emptyList())
        `when`(studio.draftForReview(world, owner)).thenReturn(draft)
        owned()
        return draft
    }

    private fun stored() = mockingDetails(results).invocations.filter { it.method.name == "save" }.map { it.arguments[0] as WorldReviewResult }

    /** 화면은 오프셋이 없는 날짜·시각(LocalDateTime 모양)을 응답 전체의 형식 오류로 본다. 오프셋이 없으면 parse가 던지므로 'Z'나 '+09:00'이 붙은 ISO-8601만 통과한다. */
    private fun assertOffsetIso(text: String) = assertEquals(Instant.parse(text), OffsetDateTime.parse(text).toInstant(), text)

    @Test fun `without a true consent nothing is read, sent or stored`() {
        for (consent in listOf(null, false)) {
            val failure = assertThrows<ContentFailure> { service.review(world, owner, consent) }
            assertEquals(422, failure.status)
            assertEquals("AI_CONSENT_REQUIRED", failure.code)
        }
        verifyNoInteractions(studio, ai, worlds, results, manager)
    }

    @Test fun `reviews the saved draft and counts both what was sent and what exists`() {
        val draft = saved(hero, huge)
        `when`(ai.review(WorldReviewInput.fromDraft(draft))).thenReturn(oneFinding)

        val result = service.review(world, owner, true)

        // 수정안이 없는 지적은 basis에 아무 카드도 올리지 않는다.
        assertEquals(WorldReviewResponse(12, 1, 2, listOf(WorldReviewFinding(listOf(hero.id.toString()), "doc_role", "SOUL에 목표가 섞여 있어요.")), "gpt-6-luna", result.reviewedAt, emptyMap()), result)
    }

    @Test fun `a successful review is stored as the world's latest result with the raw text of what its fixes would change`() {
        val draft = saved(hero, rule)
        `when`(ai.review(WorldReviewInput.fromDraft(draft))).thenReturn(withFix)
        val before = Instant.now().truncatedTo(ChronoUnit.MILLIS)

        val result = service.review(world, owner, true)
        val after = Instant.now()

        val row = stored().single()
        assertEquals(world, row.worldId)
        // 응답의 reviewedAt은 저장한 시각 그대로이고 ISO-8601이다.
        assertEquals(result.reviewedAt, row.reviewedAt.toString())
        assertFalse(row.reviewedAt.isBefore(before) || row.reviewedAt.isAfter(after))
        // 저장하는 result는 응답에서 reviewedAt만 뺀 것이다(시각은 reviewed_at 열). basis는 수정안이 가리킨 영웅 카드의 링크를 벗기기 전 글이다.
        val body = """{"draftRevision":12,"reviewedCards":2,"totalCards":2,
            "findings":[{"cardIds":["${hero.id}"],"kind":"doc_role","message":"GOAL이 비어 있어요.","fix":{"cardId":"${hero.id}","target":"goal","text":"새 목표"}},
                        {"cardIds":["${rule.id}"],"kind":"other","message":"참고만 해요."}],
            "model":"gpt-6-luna",
            "basis":{"${hero.id}":{"body":"본문 $link","characterDocs":{"soul":"느긋한 말투 $link","goal":"복수","episodes":{"0":"비밀"}}}}}"""
        assertEquals(mapper.readTree(body), mapper.readTree(mapper.writeValueAsString(row.result)))
        assertEquals(setOf(hero.id.toString()), result.basis.keys)
        // 화면이 받는 JSON은 같은 본문에 reviewedAt(오프셋이 있는 ISO-8601)이 더해진 모양이다. basis는 카드 id를 키로 한 객체이고 인물 문서의 회차 키는 글자 숫자다.
        assertEquals(mapper.readTree(body.removeSuffix("}") + ""","reviewedAt":"${result.reviewedAt}"}"""), mapper.readTree(mapper.writeValueAsString(result)))
        assertOffsetIso(result.reviewedAt)
    }

    @Test fun `the AI is called outside any transaction and the save is one short transaction that locks the owner's world first`() {
        val draft = saved(hero)
        val events = mutableListOf<String>()
        `when`(manager.getTransaction(any())).thenAnswer { events.add("begin"); SimpleTransactionStatus() }
        doAnswer { events.add("commit"); null }.`when`(manager).commit(any())
        `when`(ai.review(WorldReviewInput.fromDraft(draft))).thenAnswer { events.add("ai"); oneFinding }

        service.review(world, owner, true)

        assertEquals(listOf("ai", "begin", "commit"), events)
        val order = inOrder(studio, worlds, results)
        order.verify(studio).draftForReview(world, owner)
        order.verify(worlds).lockOwned(world, owner)
        order.verify(results).save(any())
        verify(manager, never()).rollback(any())
    }

    @Test fun `with no card to send the AI is not called and the empty review is still stored`() {
        saved()
        val first = service.review(world, owner, true)
        assertEquals(WorldReviewResponse(12, 0, 0, emptyList(), "", first.reviewedAt, emptyMap()), first)
        saved(huge)
        val second = service.review(world, owner, true)
        assertEquals(WorldReviewResponse(12, 0, 1, emptyList(), "", second.reviewedAt, emptyMap()), second)
        verifyNoInteractions(ai)

        assertEquals(2, stored().size)
        assertEquals(mapper.readTree("""{"draftRevision":12,"reviewedCards":0,"totalCards":1,"findings":[],"model":"","basis":{}}"""),
            mapper.readTree(mapper.writeValueAsString(stored().last().result)))
    }

    @Test fun `AI failures keep their kind with 503 for not configured, 504 for timeout and 502 for the rest, each with its own code, and store nothing`() {
        val request = WorldReviewInput.fromDraft(saved(hero))
        val table = listOf("AI_NOT_CONFIGURED" to 503, "AI_TIMEOUT" to 504, "AI_OUTPUT_INVALID" to 502, "AI_REQUEST_REJECTED" to 502, "AI_RESPONSE_UNCONFIRMED" to 502)
        for ((code, status) in table) {
            doThrow(InitialWorldCallFailure(code, code == "AI_TIMEOUT")).`when`(ai).review(request)
            val failure = assertThrows<ContentFailure>(code) { service.review(world, owner, true) }
            assertEquals(status, failure.status, code)
            assertEquals(code, failure.code, code)
        }
        verifyNoInteractions(results, manager)
    }

    @Test fun `an answer that breaks the contract is a 502 AI_OUTPUT_INVALID, never an empty success, and the previous result stays`() {
        val request = WorldReviewInput.fromDraft(saved(hero))
        val unknownCard = """{"findings":[{"cardIds":["${UUID.randomUUID()}"],"kind":"other","message":"모르는 카드"}],"model":"m"}"""
        for (answer in listOf("not json", unknownCard)) {
            doReturn(answer).`when`(ai).review(request)
            val failure = assertThrows<ContentFailure>(answer) { service.review(world, owner, true) }
            assertEquals(502, failure.status, answer)
            assertEquals("AI_OUTPUT_INVALID", failure.code, answer)
        }
        verifyNoInteractions(results, manager)
    }

    @Test fun `a world the caller cannot read is never sent to the AI`() {
        doThrow(WorldNotFound()).`when`(studio).draftForReview(world, owner)
        assertThrows<WorldNotFound> { service.review(world, owner, true) }
        doThrow(WorldStudioFailure.incomplete()).`when`(studio).draftForReview(world, owner)
        assertEquals("RELATIONSHIP_WRITE_INCOMPLETE", assertThrows<WorldStudioFailure> { service.review(world, owner, true) }.code)
        verifyNoInteractions(ai, results, manager)
    }

    @Test fun `a world deleted while the AI worked gets no stored result`() {
        val draft = saved(hero)
        `when`(ai.review(WorldReviewInput.fromDraft(draft))).thenReturn(oneFinding)
        `when`(worlds.lockOwned(world, owner)).thenReturn(null)

        assertThrows<WorldNotFound> { service.review(world, owner, true) }

        verifyNoInteractions(results)
        verify(manager).rollback(any())
        verify(manager, never()).commit(any())
    }

    @Test fun `unfinished expansion blocks AI and completed expansion can be reviewed`() {
        val draft=WorldDraftResponse(world,12,null,null,"세계","설명",listOf(hero),emptyList())
        owned()
        doThrow(WorldConflict()).doReturn(draft).`when`(studio).draftForReview(world,owner)
        `when`(ai.review(WorldReviewInput.fromDraft(draft))).thenReturn(oneFinding)
        assertThrows<WorldConflict> { service.review(world,owner,true) }
        verifyNoInteractions(ai, results)
        assertEquals(1,service.review(world,owner,true).reviewedCards)
        verify(ai).review(WorldReviewInput.fromDraft(draft))
    }

    @Test fun `latest hands back what the review answered, field for field`() {
        val draft = saved(hero, rule)
        `when`(ai.review(WorldReviewInput.fromDraft(draft))).thenReturn(withFix)
        val posted = service.review(world, owner, true)
        `when`(results.findById(world)).thenReturn(Optional.of(stored().single()))

        val read = service.latest(world, owner)

        assertEquals(posted, read)
        assertEquals(posted.reviewedAt, read.reviewedAt)
        // 화면이 받는 JSON도 같다: POST와 latest의 키·값·basis 모양이 다르지 않고 reviewedAt은 둘 다 오프셋이 있다.
        assertEquals(mapper.readTree(mapper.writeValueAsString(posted)), mapper.readTree(mapper.writeValueAsString(read)))
        assertOffsetIso(posted.reviewedAt)
        assertOffsetIso(read.reviewedAt)
        verify(worlds, times(2)).lockOwned(world, owner)
    }

    @Test fun `latest without a stored review is 404 WORLD_REVIEW_NOT_FOUND`() {
        owned()
        `when`(results.findById(world)).thenReturn(Optional.empty())

        val failure = assertThrows<ContentFailure> { service.latest(world, owner) }

        assertEquals(404, failure.status)
        assertEquals("WORLD_REVIEW_NOT_FOUND", failure.code)
    }

    @Test fun `latest of a world the caller cannot lock is WorldNotFound and reads no result`() {
        `when`(worlds.lockOwned(world, owner)).thenReturn(null)

        assertThrows<WorldNotFound> { service.latest(world, owner) }

        verifyNoInteractions(results, ai, studio)
    }
}
