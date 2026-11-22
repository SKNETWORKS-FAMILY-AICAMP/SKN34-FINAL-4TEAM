package ai.storyfork.content.serial

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.auth.client.exception.CoreAuthException
import ai.storyfork.content.auth.service.CoreAuthVerificationService
import ai.storyfork.content.auth.service.CoreCreditService
import ai.storyfork.content.publication.service.PublicationService
import ai.storyfork.content.publication.service.dto.PublishedEpisodeListResponse
import ai.storyfork.content.publication.service.dto.PublishedEpisodeResponse
import ai.storyfork.content.serial.client.GeneratedEpisode
import ai.storyfork.content.serial.client.SerialAiClient
import ai.storyfork.content.serial.client.SerialAiFailure
import ai.storyfork.content.serial.client.SerialScene
import ai.storyfork.content.serial.domain.CleanOpinion
import ai.storyfork.content.serial.domain.RankedOpinion
import ai.storyfork.content.serial.domain.cleanOpinion
import ai.storyfork.content.serial.entity.SerialBoardEntity
import ai.storyfork.content.serial.entity.SerialOpinionEntity
import ai.storyfork.content.serial.service.OpenBoard
import ai.storyfork.content.serial.service.RunInput
import ai.storyfork.content.serial.service.SerialRunner
import ai.storyfork.content.serial.service.SerialService
import ai.storyfork.content.serial.service.dto.SerialOpinionCreated
import ai.storyfork.content.serial.service.dto.SerialOpinionRequest
import ai.storyfork.content.serial.service.dto.SerialSimulationRequest
import ai.storyfork.content.work.service.WorkService
import ai.storyfork.content.work.service.WorkWorldService
import ai.storyfork.content.world.service.WorldStudioService
import ai.storyfork.content.world.service.dto.CardPayload
import ai.storyfork.content.world.service.dto.ReaderWorldCardResponse
import ai.storyfork.content.world.service.dto.ReaderWorldCardsResponse
import ai.storyfork.content.world.service.dto.WorldDraftResponse
import java.math.BigDecimal
import java.time.Instant
import java.time.LocalDate
import java.time.ZonedDateTime
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.ArgumentMatchers
import org.mockito.Mockito.*
import tools.jackson.databind.json.JsonMapper

/**
 * AI 자율 연재의 외부 호출 순서를 검증한다: 크레딧 예약 → AI → (저장·발행) → 정산, 실패면 해제와 고정 문구 사유.
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
    private val credits = mock(CoreCreditService::class.java)
    private val ai = mock(SerialAiClient::class.java)
    private val publication = mock(PublicationService::class.java)
    private val works = mock(WorkService::class.java)
    private val workWorlds = mock(WorkWorldService::class.java)
    private val worldStudio = mock(WorldStudioService::class.java)
    private val auth = mock(CoreAuthVerificationService::class.java)
    private val mapper = JsonMapper.builder().build()
    private val runner = SerialRunner(serial, credits, ai, publication, works, workWorlds, worldStudio, auth, mapper, BigDecimal("5"), BigDecimal("50"))

    private val episodeRequests = mutableListOf<Map<*, *>>()
    private val simulationRequests = mutableListOf<Map<*, *>>()
    private val generated = GeneratedEpisode("종합 문장", "새 제목", "새 본문", BigDecimal("1.2345"))
    private val board = SerialBoardEntity(id = "b1", workId = "w", episodeNumber = 4, status = "queued", openedAt = at.minusSeconds(600))

    private fun opinion(id: String, kind: String = "general", scene: String? = null) = SerialOpinionEntity(
        id = id, boardId = "b1", authorId = "a-$id", kind = kind, body = "의견 $id",
        simulation = if (kind == "simulation") mapOf("premise" to "전제", "beats" to listOf("비트"), "scene" to scene) else null, createdAt = at.minusSeconds(100),
    )
    private val input = RunInput(
        "w", "b1", owner, "작품", "소개", 4, "따뜻하게",
        listOf(RankedOpinion(opinion("a"), 3), RankedOpinion(opinion("b", "simulation", "장면 미리보기"), 1)),
    )

    private fun published(vararg numbers: Int) = numbers.map { PublishedEpisodeResponse(it, 1, "v$it", "제 $it" + "화", "본문 $it") }
    private fun anyMap() = ArgumentMatchers.anyMap<String, Any?>()
    private fun status(block: () -> Unit) = assertThrows(ContentFailure::class.java, block)

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
        `when`(credits.reserve(owner, key, BigDecimal("50"))).thenReturn("res-1")
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
        order.verify(credits).reserve(owner, key, BigDecimal("50"))
        order.verify(ai).episode(anyMap())
        order.verify(serial).publish("b1", owner, generated, at)
        // 정산은 저장·발행이 끝난 뒤다: 발행이 실패하면 차감 없이 해제한다.
        order.verify(credits).settle(owner, key, BigDecimal("1.2345"))
        verify(credits, never()).release(ArgumentMatchers.anyString(), ArgumentMatchers.anyString())
        verify(serial, never()).fail(ArgumentMatchers.anyString(), ArgumentMatchers.anyString(), ArgumentMatchers.any(Instant::class.java) ?: at)
    }

    @Test fun `the episode request carries the direction the top opinions with votes and scene and the limit`() {
        queue()

        runner.tick(now)

        val body = episodeRequests.single()
        assertEquals(setOf("workId", "episodeNumber", "direction", "opinions", "context", "creditLimit", "creditReservationId"), body.keys)
        assertEquals(listOf("w", 4, "따뜻하게"), listOf(body["workId"], body["episodeNumber"], body["direction"]))
        assertEquals(BigDecimal("50"), body["creditLimit"])
        // 비용 집계용으로 Core 예약 id를 싣는다(AI trace의 credit_reservation_id).
        assertEquals("res-1", body["creditReservationId"])
        val opinions = body["opinions"] as List<*>
        assertEquals(
            listOf(
                mapOf("kind" to "general", "body" to "의견 a", "votes" to 3, "scene" to null),
                mapOf("kind" to "simulation", "body" to "의견 b", "votes" to 1, "scene" to "장면 미리보기"),
            ),
            opinions,
        )
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
        doThrow(ContentFailure(409, "크레딧이 부족합니다.", "INSUFFICIENT_CREDIT")).`when`(credits).reserve(owner, key, BigDecimal("50"))

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

    // ---- 의견 제출: 일반

    private fun general() = SerialOpinionRequest("general", "다음에는 만나면 좋겠어요")
    private fun simulation() = SerialOpinionRequest("simulation", "", SerialSimulationRequest("두 사람이 폐교에서 마주친다", listOf("문이 열린다", "그림자가 움직인다")))

    @Test fun `a general opinion is saved directly without credit or AI`() {
        `when`(serial.add("w", member, cleanOpinion(general()))).thenReturn(SerialOpinionCreated("o1"))

        assertEquals(SerialOpinionCreated("o1"), runner.submit("w", member, general()))

        verifyNoInteractions(credits, ai)
    }

    @Test fun `bad input is refused before anything is read`() {
        assertEquals(422, status { runner.submit("w", member, SerialOpinionRequest("general", " ")) }.status)
        assertEquals(422, status { runner.submit("w", member, SerialOpinionRequest("setting", "x")) }.status)

        verifyNoInteractions(serial, credits, ai)
    }

    // ---- 의견 제출: 시뮬레이션

    private fun openBoard() = OpenBoard("b1", 4, "작품", "소개")
    private fun simulationStubs() {
        `when`(serial.openBoardFor("w", member)).thenReturn(openBoard())
        `when`(works.publicEpisodes("w")).thenReturn(published(1, 2))
        `when`(workWorlds.readerCards("w", null)).thenReturn(ReaderWorldCardsResponse("w", worldId, 2, listOf(ReaderWorldCardResponse(UUID.randomUUID(), "공개 카드", "공개 본문", "location", listOf("별칭"), emptyList(), 1))))
        `when`(credits.reserve(ArgumentMatchers.eq(member) ?: member, ArgumentMatchers.startsWith("serial-sim:") ?: "", ArgumentMatchers.eq(BigDecimal("5")) ?: BigDecimal.ONE)).thenReturn("res-sim")
        `when`(ai.simulate(anyMap())).thenAnswer { call -> simulationRequests.add(call.arguments[0] as Map<*, *>); SerialScene("장면 미리보기", BigDecimal("0.4321")) }
        `when`(serial.add(ArgumentMatchers.anyString(), ArgumentMatchers.anyString(), ArgumentMatchers.any(CleanOpinion::class.java) ?: cleanOpinion(simulation()), ArgumentMatchers.anyString()))
            .thenReturn(SerialOpinionCreated("o9"))
    }

    @Test fun `a simulation reserves the limit generates the scene saves the opinion and then settles the real amount`() {
        simulationStubs()

        val created = runner.submit("w", member, simulation())

        assertEquals(SerialOpinionCreated("o9"), created)
        val order = inOrder(serial, credits, ai)
        order.verify(serial).openBoardFor("w", member)
        order.verify(credits).reserve(ArgumentMatchers.eq(member) ?: member, ArgumentMatchers.startsWith("serial-sim:") ?: "", ArgumentMatchers.eq(BigDecimal("5")) ?: BigDecimal.ONE)
        order.verify(ai).simulate(anyMap())
        order.verify(serial).add("w", member, cleanOpinion(simulation()), "장면 미리보기")
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
        verify(credits, never()).settle(ArgumentMatchers.anyString(), ArgumentMatchers.anyString(), ArgumentMatchers.any(BigDecimal::class.java) ?: BigDecimal.ZERO)
        verify(serial, never()).add(ArgumentMatchers.anyString(), ArgumentMatchers.anyString(), ArgumentMatchers.any(CleanOpinion::class.java) ?: cleanOpinion(simulation()), ArgumentMatchers.anyString())
    }

    @Test fun `not enough credit for a simulation passes the conflict through and calls nothing else`() {
        simulationStubs()
        doThrow(ContentFailure(409, "크레딧이 부족합니다.", "INSUFFICIENT_CREDIT")).`when`(credits).reserve(ArgumentMatchers.eq(member) ?: member, ArgumentMatchers.startsWith("serial-sim:") ?: "", ArgumentMatchers.eq(BigDecimal("5")) ?: BigDecimal.ONE)

        val failure = status { runner.submit("w", member, simulation()) }

        assertEquals(409, failure.status)
        assertEquals("INSUFFICIENT_CREDIT", failure.code)
        verifyNoInteractions(ai)
        verify(serial, never()).add(ArgumentMatchers.anyString(), ArgumentMatchers.anyString(), ArgumentMatchers.any(CleanOpinion::class.java) ?: cleanOpinion(simulation()), ArgumentMatchers.anyString())
    }

    @Test fun `a simulation for a closed board or an existing opinion is refused before any credit`() {
        `when`(serial.openBoardFor("w", member)).thenThrow(ContentFailure(409, "이 게시판에는 이미 의견을 냈어요.", "OPINION_EXISTS"))

        assertEquals("OPINION_EXISTS", status { runner.submit("w", member, simulation()) }.code)

        verifyNoInteractions(credits, ai)
    }

    @Test fun `if the opinion cannot be saved after the scene the hold is released and nobody is charged`() {
        simulationStubs()
        `when`(serial.add(ArgumentMatchers.anyString(), ArgumentMatchers.anyString(), ArgumentMatchers.any(CleanOpinion::class.java) ?: cleanOpinion(simulation()), ArgumentMatchers.anyString()))
            .thenThrow(ContentFailure(409, "지금 열린 의견 게시판이 없어요.", "SERIAL_NO_BOARD"))

        assertEquals("SERIAL_NO_BOARD", status { runner.submit("w", member, simulation()) }.code)

        verify(credits).release(ArgumentMatchers.eq(member) ?: member, ArgumentMatchers.startsWith("serial-sim:") ?: "")
        verify(credits, never()).settle(ArgumentMatchers.anyString(), ArgumentMatchers.anyString(), ArgumentMatchers.any(BigDecimal::class.java) ?: BigDecimal.ZERO)
    }

    @Test fun `a failed settlement keeps the saved opinion and releases the hold`() {
        simulationStubs()
        doThrow(CoreAuthException(504, "CORE_CREDIT_TIMEOUT", "slow")).`when`(credits).settle(ArgumentMatchers.eq(member) ?: member, ArgumentMatchers.startsWith("serial-sim:") ?: "", ArgumentMatchers.eq(BigDecimal("0.4321")) ?: BigDecimal.ONE)

        assertEquals(SerialOpinionCreated("o9"), runner.submit("w", member, simulation()))

        verify(credits).release(ArgumentMatchers.eq(member) ?: member, ArgumentMatchers.startsWith("serial-sim:") ?: "")
    }

    @Test fun `a second simulation by the same member at the same time is an existing opinion without touching credit`() {
        simulationStubs()
        var second: ContentFailure? = null
        `when`(ai.simulate(anyMap())).thenAnswer {
            // 첫 요청이 AI를 기다리는 동안 같은 회원의 같은 작품 요청이 들어온 경우다.
            second = assertThrows(ContentFailure::class.java) { runner.submit("w", member, simulation()) }
            SerialScene("장면 미리보기", BigDecimal("0.4321"))
        }

        runner.submit("w", member, simulation())

        assertEquals(listOf(409, "OPINION_EXISTS"), listOf(second!!.status, second!!.code))
        verify(credits, times(1)).reserve(ArgumentMatchers.eq(member) ?: member, ArgumentMatchers.startsWith("serial-sim:") ?: "", ArgumentMatchers.eq(BigDecimal("5")) ?: BigDecimal.ONE)
        // 끝난 뒤에는 같은 회원이 다시 제출할 수 있는 상태로 돌아온다(막이 풀린다).
        assertDoesNotThrow { runner.submit("w", member, simulation()) }
    }
}
