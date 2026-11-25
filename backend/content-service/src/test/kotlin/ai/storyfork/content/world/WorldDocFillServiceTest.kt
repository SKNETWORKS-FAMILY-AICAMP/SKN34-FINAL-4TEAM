package ai.storyfork.content.world

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.episode.service.EpisodeService
import ai.storyfork.content.episode.service.dto.DraftResponse
import ai.storyfork.content.episode.service.dto.EpisodeListResponse
import ai.storyfork.content.episode.service.dto.EpisodeResponse
import ai.storyfork.content.episode_version.service.dto.VersionResponse
import ai.storyfork.content.work.service.WorkWorldService
import ai.storyfork.content.world.client.InitialWorldCallFailure
import ai.storyfork.content.world.client.InitialWorldExtractionClient
import ai.storyfork.content.world.client.dto.WorldDocFillAiPassage
import ai.storyfork.content.world.client.dto.WorldDocFillAiRequest
import ai.storyfork.content.world.domain.WorldNotFound
import ai.storyfork.content.world.service.WorldDocFillService
import ai.storyfork.content.world.service.WorldStudioService
import ai.storyfork.content.world.service.dto.CardPayload
import ai.storyfork.content.world.service.dto.WorldDocFillLine
import ai.storyfork.content.world.service.dto.WorldDocFillResponse
import ai.storyfork.content.world.service.dto.WorldDraftResponse
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.assertThrows
import org.mockito.Mockito.*

/**
 * 인물 문서 채우기(docs/design/world-review-contract.md)의 순서·거절·실패 변환: 동의 → 소유자 초안의 인물 카드 → 비어 있는 문서 → 연결된 소설의 저장 원고에서 발췌 → (발췌가 있을 때만) AI → 응답 검증.
 * 아무것도 저장하지 않는다(제안은 화면 상태이고 반영은 기존 세계관 저장이다). 저장소·AI는 대역이다.
 */
class WorldDocFillServiceTest {
    private val studio = mock(WorldStudioService::class.java)
    private val ai = mock(InitialWorldExtractionClient::class.java)
    private val links = mock(WorkWorldService::class.java)
    private val episodes = mock(EpisodeService::class.java)
    private val service = WorldDocFillService(studio, ai, links, episodes)
    private val world = UUID.randomUUID()
    private val owner = UUID.randomUUID()
    private val look = "키가 작고 얼굴이 검게 탔다."
    private val hero = CardPayload(UUID.randomUUID(), "치삼", "", "character", "society", aliases = listOf("치삼이"))
    private val rule = CardPayload(UUID.randomUUID(), "규칙", "", "rule", "basic")
    private val removed = CardPayload(UUID.randomUUID(), "지운 인물", "", "character", "society", lifecycle = "removed")
    private val filled = CardPayload(UUID.randomUUID(), "다 채운 인물", "정체", "character", "society", semanticMetadata = mapOf(
        "characterDocs" to mapOf("soul" to "말투", "goal" to "", "episodes" to emptyMap<String, String>())))
    private val blank = WorldDocFillAiRequest("", "", emptyList(), emptyList(), emptyList())

    /** doThrow·doReturn과 함께 쓰는 '어떤 요청이든' 일치(Kotlin 널 불가 인자라 자리 값을 둔다). */
    private fun anyRequest() = org.mockito.ArgumentMatchers.any(WorldDocFillAiRequest::class.java) ?: blank

    private fun draft(vararg cards: CardPayload): WorldDraftResponse {
        val draft = WorldDraftResponse(world, 12, null, null, "세계", "설명", cards.toList(), emptyList())
        `when`(studio.draftForReview(world, owner)).thenReturn(draft)
        return draft
    }

    private fun linked(work: String? = "work-1") = `when`(links.linkedWorkIds(listOf(world))).thenReturn(if (work == null) emptyMap() else mapOf(world to work))

    private fun saved(number: Int, vararg bodies: String, inherited: Boolean = false) =
        EpisodeResponse(number, DraftResponse(), bodies.mapIndexed { i, body -> VersionResponse("v$number-$i", "제목", body, i, number, "2026-11-10T00:00:00Z") }, null, inherited, null)

    private fun manuscript(vararg items: EpisodeResponse) = `when`(episodes.list("work-1", owner.toString())).thenReturn(EpisodeListResponse(items.toList()))

    private fun ready() {
        draft(hero, rule, removed); linked()
        manuscript(saved(2, "옛 초안", "장터의 소금장수 치삼이 다가왔다. $look"), saved(3, "아무도 없다."), saved(4, "치삼이 말했다."))
    }

    private val answer = """{"lines":[{"target":"body","kind":"description","episode":2,"quote":"$look"}],"skipped":1,"model":"gpt-6-luna"}"""

    @Test fun `without a true consent nothing is read or sent`() {
        for (consent in listOf(null, false)) {
            val failure = assertThrows<ContentFailure> { service.fill(world, hero.id, owner, consent) }
            assertEquals(422, failure.status)
            assertEquals("AI_CONSENT_REQUIRED", failure.code)
        }
        verifyNoInteractions(studio, ai, links, episodes)
    }

    @Test fun `sends the latest saved text around the names of the card and returns the verified lines`() {
        ready()
        val sent = WorldDocFillAiRequest(hero.id.toString(), "치삼", listOf("치삼이"), listOf("body", "soul"), listOf(
            WorldDocFillAiPassage(2, "장터의 소금장수 치삼이 다가왔다. $look"), WorldDocFillAiPassage(4, "치삼이 말했다.")))
        `when`(ai.fill(sent)).thenReturn(answer)

        val result = service.fill(world, hero.id, owner, true)

        assertEquals(WorldDocFillResponse(listOf(WorldDocFillLine("body", "description", 2, look)), 1, "gpt-6-luna"), result)
        verify(ai, times(1)).fill(sent)
    }

    @Test fun `an episode inherited from another work or without a saved version is not read`() {
        draft(hero); linked()
        manuscript(saved(1, "원작의 치삼이 있었다.", inherited = true), saved(2), saved(3, "내 치삼이 왔다."))
        val sent = WorldDocFillAiRequest(hero.id.toString(), "치삼", listOf("치삼이"), listOf("body", "soul"), listOf(WorldDocFillAiPassage(3, "내 치삼이 왔다.")))
        `when`(ai.fill(sent)).thenReturn("""{"lines":[],"skipped":0,"model":"m"}""")

        assertEquals(emptyList<WorldDocFillLine>(), service.fill(world, hero.id, owner, true).lines)
        verify(ai).fill(sent)
    }

    @Test fun `a name that is nowhere in the saved text means no AI call and no evidence`() {
        draft(hero); linked(); manuscript(saved(1, "아무도 없다."))

        val result = service.fill(world, hero.id, owner, true)

        assertEquals(WorldDocFillResponse(emptyList(), 0, ""), result)
        verifyNoInteractions(ai)
    }

    @Test fun `another member's or a missing world is a 404 before anything else`() {
        `when`(studio.draftForReview(world, owner)).thenThrow(WorldNotFound())

        assertThrows<WorldNotFound> { service.fill(world, hero.id, owner, true) }
        verifyNoInteractions(ai, links, episodes)
    }

    @Test fun `a card that is missing, removed, not a person, or already filled is refused with its own code`() {
        draft(hero, rule, removed, filled); linked(); manuscript(saved(1, "치삼"))
        fun refused(card: UUID, status: Int, code: String) = assertThrows<ContentFailure> { service.fill(world, card, owner, true) }.also { assertEquals(status to code, it.status to it.code) }

        refused(UUID.randomUUID(), 404, "CARD_NOT_FOUND")
        refused(removed.id, 404, "CARD_NOT_FOUND")
        refused(rule.id, 422, "CARD_NOT_CHARACTER")
        refused(filled.id, 409, "DOCS_NOT_EMPTY")
        verifyNoInteractions(ai)
    }

    @Test fun `a world with no linked novel has no manuscript to read`() {
        draft(hero); linked(null)

        val failure = assertThrows<ContentFailure> { service.fill(world, hero.id, owner, true) }

        assertEquals(409 to "WORLD_NOT_LINKED", failure.status to failure.code)
        verifyNoInteractions(ai, episodes)
    }

    @Test fun `AI failures keep their kind, 503 not configured, 504 timeout and 502 for the rest`() {
        ready()
        for ((code, status) in listOf("AI_NOT_CONFIGURED" to 503, "AI_TIMEOUT" to 504, "AI_REQUEST_REJECTED" to 502, "AI_OUTPUT_INVALID" to 502, "AI_RESPONSE_UNCONFIRMED" to 502)) {
            doThrow(InitialWorldCallFailure(code, false)).`when`(ai).fill(anyRequest())

            val failure = assertThrows<ContentFailure> { service.fill(world, hero.id, owner, true) }

            assertEquals(status to code, failure.status to failure.code)
        }
    }

    @Test fun `an answer the sent excerpts do not support is a 502, never a proposal`() {
        ready()
        doReturn("""{"lines":[{"target":"body","kind":"fact","episode":2,"quote":"지어낸 문장"}],"skipped":0,"model":"m"}""").`when`(ai).fill(anyRequest())

        val failure = assertThrows<ContentFailure> { service.fill(world, hero.id, owner, true) }

        assertEquals(502 to "AI_OUTPUT_INVALID", failure.status to failure.code)
    }
}
