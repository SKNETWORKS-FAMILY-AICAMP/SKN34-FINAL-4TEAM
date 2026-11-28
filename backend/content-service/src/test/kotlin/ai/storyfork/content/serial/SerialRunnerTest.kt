package ai.storyfork.content.serial

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.auth.client.exception.CoreAuthException
import ai.storyfork.content.auth.service.CoreAuthVerificationService
import ai.storyfork.content.auth.service.CoreCreditService
import ai.storyfork.content.context.service.ManuscriptQaService
import ai.storyfork.content.context.service.dto.QaEpisodeRef
import ai.storyfork.content.context.service.dto.QaSource
import ai.storyfork.content.publication.service.PublicationService
import ai.storyfork.content.publication.service.dto.PublishedEpisodeListResponse
import ai.storyfork.content.publication.service.dto.PublishedEpisodeResponse
import ai.storyfork.content.serial.client.GeneratedChoices
import ai.storyfork.content.serial.client.GeneratedEpisode
import ai.storyfork.content.serial.client.GeneratedSummary
import ai.storyfork.content.serial.client.SerialAiClient
import ai.storyfork.content.serial.client.SerialAiFailure
import ai.storyfork.content.serial.client.SerialScene
import ai.storyfork.content.serial.client.aiFailure
import ai.storyfork.content.serial.domain.CleanProposal
import ai.storyfork.content.serial.domain.RankedChoice
import ai.storyfork.content.serial.domain.RankedProposal
import ai.storyfork.content.serial.domain.cleanProposal
import ai.storyfork.content.serial.entity.SerialBoardEntity
import ai.storyfork.content.serial.entity.SerialChoiceEntity
import ai.storyfork.content.serial.entity.SerialProposalEntity
import ai.storyfork.content.serial.service.ChoiceInput
import ai.storyfork.content.serial.service.OpenBoard
import ai.storyfork.content.serial.service.RunInput
import ai.storyfork.content.serial.service.SerialRunner
import ai.storyfork.content.serial.service.SerialService
import ai.storyfork.content.serial.service.SerialSummaryService
import ai.storyfork.content.serial.service.SummaryTarget
import ai.storyfork.content.serial.service.dto.SerialProposalCreated
import ai.storyfork.content.serial.service.dto.SerialProposalRequest
import ai.storyfork.content.serial.service.dto.SerialSimulationRequest
import ai.storyfork.content.work.service.WorkService
import ai.storyfork.content.work.service.WorkWorldService
import ai.storyfork.content.world.service.WorldStudioService
import ai.storyfork.content.world.service.dto.CardPayload
import ai.storyfork.content.world.service.dto.InheritedWorldResponse
import ai.storyfork.content.world.service.dto.ReaderWorldCardResponse
import ai.storyfork.content.world.service.dto.ReaderWorldCardsResponse
import ai.storyfork.content.world.service.dto.RelationshipPayload
import ai.storyfork.content.world.service.dto.WorldDraftResponse
import ch.qos.logback.classic.Logger
import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.core.read.ListAppender
import java.math.BigDecimal
import java.time.Instant
import java.time.LocalDate
import java.time.ZonedDateTime
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.ArgumentMatchers
import org.mockito.Mockito.*
import org.slf4j.LoggerFactory
import org.springframework.http.HttpHeaders
import org.springframework.http.HttpStatusCode
import org.springframework.web.client.HttpClientErrorException
import org.springframework.web.client.HttpServerErrorException
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper

/**
 * AI 자율 연재의 외부 호출 순서를 검증한다: 크레딧 예약 → AI → (저장·발행) → 정산, 실패면 해제와 고정 문구 사유. 회차 실행·선택지 생성·회차 요약·시뮬레이션 제안 글 네 흐름과 문맥(이전 회차 요약·관련 장면 검색)이다.
 * DB 규칙은 SerialServiceTest가 보고 여기서는 SerialService·Core·AI를 대역으로 둔다. 실제 HTTP는 CI가 확인한다.
 */
class SerialRunnerTest {
    private val owner = UUID.randomUUID().toString()
    private val member = UUID.randomUUID().toString()
    private val worldId = UUID.randomUUID()
    private val now = ZonedDateTime.parse("2026-11-23T21:10:00+09:00[Asia/Seoul]")
    private val at: Instant = now.toInstant()
    private val today = LocalDate.parse("2026-11-23")
    private val key = "serial-run:b1"

    private val serial = mock(SerialService::class.java)
    private val summaries = mock(SerialSummaryService::class.java)
    private val qa = mock(ManuscriptQaService::class.java)
    private val credits = mock(CoreCreditService::class.java)
    private val ai = mock(SerialAiClient::class.java)
    private val publication = mock(PublicationService::class.java)
    private val works = mock(WorkService::class.java)
    private val workWorlds = mock(WorkWorldService::class.java)
    private val worldStudio = mock(WorldStudioService::class.java)
    private val auth = mock(CoreAuthVerificationService::class.java)
    private val mapper = JsonMapper.builder().build()
    private val runner = SerialRunner(serial, summaries, qa, credits, ai, publication, works, workWorlds, worldStudio, auth, mapper, BigDecimal("5"), BigDecimal("3"), BigDecimal("4"), BigDecimal("150"))

    private val episodeRequests = mutableListOf<Map<*, *>>()
    private val simulationRequests = mutableListOf<Map<*, *>>()
    private val generated = GeneratedEpisode("종합 문장", "새 제목", "새 본문", BigDecimal("1.2345"))
    private val board = SerialBoardEntity(id = "b1", workId = "w", episodeNumber = 4, status = "queued", openedAt = at.minusSeconds(600))

    private fun proposal(id: String, kind: String = "general", scene: String? = null) = SerialProposalEntity(
        id = id, boardId = "b1", authorId = "a-$id", kind = kind, title = "제목 $id", body = "본문 $id",
        simulation = if (kind == "simulation") mapOf("premise" to "전제", "beats" to listOf("비트"), "scene" to scene) else null, createdAt = at.minusSeconds(100),
    )
    private val topChoice = RankedChoice(SerialChoiceEntity(id = "c2", boardId = "b1", position = 2, text = "선택지 둘"), 3)
    private val input = RunInput(
        "w", "b1", owner, "작품", "소개", 4, "따뜻하게",
        topChoice, listOf(RankedProposal(proposal("a"), 3), RankedProposal(proposal("b", "simulation", "장면 미리보기"), 1)),
    )

    private fun published(vararg numbers: Int) = numbers.map { PublishedEpisodeResponse(it, 1, "v$it", "제 $it" + "화", "본문 $it") }
    private fun anyMap() = ArgumentMatchers.anyMap<String, Any?>()
    private fun status(block: () -> Unit) = assertThrows(ContentFailure::class.java, block)

    // 회차 실행은 세계관이 필수다(인물 시뮬레이션을 건너뛰는 길이 없다): 연결 세계관이거나 Fork가 이어받는 원작 세계관이다.
    private val heroId = UUID.randomUUID()
    private val shadowId = UUID.randomUUID()
    private val heroCard = CardPayload(heroId, "주인공", "용감하다", "character", "basic", aliases = listOf("영웅"), visibility = "private")
    private val shadowCard = CardPayload(shadowId, "그림자", "정체를 숨긴다", "character", "basic")
    private val removedCard = CardPayload(UUID.randomUUID(), "지운 카드", "없음", "other", "basic", lifecycle = "removed")
    private val subject = UUID.fromString(owner)

    private fun relation(category: String, source: UUID, target: UUID, label: String = "") =
        RelationshipPayload(UUID.randomUUID(), source, target, category, label = label, direction = "directed")

    /** Fork가 자기 세계관 없이 이어받는 원작 세계관이다(대상 4화의 직전 3화 기준). */
    private fun inheritsWorld(vararg relations: RelationshipPayload) {
        `when`(workWorlds.inheritedWorld("w", owner, "3")).thenReturn(InheritedWorldResponse("w", worldId, 3, listOf(heroCard, shadowCard, removedCard), relations.toList()))
    }

    private fun queue() {
        `when`(serial.queued()).thenReturn(listOf(board))
        `when`(serial.due(now)).thenReturn(emptyList())
        `when`(serial.staleRunning(at)).thenReturn(emptyList())
        `when`(serial.enabledWorkIds()).thenReturn(emptyList())
        `when`(serial.claim("b1", "queued", today, at)).thenReturn(true)
        `when`(serial.runInput("b1")).thenReturn(input)
        `when`(auth.verifyScheduledMember(owner)).thenReturn(UUID.fromString(owner))
        `when`(publication.publishedEpisodes("w")).thenReturn(PublishedEpisodeListResponse(published(1, 2, 3)))
        `when`(workWorlds.linkedWorldId("w", owner)).thenReturn(null)
        inheritsWorld()
        `when`(credits.reserve(owner, key, BigDecimal("150"))).thenReturn("res-1")
        `when`(ai.episode(anyMap())).thenAnswer { call -> episodeRequests.add(call.arguments[0] as Map<*, *>); generated }
    }

    // ---- 회차 실행: 성공

    @Test fun `a queued board is claimed generated published and then settled`() {
        queue()

        runner.tick(now)

        val order = inOrder(serial, auth, credits, ai)
        order.verify(serial).claim("b1", "queued", today, at)
        order.verify(serial).runInput("b1")
        order.verify(auth).verifyScheduledMember(owner)
        order.verify(credits).reserve(owner, key, BigDecimal("150"))
        order.verify(ai).episode(anyMap())
        order.verify(serial).publish("b1", owner, generated, at)
        // 정산은 저장·발행이 끝난 뒤다: 발행이 실패하면 차감 없이 해제한다.
        order.verify(credits).settle(owner, key, BigDecimal("1.2345"))
        verify(credits, never()).release(ArgumentMatchers.anyString(), ArgumentMatchers.anyString())
        verify(serial, never()).fail(ArgumentMatchers.anyString(), ArgumentMatchers.anyString(), ArgumentMatchers.any(Instant::class.java) ?: at)
    }

    @Test fun `the episode request carries the direction the top choice the proposals with likes and scene and the limit`() {
        queue()

        runner.tick(now)

        val body = episodeRequests.single()
        assertEquals(setOf("workId", "episodeNumber", "direction", "choice", "proposals", "context", "world", "creditLimit", "creditReservationId"), body.keys)
        assertEquals(listOf("w", 4, "따뜻하게"), listOf(body["workId"], body["episodeNumber"], body["direction"]))
        assertEquals(BigDecimal("150"), body["creditLimit"])
        // world는 JSON 객체이고 「동일 인물」 관계가 없어도 identity 키는 빈 배열로 있다(AI의 world 모양: world_studio_read 응답 + identity).
        val world = body["world"] as JsonNode
        assertTrue(world.isObject)
        assertTrue(world.path("identity").isArray)
        assertEquals(0, world.path("identity").size())
        // 비용 집계용으로 Core 예약 id를 싣는다(AI trace의 credit_reservation_id).
        assertEquals("res-1", body["creditReservationId"])
        assertEquals(mapOf("text" to "선택지 둘", "votes" to 3), body["choice"])
        assertEquals(
            listOf(
                mapOf("title" to "제목 a", "body" to "본문 a", "likes" to 3, "scene" to null),
                mapOf("title" to "제목 b", "body" to "본문 b", "likes" to 1, "scene" to "장면 미리보기"),
            ),
            body["proposals"],
        )
    }

    @Test fun `a board without choices or proposals sends a null choice and an empty list`() {
        queue()
        `when`(serial.runInput("b1")).thenReturn(input.copy(choice = null, proposals = emptyList()))

        runner.tick(now)

        val body = episodeRequests.single()
        // 선택지가 없으면 키는 두고 값은 null이다(AI 요청의 choice: {text, votes} | null).
        assertTrue(body.containsKey("choice"))
        assertNull(body["choice"])
        assertEquals(emptyList<Any>(), body["proposals"])
    }

    @Test fun `the owner context holds the three latest published episodes and no cards without a linked world`() {
        queue()
        `when`(publication.publishedEpisodes("w")).thenReturn(PublishedEpisodeListResponse(published(1, 2, 3, 4, 5)))

        runner.tick(now)

        val context = mapper.readTree(episodeRequests.single()["context"] as String)
        assertEquals("작품", context.path("title").asString())
        assertEquals(listOf(3, 4, 5), context.path("episodes").values().map { it.path("number").asInt() })
        assertEquals(0, context.path("cards").size())
        verifyNoInteractions(worldStudio)
    }

    @Test fun `a linked world adds the owner's active cards to the context`() {
        queue()
        `when`(workWorlds.linkedWorldId("w", owner)).thenReturn(worldId)
        val hero = CardPayload(UUID.randomUUID(), "주인공", "용감하다", "character", "basic", aliases = listOf("영웅"), visibility = "private")
        val removed = CardPayload(UUID.randomUUID(), "지운 카드", "없음", "other", "basic", lifecycle = "removed")
        val draft = WorldDraftResponse(worldId, 3, null, null, "세계", "", listOf(hero, removed), emptyList())
        `when`(worldStudio.draft(worldId, UUID.fromString(owner))).thenReturn(draft)
        `when`(worldStudio.draft(worldId, UUID.fromString(owner), 3)).thenReturn(draft)

        runner.tick(now)

        val cards = mapper.readTree(episodeRequests.single()["context"] as String).path("cards")
        assertEquals(1, cards.size())
        assertEquals(listOf("주인공", "character", "용감하다", "영웅"), listOf(cards[0].path("title").asString(), cards[0].path("type").asString(), cards[0].path("text").asString(), cards[0].path("aliases")[0].asString()))
    }

    @Test fun `a board that another tick already claimed is left alone`() {
        queue()
        `when`(serial.claim("b1", "queued", today, at)).thenReturn(false)

        runner.tick(now)

        verify(serial, never()).runInput(ArgumentMatchers.anyString())
        verifyNoInteractions(credits, ai)
    }

    @Test fun `due open boards run after the queued ones with the open state`() {
        queue()
        val scheduled = SerialBoardEntity(id = "b2", workId = "w2", episodeNumber = 2, status = "open", openedAt = at.minusSeconds(600))
        `when`(serial.queued()).thenReturn(emptyList())
        `when`(serial.due(now)).thenReturn(listOf(scheduled))
        `when`(serial.claim("b2", "open", today, at)).thenReturn(false)

        runner.tick(now)

        verify(serial).claim("b2", "open", today, at)
        verify(serial, never()).claim("b1", "queued", today, at)
    }

    // ---- 회차 실행: 실패

    @Test fun `not enough credit fails the board without calling the AI or releasing anything`() {
        queue()
        doThrow(ContentFailure(409, "크레딧이 부족합니다.", "INSUFFICIENT_CREDIT")).`when`(credits).reserve(owner, key, BigDecimal("150"))

        runner.tick(now)

        verify(serial).fail("b1", "크레딧이 부족합니다.", at)
        verifyNoInteractions(ai)
        verify(credits, never()).release(ArgumentMatchers.anyString(), ArgumentMatchers.anyString())
        verify(serial, never()).publish(ArgumentMatchers.anyString(), ArgumentMatchers.anyString(), ArgumentMatchers.any(GeneratedEpisode::class.java) ?: generated, ArgumentMatchers.any(Instant::class.java) ?: at)
    }

    @Test fun `a failed review releases the reservation and says the review failed`() {
        queue()
        `when`(ai.episode(anyMap())).thenThrow(SerialAiFailure(reviewFailed = true))

        runner.tick(now)

        verify(credits).release(owner, key)
        verify(serial).fail("b1", "검수를 통과하지 못했습니다.", at)
        verify(credits, never()).settle(ArgumentMatchers.anyString(), ArgumentMatchers.anyString(), ArgumentMatchers.any(BigDecimal::class.java) ?: BigDecimal.ZERO)
    }

    @Test fun `a credit limit overrun releases the reservation and says the limit was exceeded`() {
        queue()
        `when`(ai.episode(anyMap())).thenThrow(SerialAiFailure(limitExceeded = true))

        runner.tick(now)

        verify(credits).release(owner, key)
        verify(serial).fail("b1", "크레딧 상한을 넘었습니다.", at)
        verify(credits, never()).settle(ArgumentMatchers.anyString(), ArgumentMatchers.anyString(), ArgumentMatchers.any(BigDecimal::class.java) ?: BigDecimal.ZERO)
        verify(serial, never()).publish(ArgumentMatchers.anyString(), ArgumentMatchers.anyString(), ArgumentMatchers.any(GeneratedEpisode::class.java) ?: generated, ArgumentMatchers.any(Instant::class.java) ?: at)
    }

    @Test fun `a simulation failure the AI explains keeps its sentence as the reason and releases the hold`() {
        queue()
        val sentence = "인물 문서가 비어 있어요: 카엘(SOUL.md). 세계관 관리 화면에서 채워 주세요."
        `when`(ai.episode(anyMap())).thenThrow(SerialAiFailure(detail = sentence))

        runner.tick(now)

        // 계약: 인물 카드 없음·필수 문서 비어 있음 같은 시뮬레이션 실패는 AI 문구 그대로가 게시판 사유다. 예약은 해제하고 차감·발행은 없다.
        verify(credits).release(owner, key)
        verify(serial).fail("b1", sentence, at)
        verify(credits, never()).settle(ArgumentMatchers.anyString(), ArgumentMatchers.anyString(), ArgumentMatchers.any(BigDecimal::class.java) ?: BigDecimal.ZERO)
        verify(serial, never()).publish(ArgumentMatchers.anyString(), ArgumentMatchers.anyString(), ArgumentMatchers.any(GeneratedEpisode::class.java) ?: generated, ArgumentMatchers.any(Instant::class.java) ?: at)
    }

    // ---- 회차 실행: AI 오류 응답이 게시판 사유가 되기까지(진단을 위해 502·504의 AI 문구도 보인다, 2026-11-28 사용자 결정)

    /** AI가 돌려준 오류 응답(FastAPI의 JSONResponse: charset 없는 application/json의 UTF-8 본문)을 SerialAiClient와 같은 규칙(aiFailure)으로 호출 실패로 바꿔 던지게 하고 회차 실행을 한 번 돈다. */
    private fun runWithAiAnswer(status: Int, body: String) {
        reset(serial, credits, ai)
        queue()
        val headers = HttpHeaders().apply { set(HttpHeaders.CONTENT_TYPE, "application/json") }
        val code = HttpStatusCode.valueOf(status)
        val bytes = body.toByteArray(Charsets.UTF_8)
        // 실제 RestClient의 기본 오류 처리처럼 예외 메시지에 응답 본문이 들어간다(원인을 그대로 로그에 찍으면 새는 것을 아래 로그 시험이 잡는다).
        val message = "$status error: \"$body\""
        val error = if (code.is4xxClientError) HttpClientErrorException.create(message, code, "error", headers, bytes, null) else HttpServerErrorException.create(message, code, "error", headers, bytes, null)
        `when`(ai.episode(anyMap())).thenThrow(aiFailure(error))

        runner.tick(now)
    }

    /** 예약은 해제하고 이 사유로 게시판을 닫으며 차감·발행은 없다. */
    private fun assertFailedWith(reason: String) {
        verify(credits).release(owner, key)
        verify(serial).fail("b1", reason, at)
        verify(credits, never()).settle(ArgumentMatchers.anyString(), ArgumentMatchers.anyString(), ArgumentMatchers.any(BigDecimal::class.java) ?: BigDecimal.ZERO)
        verify(serial, never()).publish(ArgumentMatchers.anyString(), ArgumentMatchers.anyString(), ArgumentMatchers.any(GeneratedEpisode::class.java) ?: generated, ArgumentMatchers.any(Instant::class.java) ?: at)
    }

    @Test fun `a scene the engine stopped or ran out of time for keeps the AI sentence as the reason`() {
        val cases = listOf(
            502 to "그림자이(가) 검사를 통과하지 못해 멈췄어요: 호칭·관계 오류. 직함 대신 이름으로 부르는 장면이 설정과 맞지 않아요.",
            504 to "인물 시뮬레이션이 제한 시간 안에 끝나지 않았습니다.",
        )
        for ((status, sentence) in cases) {
            runWithAiAnswer(status, """{"detail":"$sentence"}""")

            assertFailedWith(sentence)
        }
    }

    @Test fun `the AI sentence is tidied and capped at 300 characters before it becomes the reason`() {
        runWithAiAnswer(502, """{"detail":"  첫 줄\n둘째\t\t줄  ${"가".repeat(400)}"}""")

        assertFailedWith("첫 줄 둘째 줄 " + "가".repeat(291))
    }

    @Test fun `a 502 or 504 with no readable sentence says generation failed`() {
        val bodies = listOf("", "<html><body>502 Bad Gateway</body></html>", """{"detail":[{"type":"missing","loc":["body","world"],"msg":"Field required"}]}""", """{"detail":42}""")
        for (status in listOf(502, 504)) for (body in bodies) {
            runWithAiAnswer(status, body)

            assertFailedWith("AI 생성에 실패했습니다.")
        }
    }

    @Test fun `the other AI answers keep the reasons they had`() {
        val noCharacters = "연결된 세계관에 인물 카드가 없어 시뮬레이션을 실행할 수 없어요."
        val cases = listOf(
            Triple(409, """{"detail":"$noCharacters"}""", noCharacters),
            Triple(422, """{"detail":"검수를 통과하지 못했습니다.","code":"SERIAL_REVIEW_FAILED"}""", "검수를 통과하지 못했습니다."),
            Triple(402, """{"detail":"크레딧 상한을 넘었습니다.","code":"CREDIT_LIMIT_EXCEEDED"}""", "크레딧 상한을 넘었습니다."),
            // 그 밖의 상태는 detail이 문장이어도 일반 문구다.
            Triple(500, """{"detail":"Internal Server Error"}""", "AI 생성에 실패했습니다."),
        )
        for ((status, body, reason) in cases) {
            runWithAiAnswer(status, body)

            assertFailedWith(reason)
        }
    }

    @Test fun `the log never carries the rest of the AI answer`() {
        val logger = LoggerFactory.getLogger(SerialRunner::class.java) as Logger
        val logs = ListAppender<ILoggingEvent>().also { it.start(); logger.addAppender(it) }
        try {
            runWithAiAnswer(502, """{"detail":"장면이 끝나지 않았습니다.","trace":"BODY-ONLY-FIELD"}""")
        } finally {
            logger.detachAppender(logs)
        }

        val text = logs.list.joinToString("\n") { it.formattedMessage }
        assertTrue(text.contains("serial run b1 failed"), text)
        assertFalse(text.contains("BODY-ONLY-FIELD") || text.contains("\"detail\""), text)
        assertTrue(logs.list.all { it.throwableProxy == null })
    }

    @Test fun `a review failure or a credit limit overrun keeps its own reason even when an AI sentence came along`() {
        val cases = listOf(
            SerialAiFailure(reviewFailed = true, detail = "AI 문구") to "검수를 통과하지 못했습니다.",
            SerialAiFailure(limitExceeded = true, detail = "AI 문구") to "크레딧 상한을 넘었습니다.",
        )
        for ((failure, reason) in cases) {
            reset(serial, credits, ai)
            queue()
            `when`(ai.episode(anyMap())).thenThrow(failure)

            runner.tick(now)

            verify(credits).release(owner, key)
            verify(serial).fail("b1", reason, at)
        }
    }

    @Test fun `an AI failure releases and says generation failed`() {
        for (failure in listOf(SerialAiFailure(), IllegalStateException("boom"))) {
            reset(serial, credits, ai)
            queue()
            `when`(ai.episode(anyMap())).thenThrow(failure)

            runner.tick(now)

            verify(credits).release(owner, key)
            verify(serial).fail("b1", "AI 생성에 실패했습니다.", at)
        }
    }

    @Test fun `an AI answer that did not pass its own review is a review failure and is not published`() {
        queue()
        `when`(ai.episode(anyMap())).thenReturn(generated.copy(reviewPassed = false))

        runner.tick(now)

        verify(credits).release(owner, key)
        verify(serial).fail("b1", "검수를 통과하지 못했습니다.", at)
        verify(serial, never()).publish(ArgumentMatchers.anyString(), ArgumentMatchers.anyString(), ArgumentMatchers.any(GeneratedEpisode::class.java) ?: generated, ArgumentMatchers.any(Instant::class.java) ?: at)
        verify(credits, never()).settle(ArgumentMatchers.anyString(), ArgumentMatchers.anyString(), ArgumentMatchers.any(BigDecimal::class.java) ?: BigDecimal.ZERO)
    }

    @Test fun `a failed publication releases instead of settling and says publishing failed`() {
        queue()
        doThrow(ContentFailure(403, "권리 제한 중인 작품은 공개할 수 없어요.")).`when`(serial).publish("b1", owner, generated, at)

        runner.tick(now)

        verify(credits).release(owner, key)
        verify(credits, never()).settle(ArgumentMatchers.anyString(), ArgumentMatchers.anyString(), ArgumentMatchers.any(BigDecimal::class.java) ?: BigDecimal.ZERO)
        verify(serial).fail("b1", "발행에 실패했습니다.", at)
    }

    @Test fun `a draft the owner is writing fails the run with its own reason and releases the hold`() {
        queue()
        doThrow(ContentFailure(409, "작성 중인 원고가 있어 발행하지 않았습니다.", "SERIAL_DRAFT_EXISTS")).`when`(serial).publish("b1", owner, generated, at)

        runner.tick(now)

        verify(credits).release(owner, key)
        verify(credits, never()).settle(ArgumentMatchers.anyString(), ArgumentMatchers.anyString(), ArgumentMatchers.any(BigDecimal::class.java) ?: BigDecimal.ZERO)
        verify(serial).fail("b1", "작성 중인 원고가 있어 발행하지 않았습니다.", at)
    }

    @Test fun `a reserve that fails for another reason than a shortage releases the same key once`() {
        queue()
        // 시간 초과로 응답을 잃었어도 Core에는 예약이 남았을 수 있다: 같은 키로 해제를 한 번 부른다.
        doThrow(CoreAuthException(504, "CORE_CREDIT_TIMEOUT", "slow")).`when`(credits).reserve(owner, key, BigDecimal("150"))

        runner.tick(now)

        verify(credits, times(1)).release(owner, key)
        verify(serial).fail("b1", "AI 생성에 실패했습니다.", at)
        verifyNoInteractions(ai)
    }

    @Test fun `a release that finds no reservation is swallowed and the run still fails`() {
        queue()
        doThrow(CoreAuthException(503, "CORE_CREDIT_UNAVAILABLE", "down")).`when`(credits).reserve(owner, key, BigDecimal("150"))
        doThrow(CoreAuthException(502, "CORE_CREDIT_UPSTREAM_ERROR", "404 RESERVATION_NOT_FOUND")).`when`(credits).release(owner, key)

        runner.tick(now)

        verify(credits, times(1)).release(owner, key)
        verify(serial).fail("b1", "AI 생성에 실패했습니다.", at)
    }

    @Test fun `a failed settlement after publishing keeps the published episode and releases the hold`() {
        queue()
        doThrow(CoreAuthException(503, "CORE_CREDIT_UNAVAILABLE", "down")).`when`(credits).settle(owner, key, BigDecimal("1.2345"))

        runner.tick(now)

        verify(serial).publish("b1", owner, generated, at)
        verify(credits).release(owner, key)
        verify(serial, never()).fail(ArgumentMatchers.anyString(), ArgumentMatchers.anyString(), ArgumentMatchers.any(Instant::class.java) ?: at)
    }

    @Test fun `an owner Core no longer accepts fails before credit or AI`() {
        queue()
        `when`(auth.verifyScheduledMember(owner)).thenThrow(CoreAuthException(401, "UNAUTHORIZED", "restricted"))

        runner.tick(now)

        verify(serial).fail("b1", "발행에 실패했습니다.", at)
        verifyNoInteractions(credits, ai)
    }

    @Test fun `a context that cannot be built fails before any credit is reserved`() {
        queue()
        `when`(workWorlds.linkedWorldId("w", owner)).thenReturn(worldId)
        `when`(worldStudio.draft(worldId, UUID.fromString(owner), 3)).thenReturn(WorldDraftResponse(worldId, 3, null, null, "세계", "", listOf(heroCard), emptyList()))
        `when`(worldStudio.draft(worldId, UUID.fromString(owner))).thenThrow(IllegalStateException("neo4j down"))

        runner.tick(now)

        verify(serial).fail("b1", "AI 생성에 실패했습니다.", at)
        verifyNoInteractions(credits, ai)
    }

    @Test fun `a board whose input cannot be read is failed`() {
        queue()
        `when`(serial.runInput("b1")).thenThrow(ContentFailure(404, "작품을 찾을 수 없어요."))

        runner.tick(now)

        verify(serial).fail("b1", "AI 생성에 실패했습니다.", at)
        verifyNoInteractions(credits, ai)
    }

    @Test fun `one broken board does not stop the next one`() {
        queue()
        val second = SerialBoardEntity(id = "b2", workId = "w2", episodeNumber = 2, status = "queued", openedAt = at.minusSeconds(600))
        `when`(serial.queued()).thenReturn(listOf(board, second))
        `when`(serial.claim("b1", "queued", today, at)).thenThrow(IllegalStateException("db down"))
        `when`(serial.claim("b2", "queued", today, at)).thenReturn(false)

        runner.tick(now)

        verify(serial).claim("b2", "queued", today, at)
    }

    // ---- 주기 점검: 낡은 실행·게시판 맞춤

    @Test fun `a stale running board releases its hold and fails`() {
        queue()
        val stale = SerialBoardEntity(id = "old", workId = "w", episodeNumber = 4, status = "running", openedAt = at.minusSeconds(9000), closedAt = at.minusSeconds(4000))
        `when`(serial.queued()).thenReturn(emptyList())
        `when`(serial.staleRunning(at)).thenReturn(listOf(stale))
        `when`(serial.owner("w")).thenReturn(owner)

        runner.tick(now)

        verify(credits).release(owner, "serial-run:old")
        verify(serial).fail("old", "AI 생성에 실패했습니다.", at)
    }

    @Test fun `a stale board still fails when the release does not work`() {
        queue()
        val stale = SerialBoardEntity(id = "old", workId = "w", episodeNumber = 4, status = "running", openedAt = at.minusSeconds(9000), closedAt = at.minusSeconds(4000))
        `when`(serial.queued()).thenReturn(emptyList())
        `when`(serial.staleRunning(at)).thenReturn(listOf(stale))
        `when`(serial.owner("w")).thenReturn(owner)
        doThrow(CoreAuthException(503, "CORE_CREDIT_UNAVAILABLE", "down")).`when`(credits).release(owner, "serial-run:old")

        runner.tick(now)

        verify(serial).fail("old", "AI 생성에 실패했습니다.", at)
    }

    @Test fun `every enabled work is reconciled and one failure does not stop the others`() {
        queue()
        `when`(serial.queued()).thenReturn(emptyList())
        `when`(serial.enabledWorkIds()).thenReturn(listOf("a", "b"))
        doThrow(IllegalStateException("boom")).`when`(serial).reconcile("a")

        runner.tick(now)

        verify(serial).reconcile("a")
        verify(serial).reconcile("b")
    }

    // ---- 선택지 생성

    private val choiceKey = "serial-choice:b1:" + at.toEpochMilli()
    private val choiceInput = ChoiceInput("w", "b1", owner, "작품", "소개", 4, "따뜻하게")
    private val choiceBoard = SerialBoardEntity(id = "b1", workId = "w", episodeNumber = 4, status = "open", openedAt = at.minusSeconds(600))
    private val choiceRequests = mutableListOf<Map<*, *>>()
    private val generatedChoices = GeneratedChoices(listOf("가", "나", "다", "라"), BigDecimal("0.25"))

    private fun choosing() {
        `when`(serial.queued()).thenReturn(emptyList())
        `when`(serial.due(now)).thenReturn(emptyList())
        `when`(serial.staleRunning(at)).thenReturn(emptyList())
        `when`(serial.enabledWorkIds()).thenReturn(emptyList())
        `when`(serial.choiceTargets(at)).thenReturn(listOf(choiceBoard))
        `when`(serial.beginChoices("w", "b1", at)).thenReturn(choiceInput)
        `when`(works.publicEpisodes("w")).thenReturn(published(1, 2, 3))
        `when`(workWorlds.readerCards("w", null)).thenReturn(ReaderWorldCardsResponse("w", worldId, 3, listOf(ReaderWorldCardResponse(UUID.randomUUID(), "공개 카드", "공개 본문", "location", listOf("별칭"), emptyList(), 1))))
        `when`(credits.reserve(owner, choiceKey, BigDecimal("3"))).thenReturn("res-choice")
        `when`(ai.choices(anyMap())).thenAnswer { call -> choiceRequests.add(call.arguments[0] as Map<*, *>); generatedChoices }
    }

    private fun neverSaved() = verify(serial, never()).saveChoices(ArgumentMatchers.anyString(), ArgumentMatchers.anyString(), ArgumentMatchers.anyList<String>())
    private fun neverSettled() = verify(credits, never()).settle(ArgumentMatchers.anyString(), ArgumentMatchers.anyString(), ArgumentMatchers.any(BigDecimal::class.java) ?: BigDecimal.ZERO)

    @Test fun `an open board without choices gets four generated saved and then settled`() {
        choosing()

        runner.tick(now)

        val order = inOrder(serial, credits, ai)
        order.verify(serial).beginChoices("w", "b1", at)
        order.verify(credits).reserve(owner, choiceKey, BigDecimal("3"))
        order.verify(ai).choices(anyMap())
        order.verify(serial).saveChoices("w", "b1", listOf("가", "나", "다", "라"))
        // 정산은 저장이 끝난 뒤다: 저장하지 못하면 차감 없이 해제한다.
        order.verify(credits).settle(owner, choiceKey, BigDecimal("0.25"))
        verify(credits, never()).release(ArgumentMatchers.anyString(), ArgumentMatchers.anyString())
        verify(serial, never()).fail(ArgumentMatchers.anyString(), ArgumentMatchers.anyString(), ArgumentMatchers.any(Instant::class.java) ?: at)
    }

    @Test fun `the choices request carries the direction the choice limit the reservation and a public-only context`() {
        choosing()

        runner.tick(now)

        val body = choiceRequests.single()
        assertEquals(setOf("workId", "episodeNumber", "direction", "context", "creditLimit", "creditReservationId"), body.keys)
        assertEquals(listOf("w", 4, "따뜻하게"), listOf(body["workId"], body["episodeNumber"], body["direction"]))
        // 선택지 상한은 시뮬레이션·회차 실행 상한과 따로다.
        assertEquals(BigDecimal("3"), body["creditLimit"])
        assertEquals("res-choice", body["creditReservationId"])
        val context = mapper.readTree(body["context"] as String)
        assertEquals("작품", context.path("title").asString())
        assertEquals(listOf(1, 2, 3), context.path("episodes").values().map { it.path("number").asInt() })
        assertEquals(listOf("공개 카드"), context.path("cards").values().map { it.path("title").asString() })
        // 선택지는 독자에게 먼저 공개되므로 독자 열람과 같은 읽기만 한다: 소유자용 회차 읽기·비공개 세계관 초안은 쓰지 않는다.
        verifyNoInteractions(worldStudio, publication)
        verify(workWorlds, never()).linkedWorldId(ArgumentMatchers.anyString(), ArgumentMatchers.anyString())
    }

    @Test fun `a board that no longer needs choices is left alone`() {
        choosing()
        `when`(serial.beginChoices("w", "b1", at)).thenReturn(null)

        runner.tick(now)

        verifyNoInteractions(credits, ai)
        neverSaved()
    }

    @Test fun `not enough credit for choices tries again later without calling the AI or releasing`() {
        choosing()
        doThrow(ContentFailure(409, "크레딧이 부족합니다.", "INSUFFICIENT_CREDIT")).`when`(credits).reserve(owner, choiceKey, BigDecimal("3"))

        runner.tick(now)

        verifyNoInteractions(ai)
        verify(credits, never()).release(ArgumentMatchers.anyString(), ArgumentMatchers.anyString())
        neverSaved()
        // 선택지 실패는 게시판을 닫지 않는다: 회차 실행 실패가 아니다.
        verify(serial, never()).fail(ArgumentMatchers.anyString(), ArgumentMatchers.anyString(), ArgumentMatchers.any(Instant::class.java) ?: at)
    }

    @Test fun `an AI failure or an unreadable answer releases the hold and saves nothing`() {
        for (failure in listOf(SerialAiFailure(), SerialAiFailure(limitExceeded = true), IllegalStateException("boom"))) {
            reset(serial, credits, ai)
            choosing()
            `when`(ai.choices(anyMap())).thenThrow(failure)

            runner.tick(now)

            verify(credits).release(owner, choiceKey)
            neverSaved()
            neverSettled()
        }
    }

    @Test fun `a failed save after generation releases the hold instead of settling`() {
        choosing()
        doThrow(ContentFailure(409, "선택지를 붙일 열린 게시판이 없어요.", "SERIAL_NO_BOARD")).`when`(serial).saveChoices("w", "b1", listOf("가", "나", "다", "라"))

        runner.tick(now)

        verify(credits).release(owner, choiceKey)
        neverSettled()
    }

    @Test fun `a failed settlement keeps the saved choices and releases the hold`() {
        choosing()
        doThrow(CoreAuthException(504, "CORE_CREDIT_TIMEOUT", "slow")).`when`(credits).settle(owner, choiceKey, BigDecimal("0.25"))

        runner.tick(now)

        verify(serial).saveChoices("w", "b1", listOf("가", "나", "다", "라"))
        verify(credits, times(1)).release(owner, choiceKey)
    }

    @Test fun `a choices reserve that fails for another reason than a shortage releases the same key once`() {
        choosing()
        // 시간 초과로 응답을 잃었어도 Core에는 예약이 남았을 수 있다: 같은 키로 해제를 한 번 부른다.
        doThrow(CoreAuthException(504, "CORE_CREDIT_TIMEOUT", "slow")).`when`(credits).reserve(owner, choiceKey, BigDecimal("3"))

        runner.tick(now)

        verify(credits, times(1)).release(owner, choiceKey)
        verifyNoInteractions(ai)
        neverSaved()
    }

    @Test fun `a context that cannot be built makes no reservation`() {
        choosing()
        `when`(works.publicEpisodes("w")).thenThrow(ContentFailure(404, "공개 작품을 찾을 수 없어요."))

        runner.tick(now)

        verifyNoInteractions(credits, ai)
        neverSaved()
    }

    @Test fun `one broken choice target does not stop the next one`() {
        choosing()
        val second = SerialBoardEntity(id = "b2", workId = "w2", episodeNumber = 2, status = "open", openedAt = at.minusSeconds(600))
        `when`(serial.choiceTargets(at)).thenReturn(listOf(choiceBoard, second))
        `when`(serial.beginChoices("w", "b1", at)).thenThrow(IllegalStateException("db down"))
        `when`(serial.beginChoices("w2", "b2", at)).thenReturn(null)

        runner.tick(now)

        verify(serial).beginChoices("w2", "b2", at)
    }

    @Test fun `a failure while listing choice targets does not stop the tick`() {
        choosing()
        `when`(serial.choiceTargets(at)).thenThrow(IllegalStateException("db down"))

        assertDoesNotThrow { runner.tick(now) }
    }

    @Test fun `choices are made after the runs so a board that is closing is never filled`() {
        queue()
        `when`(serial.choiceTargets(at)).thenReturn(listOf(choiceBoard))
        `when`(serial.beginChoices("w", "b1", at)).thenReturn(null)

        runner.tick(now)

        val order = inOrder(serial)
        order.verify(serial).claim("b1", "queued", today, at)
        order.verify(serial).publish("b1", owner, generated, at)
        order.verify(serial).beginChoices("w", "b1", at)
        // 점검 한 번에 선택지 단계는 한 번뿐이다(실행 앞에서 미리 만들지 않는다).
        verify(serial, times(1)).choiceTargets(at)
        verify(serial, times(1)).beginChoices("w", "b1", at)
    }

    // ---- 회차 요약 생성

    private val summaryTarget = SummaryTarget("w", owner, "e-1", "ver-1", 1, "제 1화", "본문 1")
    private val summaryKey get() = "serial-summary:e-1:" + at.toEpochMilli()
    private val summaryRequests = mutableListOf<Map<*, *>>()
    private val madeSummary = GeneratedSummary("두 사람이 재회했다.", BigDecimal("2.5"))

    private fun summarizing(targets: List<SummaryTarget> = listOf(summaryTarget)) {
        `when`(serial.queued()).thenReturn(emptyList())
        `when`(serial.due(now)).thenReturn(emptyList())
        `when`(serial.staleRunning(at)).thenReturn(emptyList())
        `when`(serial.enabledWorkIds()).thenReturn(emptyList())
        `when`(summaries.targets(3)).thenReturn(targets)
        targets.forEach { target -> `when`(credits.reserve(owner, "serial-summary:" + target.episodeId + ":" + at.toEpochMilli(), BigDecimal("4"))).thenReturn("res-" + target.episodeId) }
        `when`(ai.summarize(anyMap())).thenAnswer { call -> summaryRequests.add(call.arguments[0] as Map<*, *>); madeSummary }
    }

    private fun neverSummarySaved() = verify(summaries, never()).save(ArgumentMatchers.anyString(), ArgumentMatchers.anyString(), ArgumentMatchers.anyString())

    @Test fun `a missing summary is generated saved and then settled with the summary limit`() {
        summarizing()

        runner.tick(now)

        val order = inOrder(summaries, credits, ai)
        order.verify(summaries).targets(3)
        order.verify(credits).reserve(owner, summaryKey, BigDecimal("4"))
        order.verify(ai).summarize(anyMap())
        order.verify(summaries).save("e-1", "ver-1", "두 사람이 재회했다.")
        // 정산은 저장이 끝난 뒤다: 저장하지 못하면 차감 없이 해제한다.
        order.verify(credits).settle(owner, summaryKey, BigDecimal("2.5"))
        verify(credits, never()).release(ArgumentMatchers.anyString(), ArgumentMatchers.anyString())
        verify(serial, never()).fail(ArgumentMatchers.anyString(), ArgumentMatchers.anyString(), ArgumentMatchers.any(Instant::class.java) ?: at)
    }

    @Test fun `the summary request carries the title body limit and reservation`() {
        summarizing()

        runner.tick(now)

        val body = summaryRequests.single()
        assertEquals(setOf("workId", "episodeNumber", "title", "body", "creditLimit", "creditReservationId"), body.keys)
        assertEquals(listOf("w", 1, "제 1화", "본문 1"), listOf(body["workId"], body["episodeNumber"], body["title"], body["body"]))
        // 요약 상한은 시뮬레이션·선택지·회차 실행 상한과 따로다.
        assertEquals(BigDecimal("4"), body["creditLimit"])
        assertEquals("res-e-1", body["creditReservationId"])
    }

    @Test fun `not enough credit for a summary tries again next tick without calling the AI or releasing`() {
        summarizing()
        doThrow(ContentFailure(409, "크레딧이 부족합니다.", "INSUFFICIENT_CREDIT")).`when`(credits).reserve(owner, summaryKey, BigDecimal("4"))

        runner.tick(now)

        verifyNoInteractions(ai)
        verify(credits, never()).release(ArgumentMatchers.anyString(), ArgumentMatchers.anyString())
        neverSummarySaved()
        // 요약 실패는 게시판과 무관하다: 실행 실패로 남기지 않는다.
        verify(serial, never()).fail(ArgumentMatchers.anyString(), ArgumentMatchers.anyString(), ArgumentMatchers.any(Instant::class.java) ?: at)
    }

    @Test fun `an AI failure or an unreadable answer releases the hold and saves no summary`() {
        for (failure in listOf(SerialAiFailure(), SerialAiFailure(limitExceeded = true), IllegalStateException("boom"))) {
            reset(serial, summaries, credits, ai)
            summarizing()
            `when`(ai.summarize(anyMap())).thenThrow(failure)

            runner.tick(now)

            verify(credits).release(owner, summaryKey)
            neverSummarySaved()
            neverSettled()
        }
    }

    @Test fun `a failed summary save after generation releases the hold instead of settling`() {
        summarizing()
        doThrow(IllegalStateException("db down")).`when`(summaries).save("e-1", "ver-1", "두 사람이 재회했다.")

        runner.tick(now)

        verify(credits).release(owner, summaryKey)
        neverSettled()
    }

    @Test fun `a failed settlement keeps the saved summary and releases the hold`() {
        summarizing()
        doThrow(CoreAuthException(504, "CORE_CREDIT_TIMEOUT", "slow")).`when`(credits).settle(owner, summaryKey, BigDecimal("2.5"))

        runner.tick(now)

        verify(summaries).save("e-1", "ver-1", "두 사람이 재회했다.")
        verify(credits, times(1)).release(owner, summaryKey)
    }

    @Test fun `a summary reserve that fails for another reason than a shortage releases the same key once`() {
        summarizing()
        doThrow(CoreAuthException(504, "CORE_CREDIT_TIMEOUT", "slow")).`when`(credits).reserve(owner, summaryKey, BigDecimal("4"))

        runner.tick(now)

        verify(credits, times(1)).release(owner, summaryKey)
        verifyNoInteractions(ai)
        neverSummarySaved()
    }

    @Test fun `one broken summary does not stop the next one`() {
        val second = summaryTarget.copy(episodeId = "e-2", versionId = "ver-2", number = 2, title = "제 2화", body = "본문 2")
        summarizing(listOf(summaryTarget, second))
        var calls = 0
        `when`(ai.summarize(anyMap())).thenAnswer { calls++; if (calls == 1) throw SerialAiFailure() else madeSummary }

        runner.tick(now)

        verify(credits).release(owner, summaryKey)
        verify(summaries).save("e-2", "ver-2", "두 사람이 재회했다.")
        verify(credits).settle(owner, "serial-summary:e-2:" + at.toEpochMilli(), BigDecimal("2.5"))
    }

    @Test fun `a failure while listing the summary targets does not stop the tick`() {
        summarizing()
        `when`(summaries.targets(3)).thenThrow(IllegalStateException("db down"))

        assertDoesNotThrow { runner.tick(now) }
        verifyNoInteractions(ai)
    }

    @Test fun `summaries are made last after the runs and the choices`() {
        queue()
        `when`(serial.choiceTargets(at)).thenReturn(listOf(choiceBoard))
        `when`(serial.beginChoices("w", "b1", at)).thenReturn(null)

        runner.tick(now)

        val order = inOrder(serial, summaries)
        order.verify(serial).claim("b1", "queued", today, at)
        order.verify(serial).publish("b1", owner, generated, at)
        order.verify(serial).beginChoices("w", "b1", at)
        order.verify(summaries).targets(3)
        // 점검 한 번에 요약 단계는 한 번이고 한 번에 3개까지만 청한다.
        verify(summaries, times(1)).targets(3)
    }

    // ---- 문맥의 이전 회차 요약

    private fun summaryNumbers(context: String) = mapper.readTree(context).path("summaries").values().map { it.path("number").asInt() }

    @Test fun `the owner context carries the stored summaries of the episodes before the recent three`() {
        queue()
        `when`(publication.publishedEpisodes("w")).thenReturn(PublishedEpisodeListResponse(published(1, 2, 3, 4, 5, 6)))
        `when`(summaries.stored("w")).thenReturn(mapOf(1 to "첫 요약", 2 to "둘째 요약", 4 to "넷째 요약"))

        runner.tick(now)

        val tree = mapper.readTree(episodeRequests.single()["context"] as String)
        // 최근 3화(4·5·6)는 원문이 있으니 요약을 싣지 않고, 요약이 아직 없는 3화는 빠진다.
        assertEquals(listOf(4, 5, 6), tree.path("episodes").values().map { it.path("number").asInt() })
        assertEquals(listOf(1, 2), tree.path("summaries").values().map { it.path("number").asInt() })
        assertEquals(listOf("제 1화", "첫 요약"), listOf(tree.path("summaries")[0].path("title").asString(), tree.path("summaries")[0].path("summary").asString()))
    }

    @Test fun `stored summaries that cannot be read fail the run before any credit is reserved`() {
        queue()
        `when`(summaries.stored("w")).thenThrow(IllegalStateException("db down"))

        runner.tick(now)

        verify(serial).fail("b1", "AI 생성에 실패했습니다.", at)
        verifyNoInteractions(credits, ai)
    }

    @Test fun `the choices context carries the summaries too`() {
        choosing()
        `when`(works.publicEpisodes("w")).thenReturn(published(1, 2, 3, 4, 5))
        `when`(summaries.stored("w")).thenReturn(mapOf(1 to "첫 요약", 2 to "둘째 요약", 3 to "셋째 요약"))

        runner.tick(now)

        // 최근 3화(3·4·5)는 원문이라 1·2화의 요약만이다. 선택지에는 관련 장면 검색이 없어 related 키도 없다.
        val context = choiceRequests.single()["context"] as String
        assertEquals(listOf(1, 2), summaryNumbers(context))
        assertFalse(mapper.readTree(context).has("related"))
        verifyNoInteractions(qa)
    }

    @Test fun `the simulation context carries the summaries too`() {
        simulationStubs()
        `when`(works.publicEpisodes("w")).thenReturn(published(1, 2, 3, 4, 5))
        `when`(summaries.stored("w")).thenReturn(mapOf(1 to "첫 요약", 2 to "둘째 요약"))

        runner.submit("w", member, simulation())

        val context = simulationRequests.single()["context"] as String
        assertEquals(listOf(1, 2), summaryNumbers(context))
        assertFalse(mapper.readTree(context).has("related"))
    }

    @Test fun `a summary of an episode whose reader body is hidden is left out of a reader context`() {
        choosing()
        // 원작이 삭제된 Fork의 상속 회차는 독자에게 본문이 가려진다: 그 요약도 싣지 않는다.
        `when`(works.publicEpisodes("w")).thenReturn(published(1, 2, 3, 4, 5).map { if (it.number == 1) it.copy(body = "") else it })
        `when`(summaries.stored("w")).thenReturn(mapOf(1 to "가려진 회차의 요약", 2 to "공개 회차의 요약"))

        runner.tick(now)

        assertEquals(listOf(2), summaryNumbers(choiceRequests.single()["context"] as String))
    }

    // ---- 관련 장면 검색

    private fun source(episode: Int, quote: String) = QaSource("s" + episode, "w", null, "e" + episode, episode, "v" + episode, 0, quote.length, quote)
    private val relatedQuery = "선택지 둘\n제목 a\n제목 b"

    private fun searching() {
        queue()
        `when`(publication.publishedEpisodes("w")).thenReturn(PublishedEpisodeListResponse(published(1, 2, 3, 4, 5, 6)))
    }

    @Test fun `a run searches the manuscript once before reserving credit and puts the quotes in the context`() {
        searching()
        `when`(qa.searchRelated("w", relatedQuery, QaEpisodeRef(3, "v3"), 6)).thenReturn(listOf(source(2, "옛 장면 하나"), source(1, "옛 장면 둘")))

        runner.tick(now)

        // 질의는 1위 선택지 글과 추천 상위 제안 글의 제목이고, 기준은 최근 3화 이전의 마지막 회차(3화)다. 검색은 크레딧 예약 앞이다.
        val order = inOrder(qa, credits, ai)
        order.verify(qa).searchRelated("w", relatedQuery, QaEpisodeRef(3, "v3"), 6)
        order.verify(credits).reserve(owner, key, BigDecimal("150"))
        order.verify(ai).episode(anyMap())
        verify(qa, times(1)).searchRelated("w", relatedQuery, QaEpisodeRef(3, "v3"), 6)
        val related = mapper.readTree(episodeRequests.single()["context"] as String).path("related")
        assertEquals(listOf(2 to "옛 장면 하나", 1 to "옛 장면 둘"), related.values().map { it.path("episode").asInt() to it.path("quote").asString() })
    }

    @Test fun `with no episode older than the recent three there is nothing to search and related is empty`() {
        queue() // 발행 회차 1~3화뿐이다.

        runner.tick(now)

        verifyNoInteractions(qa)
        val related = mapper.readTree(episodeRequests.single()["context"] as String).path("related")
        assertTrue(related.isArray)
        assertEquals(0, related.size())
    }

    @Test fun `without a choice or proposal titles there is no query so no search`() {
        searching()
        `when`(serial.runInput("b1")).thenReturn(input.copy(choice = null, proposals = emptyList()))

        runner.tick(now)

        verifyNoInteractions(qa)
        assertEquals(0, mapper.readTree(episodeRequests.single()["context"] as String).path("related").size())
    }

    @Test fun `a search that finds nothing is not a failure and the run goes on`() {
        searching() // qa 대역은 기본으로 빈 목록을 돌려준다.

        runner.tick(now)

        verify(qa).searchRelated("w", relatedQuery, QaEpisodeRef(3, "v3"), 6)
        verify(serial).publish("b1", owner, generated, at)
        verify(serial, never()).fail(ArgumentMatchers.anyString(), ArgumentMatchers.anyString(), ArgumentMatchers.any(Instant::class.java) ?: at)
        assertEquals(0, mapper.readTree(episodeRequests.single()["context"] as String).path("related").size())
    }

    @Test fun `a failed search ends the run with its own reason before any credit is reserved`() {
        searching()
        `when`(qa.searchRelated("w", relatedQuery, QaEpisodeRef(3, "v3"), 6)).thenThrow(ContentFailure(503, "원고 검색을 완료할 수 없어요."))

        runner.tick(now)

        // 검색을 빼고 진행하지 않는다. 예약 앞이라 해제할 것도 없다.
        verify(serial).fail("b1", "관련 장면 검색에 실패했습니다.", at)
        verifyNoInteractions(credits, ai)
        verify(serial, never()).publish(ArgumentMatchers.anyString(), ArgumentMatchers.anyString(), ArgumentMatchers.any(GeneratedEpisode::class.java) ?: generated, ArgumentMatchers.any(Instant::class.java) ?: at)
    }

    // ---- 인물 시뮬레이션 입력: 세계관

    @Test fun `a linked world is read at the previous episode and sent with the identity relations of the latest time`() {
        queue()
        `when`(workWorlds.linkedWorldId("w", owner)).thenReturn(worldId)
        val friend = relation("emotional", heroId, shadowId, "친구")
        val sameInTheEnd = relation("identity", shadowId, heroId)
        val atTheTime = WorldDraftResponse(worldId, 3, null, null, "세계", "설명", listOf(heroCard, shadowCard, removedCard), listOf(friend), relationshipEpisodes = mapOf(friend.id to 2))
        `when`(worldStudio.draft(worldId, subject, 3)).thenReturn(atTheTime)
        `when`(worldStudio.draft(worldId, subject)).thenReturn(atTheTime.copy(relationships = listOf(friend, sameInTheEnd)))

        runner.tick(now)

        val world = episodeRequests.single()["world"] as JsonNode
        // MCP world_studio_read(id, episode)의 서비스 읽기와 같은 모양이다: 직전 회차(대상 4화의 3화) 시점의 카드·관계.
        assertEquals(listOf(worldId.toString(), "세계", "설명"), listOf(world.path("worldId").asString(), world.path("name").asString(), world.path("description").asString()))
        assertEquals(listOf("주인공", "그림자", "지운 카드"), world.path("cards").values().map { it.path("title").asString() })
        assertEquals(listOf("character", "active", "영웅"), world.path("cards")[0].let { listOf(it.path("cardType").asString(), it.path("lifecycle").asString(), it.path("aliases")[0].asString()) })
        assertEquals(listOf(friend.id.toString()), world.path("relationships").values().map { it.path("id").asString() })
        assertEquals(2, world.path("relationshipEpisodes").path(friend.id.toString()).asInt())
        // 「동일 인물」 관계만 최신 시점으로 따로 읽어 identity에 덧붙인다(기준 회차 시점으로는 아직 묶이지 않은 두 카드의 관계다).
        val identity = world.path("identity")
        assertEquals(listOf(sameInTheEnd.id.toString()), identity.values().map { it.path("id").asString() })
        assertEquals(listOf("identity", shadowId.toString(), heroId.toString()), identity[0].let { listOf(it.path("category").asString(), it.path("sourceCardId").asString(), it.path("targetCardId").asString()) })
        verify(worldStudio).draft(worldId, subject, 3)
        // 연결 세계관이 있으면 그것이 우선이다: 이어받는 원작 세계관은 읽지 않는다.
        verify(workWorlds, never()).inheritedWorld(ArgumentMatchers.anyString(), ArgumentMatchers.anyString(), ArgumentMatchers.anyString())
    }

    @Test fun `a work without its own world sends the original world it inherits with the identity relations of that answer`() {
        queue()
        val friend = relation("emotional", heroId, shadowId, "친구")
        val same = relation("identity", shadowId, heroId)
        inheritsWorld(friend, same)

        runner.tick(now)

        val world = episodeRequests.single()["world"] as JsonNode
        // MCP work_inherited_world와 같은 모양(Fork 기준 회차까지, 상한은 직전 회차)이고 identity는 그 응답의 「동일 인물」 관계다.
        assertEquals(listOf("w", worldId.toString(), 3), listOf(world.path("workId").asString(), world.path("worldId").asString(), world.path("upto").asInt()))
        assertEquals(listOf("주인공", "그림자", "지운 카드"), world.path("cards").values().map { it.path("title").asString() })
        assertEquals(listOf(friend.id.toString(), same.id.toString()), world.path("relationships").values().map { it.path("id").asString() })
        assertEquals(listOf(same.id.toString()), world.path("identity").values().map { it.path("id").asString() })
        verify(workWorlds).inheritedWorld("w", owner, "3")
        // 연결된 세계관이 없으니 소유자의 세계관 작업실은 읽지 않는다.
        verifyNoInteractions(worldStudio)
    }

    @Test fun `a world re-linked while the run is being prepared cannot mix two worlds in one request`() {
        queue()
        val other = UUID.randomUUID()
        // 연결을 두 번 읽는다면 두 번째는 다른 세계관이다: 한 번만 읽어 요청의 world와 문맥의 카드가 같은 세계관에서 나와야 한다.
        `when`(workWorlds.linkedWorldId("w", owner)).thenReturn(worldId, other)
        val mine = WorldDraftResponse(worldId, 3, null, null, "세계", "", listOf(heroCard), emptyList())
        `when`(worldStudio.draft(worldId, subject, 3)).thenReturn(mine)
        `when`(worldStudio.draft(worldId, subject)).thenReturn(mine)
        `when`(worldStudio.draft(other, subject, 3)).thenReturn(mine.copy(worldId = other, cards = listOf(shadowCard)))
        `when`(worldStudio.draft(other, subject)).thenReturn(mine.copy(worldId = other, cards = listOf(shadowCard)))

        runner.tick(now)

        val body = episodeRequests.single()
        assertEquals(worldId.toString(), (body["world"] as JsonNode).path("worldId").asString())
        assertEquals(listOf("주인공"), mapper.readTree(body["context"] as String).path("cards").values().map { it.path("title").asString() })
        verify(workWorlds, times(1)).linkedWorldId("w", owner)
        // 최신 시점 읽기(문맥의 카드와 identity)도 한 번이다: 기준 회차 읽기 하나와 합쳐 세계관을 두 번만 읽는다.
        verify(worldStudio, times(1)).draft(worldId, subject)
        verify(worldStudio, times(1)).draft(worldId, subject, 3)
    }

    @Test fun `the world is read at the episode right before the target episode`() {
        queue()
        `when`(serial.runInput("b1")).thenReturn(input.copy(number = 7))
        `when`(workWorlds.inheritedWorld("w", owner, "6")).thenReturn(InheritedWorldResponse("w", worldId, 6, listOf(heroCard)))

        runner.tick(now)

        verify(workWorlds).inheritedWorld("w", owner, "6")
        assertEquals(6, (episodeRequests.single()["world"] as JsonNode).path("upto").asInt())
    }

    @Test fun `the world is read before the related search and the credit reservation`() {
        searching()

        runner.tick(now)

        val order = inOrder(workWorlds, qa, credits, ai)
        order.verify(workWorlds).inheritedWorld("w", owner, "3")
        order.verify(qa).searchRelated("w", relatedQuery, QaEpisodeRef(3, "v3"), 6)
        order.verify(credits).reserve(owner, key, BigDecimal("150"))
        order.verify(ai).episode(anyMap())
    }

    @Test fun `with no linked and no inherited world the run fails before the search the credit and the AI`() {
        searching()
        `when`(workWorlds.inheritedWorld("w", owner, "3")).thenReturn(InheritedWorldResponse("w", null, 0))

        runner.tick(now)

        // 인물 시뮬레이션을 건너뛰는 길은 없다: AI를 부르지 않고 고정 사유로 끝낸다. 예약 앞이라 해제할 것도 없다.
        verify(serial).fail("b1", "연결된 세계관이 없어 시뮬레이션으로 집필할 수 없습니다.", at)
        verifyNoInteractions(qa, credits, ai)
        verify(serial, never()).publish(ArgumentMatchers.anyString(), ArgumentMatchers.anyString(), ArgumentMatchers.any(GeneratedEpisode::class.java) ?: generated, ArgumentMatchers.any(Instant::class.java) ?: at)
    }

    @Test fun `a linked world that cannot be read fails the run without a fallback before any credit is reserved`() {
        searching()
        `when`(workWorlds.linkedWorldId("w", owner)).thenReturn(worldId)
        `when`(worldStudio.draft(worldId, subject, 3)).thenThrow(ContentFailure(503, "관계 저장을 확인할 수 없어요."))

        runner.tick(now)

        // 읽지 못한 연결 세계관을 이어받는 세계관·빈 세계관으로 대신하지 않는다.
        verify(serial).fail("b1", "AI 생성에 실패했습니다.", at)
        verifyNoInteractions(qa, credits, ai)
        verify(workWorlds, never()).inheritedWorld(ArgumentMatchers.anyString(), ArgumentMatchers.anyString(), ArgumentMatchers.anyString())
    }

    @Test fun `an inherited world whose relations cannot be read fails the run instead of running without relations`() {
        searching()
        `when`(workWorlds.inheritedWorld("w", owner, "3")).thenReturn(InheritedWorldResponse("w", worldId, 3, listOf(heroCard), relationshipStatus = "unavailable"))

        runner.tick(now)

        verify(serial).fail("b1", "AI 생성에 실패했습니다.", at)
        verifyNoInteractions(qa, credits, ai)
    }

    // ---- 제안 글 제출: 일반

    private fun general() = SerialProposalRequest("general", "다음 전개", "다음에는 만나면 좋겠어요")
    private fun simulation() = SerialProposalRequest("simulation", "폐교 장면", "", SerialSimulationRequest("두 사람이 폐교에서 마주친다", listOf("문이 열린다", "그림자가 움직인다")))

    @Test fun `a general proposal is saved directly without credit or AI`() {
        `when`(serial.add("w", member, cleanProposal(general()))).thenReturn(SerialProposalCreated("p1"))

        assertEquals(SerialProposalCreated("p1"), runner.submit("w", member, general()))

        verifyNoInteractions(credits, ai)
    }

    @Test fun `bad input is refused before anything is read`() {
        assertEquals(422, status { runner.submit("w", member, SerialProposalRequest("general", "제목", " ")) }.status)
        assertEquals(422, status { runner.submit("w", member, SerialProposalRequest("general", " ", "본문")) }.status)
        assertEquals(422, status { runner.submit("w", member, SerialProposalRequest("setting", "제목", "x")) }.status)

        verifyNoInteractions(serial, credits, ai)
    }

    // ---- 제안 글 제출: 시뮬레이션

    private fun openBoard() = OpenBoard("b1", 4, "작품", "소개")
    private fun simulationStubs() {
        `when`(serial.openBoardFor("w")).thenReturn(openBoard())
        `when`(works.publicEpisodes("w")).thenReturn(published(1, 2))
        `when`(workWorlds.readerCards("w", null)).thenReturn(ReaderWorldCardsResponse("w", worldId, 2, listOf(ReaderWorldCardResponse(UUID.randomUUID(), "공개 카드", "공개 본문", "location", listOf("별칭"), emptyList(), 1))))
        `when`(credits.reserve(ArgumentMatchers.eq(member) ?: member, ArgumentMatchers.startsWith("serial-sim:") ?: "", ArgumentMatchers.eq(BigDecimal("5")) ?: BigDecimal.ONE)).thenReturn("res-sim")
        `when`(ai.simulate(anyMap())).thenAnswer { call -> simulationRequests.add(call.arguments[0] as Map<*, *>); SerialScene("장면 미리보기", BigDecimal("0.4321")) }
        `when`(serial.add(ArgumentMatchers.anyString(), ArgumentMatchers.anyString(), ArgumentMatchers.any(CleanProposal::class.java) ?: cleanProposal(simulation()), ArgumentMatchers.anyString(), ArgumentMatchers.anyString()))
            .thenReturn(SerialProposalCreated("p9"))
    }
    private fun neverAdded() = verify(serial, never()).add(ArgumentMatchers.anyString(), ArgumentMatchers.anyString(), ArgumentMatchers.any(CleanProposal::class.java) ?: cleanProposal(simulation()), ArgumentMatchers.anyString(), ArgumentMatchers.anyString())

    @Test fun `a simulation reserves the limit generates the scene saves the proposal and then settles the real amount`() {
        simulationStubs()

        val created = runner.submit("w", member, simulation())

        assertEquals(SerialProposalCreated("p9"), created)
        val order = inOrder(serial, credits, ai)
        order.verify(serial).openBoardFor("w")
        order.verify(credits).reserve(ArgumentMatchers.eq(member) ?: member, ArgumentMatchers.startsWith("serial-sim:") ?: "", ArgumentMatchers.eq(BigDecimal("5")) ?: BigDecimal.ONE)
        order.verify(ai).simulate(anyMap())
        order.verify(serial).add("w", member, cleanProposal(simulation()), "장면 미리보기", "b1")
        order.verify(credits).settle(ArgumentMatchers.eq(member) ?: member, ArgumentMatchers.startsWith("serial-sim:") ?: "", ArgumentMatchers.eq(BigDecimal("0.4321")) ?: BigDecimal.ONE)
        verify(credits, never()).release(ArgumentMatchers.anyString(), ArgumentMatchers.anyString())
    }

    @Test fun `the simulation request has the premise beats limit and a public-only context`() {
        simulationStubs()

        runner.submit("w", member, simulation())

        val body = simulationRequests.single()
        assertEquals(setOf("workId", "episodeNumber", "premise", "beats", "context", "creditLimit", "creditReservationId"), body.keys)
        assertEquals(listOf("w", 4, "두 사람이 폐교에서 마주친다", listOf("문이 열린다", "그림자가 움직인다")), listOf(body["workId"], body["episodeNumber"], body["premise"], body["beats"]))
        assertEquals(BigDecimal("5"), body["creditLimit"])
        assertEquals("res-sim", body["creditReservationId"])
        val context = mapper.readTree(body["context"] as String)
        assertEquals(listOf(1, 2), context.path("episodes").values().map { it.path("number").asInt() })
        assertEquals(listOf("공개 카드"), context.path("cards").values().map { it.path("title").asString() })
        // 독자에게 공개된 값만 쓴다: 소유자의 세계관 초안은 읽지 않는다.
        verifyNoInteractions(worldStudio)
    }

    @Test fun `a work without a linked world gives the simulation only episodes`() {
        simulationStubs()
        `when`(workWorlds.readerCards("w", null)).thenReturn(ReaderWorldCardsResponse("w", null, 2))

        runner.submit("w", member, simulation())

        val context = mapper.readTree(simulationRequests.single()["context"] as String)
        assertEquals(2, context.path("episodes").size())
        assertEquals(0, context.path("cards").size())
    }

    @Test fun `a failed simulation releases the hold and saves nothing`() {
        simulationStubs()
        `when`(ai.simulate(anyMap())).thenThrow(SerialAiFailure())

        val failure = status { runner.submit("w", member, simulation()) }

        assertEquals(502, failure.status)
        verify(credits).release(ArgumentMatchers.eq(member) ?: member, ArgumentMatchers.startsWith("serial-sim:") ?: "")
        neverSettled()
        neverAdded()
    }

    @Test fun `a failed simulation never shows the reader the sentence the AI gave`() {
        simulationStubs()
        `when`(ai.simulate(anyMap())).thenThrow(SerialAiFailure(detail = "그림자이(가) 검사를 통과하지 못해 멈췄어요: 호칭·관계 오류."))

        val failure = status { runner.submit("w", member, simulation()) }

        // 독자가 쓰는 시뮬레이션 미리보기에는 AI 문구가 아니라 고정 문구를 돌려준다(AI 문구는 소유자 기록의 회차 실행 실패 사유에만 쓴다).
        assertEquals(listOf(502, "시뮬레이션 미리보기를 만들지 못했어요. 크레딧은 차감되지 않았어요."), listOf(failure.status, failure.message))
    }

    @Test fun `not enough credit for a simulation passes the conflict through and calls nothing else`() {
        simulationStubs()
        doThrow(ContentFailure(409, "크레딧이 부족합니다.", "INSUFFICIENT_CREDIT")).`when`(credits).reserve(ArgumentMatchers.eq(member) ?: member, ArgumentMatchers.startsWith("serial-sim:") ?: "", ArgumentMatchers.eq(BigDecimal("5")) ?: BigDecimal.ONE)

        val failure = status { runner.submit("w", member, simulation()) }

        assertEquals(409, failure.status)
        assertEquals("INSUFFICIENT_CREDIT", failure.code)
        verifyNoInteractions(ai)
        verify(credits, never()).release(ArgumentMatchers.anyString(), ArgumentMatchers.anyString())
        neverAdded()
    }

    @Test fun `a simulation reserve that fails for another reason releases the same key and charges nothing`() {
        simulationStubs()
        doThrow(CoreAuthException(503, "CORE_CREDIT_UNAVAILABLE", "down")).`when`(credits).reserve(ArgumentMatchers.eq(member) ?: member, ArgumentMatchers.startsWith("serial-sim:") ?: "", ArgumentMatchers.eq(BigDecimal("5")) ?: BigDecimal.ONE)

        val failure = assertThrows(CoreAuthException::class.java) { runner.submit("w", member, simulation()) }

        assertEquals(503, failure.status)
        verify(credits, times(1)).release(ArgumentMatchers.eq(member) ?: member, ArgumentMatchers.startsWith("serial-sim:") ?: "")
        verifyNoInteractions(ai)
        neverAdded()
    }

    @Test fun `a simulation without an open board is refused before any credit`() {
        `when`(serial.openBoardFor("w")).thenThrow(ContentFailure(409, "지금 열린 게시판이 없어요.", "SERIAL_NO_BOARD"))

        assertEquals("SERIAL_NO_BOARD", status { runner.submit("w", member, simulation()) }.code)

        verifyNoInteractions(credits, ai)
    }

    @Test fun `if the proposal cannot be saved after the scene the hold is released and nobody is charged`() {
        simulationStubs()
        `when`(serial.add(ArgumentMatchers.anyString(), ArgumentMatchers.anyString(), ArgumentMatchers.any(CleanProposal::class.java) ?: cleanProposal(simulation()), ArgumentMatchers.anyString(), ArgumentMatchers.anyString()))
            .thenThrow(ContentFailure(409, "지금 열린 게시판이 없어요.", "SERIAL_NO_BOARD"))

        assertEquals("SERIAL_NO_BOARD", status { runner.submit("w", member, simulation()) }.code)

        verify(credits).release(ArgumentMatchers.eq(member) ?: member, ArgumentMatchers.startsWith("serial-sim:") ?: "")
        neverSettled()
    }

    @Test fun `a failed settlement keeps the saved proposal and releases the hold`() {
        simulationStubs()
        doThrow(CoreAuthException(504, "CORE_CREDIT_TIMEOUT", "slow")).`when`(credits).settle(ArgumentMatchers.eq(member) ?: member, ArgumentMatchers.startsWith("serial-sim:") ?: "", ArgumentMatchers.eq(BigDecimal("0.4321")) ?: BigDecimal.ONE)

        assertEquals(SerialProposalCreated("p9"), runner.submit("w", member, simulation()))

        verify(credits).release(ArgumentMatchers.eq(member) ?: member, ArgumentMatchers.startsWith("serial-sim:") ?: "")
    }

    @Test fun `the same member may run a second simulation while the first still waits for the AI with its own reservation`() {
        simulationStubs()
        val keys = mutableListOf<String>()
        `when`(credits.reserve(ArgumentMatchers.eq(member) ?: member, ArgumentMatchers.startsWith("serial-sim:") ?: "", ArgumentMatchers.eq(BigDecimal("5")) ?: BigDecimal.ONE)).thenAnswer { call ->
            keys.add(call.arguments[1] as String)
            "res-" + keys.size
        }
        var nested: SerialProposalCreated? = null
        var entered = false
        `when`(ai.simulate(anyMap())).thenAnswer {
            // 첫 요청이 AI를 기다리는 동안 같은 회원이 같은 작품에 다시 보내도 서로 막지 않는다(제안 글은 개수 제한이 없다).
            if (!entered) {
                entered = true
                nested = runner.submit("w", member, simulation())
            }
            SerialScene("장면 미리보기", BigDecimal("0.4321"))
        }

        runner.submit("w", member, simulation())

        assertEquals(SerialProposalCreated("p9"), nested)
        assertEquals(2, keys.size)
        assertEquals(2, keys.toSet().size)
        verify(serial, times(2)).add("w", member, cleanProposal(simulation()), "장면 미리보기", "b1")
        verify(credits, never()).release(ArgumentMatchers.anyString(), ArgumentMatchers.anyString())
    }
}
