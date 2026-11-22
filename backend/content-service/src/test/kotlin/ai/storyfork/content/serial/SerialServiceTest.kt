package ai.storyfork.content.serial

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.auth.service.CoreNicknameService
import ai.storyfork.content.episode.entity.EpisodeEntity
import ai.storyfork.content.episode.repository.EpisodeRepository
import ai.storyfork.content.episode.service.EpisodeService
import ai.storyfork.content.episode.service.dto.CreateEpisodeRequest
import ai.storyfork.content.episode.service.dto.DraftRequest
import ai.storyfork.content.episode.service.dto.DraftResponse
import ai.storyfork.content.episode.service.dto.EpisodeResponse
import ai.storyfork.content.episode_version.service.EpisodeVersionService
import ai.storyfork.content.episode_version.service.dto.VersionResponse
import ai.storyfork.content.publication.service.PublicationService
import ai.storyfork.content.serial.client.GeneratedEpisode
import ai.storyfork.content.serial.domain.CleanOpinion
import ai.storyfork.content.serial.entity.AiSerialEntity
import ai.storyfork.content.serial.entity.SerialBoardEntity
import ai.storyfork.content.serial.entity.SerialOpinionEntity
import ai.storyfork.content.serial.entity.SerialVoteEntity
import ai.storyfork.content.serial.repository.AiSerialRepository
import ai.storyfork.content.serial.repository.SerialBoardRepository
import ai.storyfork.content.serial.repository.SerialOpinionRepository
import ai.storyfork.content.serial.repository.SerialVoteRepository
import ai.storyfork.content.serial.service.SerialService
import ai.storyfork.content.serial.service.dto.SerialBoardRecord
import ai.storyfork.content.serial.service.dto.SerialBoardRef
import ai.storyfork.content.serial.service.dto.SerialSettingsRequest
import ai.storyfork.content.serial.service.dto.SerialSettingsResponse
import ai.storyfork.content.serial.service.dto.SerialSimulationView
import ai.storyfork.content.work.entity.WorkEntity
import ai.storyfork.content.work.repository.WorkRepository
import ai.storyfork.content.work.service.WorkAccessService
import ai.storyfork.content.work.service.dto.WorkAccessResult
import java.math.BigDecimal
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZonedDateTime
import java.util.Optional
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.mockito.ArgumentMatchers
import org.mockito.Mockito.*
import org.springframework.dao.DataIntegrityViolationException

/**
 * AI 자율 연재의 DB 쪽 규칙(설정·게시판·의견·투표·실행 선점·발행·실패)을 DB 없이 검증한다. 저장소는 메모리 대역이고, 작품 접근은 WorkAccessService와 같은 규칙(소유자 확인·공개 확인은 404)을 흉내 낸다.
 * 실제 SQL·부분 유니크 인덱스·Security·HTTP는 CI가 확인한다.
 */
class SerialServiceTest {
    private val owner = "owner-1"
    private val alice = "alice"
    private val bob = "bob"
    // 2026-11-23 21:10 KST(월요일)
    private val t0 = Instant.parse("2026-11-23T12:10:00Z")

    private val access = mock(WorkAccessService::class.java)
    private val publication = mock(PublicationService::class.java)
    private val episodes = mock(EpisodeService::class.java)
    private val episodeRepo = mock(EpisodeRepository::class.java)
    private val versions = mock(EpisodeVersionService::class.java)
    private val settingRepo = mock(AiSerialRepository::class.java)
    private val boardRepo = mock(SerialBoardRepository::class.java)
    private val opinionRepo = mock(SerialOpinionRepository::class.java)
    private val voteRepo = mock(SerialVoteRepository::class.java)
    private val works = mock(WorkRepository::class.java)
    private val nicknames = mock(CoreNicknameService::class.java)
    private val service = SerialService(access, publication, episodes, episodeRepo, versions, settingRepo, boardRepo, opinionRepo, voteRepo, works, nicknames)

    private val workRows = mutableMapOf<String, WorkEntity>()
    private val publicWorks = mutableSetOf<String>()
    private val settingRows = mutableMapOf<String, AiSerialEntity>()
    private val boardRows = mutableListOf<SerialBoardEntity>()
    private val opinionRows = mutableListOf<SerialOpinionEntity>()
    private val voteRows = mutableListOf<SerialVoteEntity>()
    private val names = mutableMapOf<String, String>()
    private var nextEpisode = 4
    private val active = setOf("open", "queued", "running")

    private fun anySetting() = ArgumentMatchers.any(AiSerialEntity::class.java) ?: AiSerialEntity()
    private fun anyBoard() = ArgumentMatchers.any(SerialBoardEntity::class.java) ?: SerialBoardEntity()
    private fun anyOpinion() = ArgumentMatchers.any(SerialOpinionEntity::class.java) ?: SerialOpinionEntity()
    private fun anyVote() = ArgumentMatchers.any(SerialVoteEntity::class.java) ?: SerialVoteEntity()
    private fun anyInstant() = ArgumentMatchers.any(Instant::class.java) ?: Instant.EPOCH
    private fun status(block: () -> Unit) = assertThrows(ContentFailure::class.java, block)

    init {
        `when`(access.own(ArgumentMatchers.anyString(), ArgumentMatchers.anyString())).thenAnswer { call ->
            val work = workRows[call.arguments[0]]
            if (work == null || work.ownerId != call.arguments[1] || work.deletedAt != null) throw ContentFailure(404, "작품을 찾을 수 없어요.")
            accessOf(work)
        }
        `when`(access.published(ArgumentMatchers.anyString())).thenAnswer { call ->
            val work = workRows[call.arguments[0]]
            if (work == null || work.deletedAt != null || call.arguments[0] !in publicWorks) throw ContentFailure(404, "공개 작품을 찾을 수 없어요.")
            accessOf(work)
        }
        `when`(publication.nextEpisodeNumber(ArgumentMatchers.anyString())).thenAnswer { nextEpisode }
        `when`(works.findById(ArgumentMatchers.anyString())).thenAnswer { Optional.ofNullable(workRows[it.arguments[0]]) }
        `when`(nicknames.nicknames(ArgumentMatchers.anyCollection<String>())).thenAnswer { call ->
            (call.arguments[0] as Collection<*>).mapNotNull { id -> names[id]?.let { id as String to it } }.toMap()
        }

        `when`(settingRepo.findById(ArgumentMatchers.anyString())).thenAnswer { Optional.ofNullable(settingRows[it.arguments[0]]) }
        `when`(settingRepo.save(anySetting())).thenAnswer { call -> (call.arguments[0] as AiSerialEntity).also { settingRows[it.workId] = it } }
        `when`(settingRepo.findAllByEnabledTrue()).thenAnswer { settingRows.values.filter { it.enabled } }

        `when`(boardRepo.findById(ArgumentMatchers.anyString())).thenAnswer { call -> Optional.ofNullable(boardRows.find { it.id == call.arguments[0] }) }
        `when`(boardRepo.findFirstByWorkIdAndStatusIn(ArgumentMatchers.anyString(), ArgumentMatchers.anyCollection<String>())).thenAnswer { call ->
            boardRows.find { it.workId == call.arguments[0] && it.status in (call.arguments[1] as Collection<*>) }
        }
        `when`(boardRepo.findFirstByWorkIdAndStatus(ArgumentMatchers.anyString(), ArgumentMatchers.anyString())).thenAnswer { call ->
            boardRows.find { it.workId == call.arguments[0] && it.status == call.arguments[1] }
        }
        `when`(boardRepo.findFirstByWorkIdAndStatusOrderByOpenedAtDesc(ArgumentMatchers.anyString(), ArgumentMatchers.anyString())).thenAnswer { call ->
            boardRows.filter { it.workId == call.arguments[0] && it.status == call.arguments[1] }.maxByOrNull { it.openedAt }
        }
        `when`(boardRepo.findAllByStatus(ArgumentMatchers.anyString())).thenAnswer { call -> boardRows.filter { it.status == call.arguments[0] } }
        `when`(boardRepo.findAllByStatusAndClosedAtBefore(ArgumentMatchers.anyString(), anyInstant())).thenAnswer { call ->
            boardRows.filter { it.status == call.arguments[0] && it.closedAt != null && it.closedAt!! < (call.arguments[1] as Instant) }
        }
        `when`(boardRepo.findTop50ByWorkIdOrderByOpenedAtDescIdDesc(ArgumentMatchers.anyString())).thenAnswer { call ->
            boardRows.filter { it.workId == call.arguments[0] }.sortedWith(compareByDescending<SerialBoardEntity> { it.openedAt }.thenByDescending { it.id }).take(50)
        }
        // 부분 유니크 인덱스(작품당 open|queued|running 하나)를 흉내 낸다.
        `when`(boardRepo.saveAndFlush(anyBoard())).thenAnswer { call ->
            val board = call.arguments[0] as SerialBoardEntity
            if (board.status in active && boardRows.any { it !== board && it.workId == board.workId && it.status in active }) throw DataIntegrityViolationException("serial_board_one_active")
            if (boardRows.none { it === board }) boardRows.add(board)
            board
        }
        `when`(boardRepo.claim(ArgumentMatchers.anyString(), ArgumentMatchers.anyString(), anyInstant())).thenAnswer { call ->
            val board = boardRows.find { it.id == call.arguments[0] }
            if (board != null && board.status == call.arguments[1]) { board.status = "running"; board.closedAt = call.arguments[2] as Instant; 1 } else 0
        }

        `when`(opinionRepo.findAllByBoardId(ArgumentMatchers.anyString())).thenAnswer { call -> opinionRows.filter { it.boardId == call.arguments[0] } }
        `when`(opinionRepo.findById(ArgumentMatchers.anyString())).thenAnswer { call -> Optional.ofNullable(opinionRows.find { it.id == call.arguments[0] }) }
        `when`(opinionRepo.findByBoardIdAndAuthorId(ArgumentMatchers.anyString(), ArgumentMatchers.anyString())).thenAnswer { call ->
            opinionRows.find { it.boardId == call.arguments[0] && it.authorId == call.arguments[1] }
        }
        `when`(opinionRepo.saveAndFlush(anyOpinion())).thenAnswer { call ->
            val row = call.arguments[0] as SerialOpinionEntity
            if (opinionRows.any { it.boardId == row.boardId && it.authorId == row.authorId }) throw DataIntegrityViolationException("serial_opinion_board_id_author_id_key")
            opinionRows.add(row)
            row
        }

        `when`(voteRepo.findAllByBoardId(ArgumentMatchers.anyString())).thenAnswer { call -> voteRows.filter { it.boardId == call.arguments[0] } }
        `when`(voteRepo.findByBoardIdAndMemberId(ArgumentMatchers.anyString(), ArgumentMatchers.anyString())).thenAnswer { call ->
            voteRows.find { it.boardId == call.arguments[0] && it.memberId == call.arguments[1] }
        }
        `when`(voteRepo.saveAndFlush(anyVote())).thenAnswer { call -> (call.arguments[0] as SerialVoteEntity).also { v -> if (voteRows.none { it === v }) voteRows.add(v) } }
        doAnswer { call -> voteRows.removeAll(call.arguments[0] as Collection<*>); null }.`when`(voteRepo).deleteAll(ArgumentMatchers.anyCollection<SerialVoteEntity>())
        doAnswer { call -> voteRows.remove(call.arguments[0] as SerialVoteEntity); null }.`when`(voteRepo).delete(anyVote())
        `when`(voteRepo.saveAll(ArgumentMatchers.anyCollection<SerialVoteEntity>())).thenAnswer { call ->
            (call.arguments[0] as Collection<*>).map { it as SerialVoteEntity }.also { rows -> rows.forEach { v -> if (voteRows.none { it === v }) voteRows.add(v) } }
        }
    }

    private fun accessOf(work: WorkEntity) = WorkAccessResult(work.id, work.ownerId, work.title, work.description, 1, "world", "public", false, false, null, false, false)
    private fun work(id: String = "w", ownerId: String = owner, public: Boolean = true, deleted: Boolean = false) =
        WorkEntity(id = id, ownerId = ownerId, title = "작품 $id", description = "소개 $id", deletedAt = if (deleted) t0 else null).also {
            workRows[id] = it
            if (public) publicWorks.add(id)
        }
    private fun serial(workId: String = "w", enabled: Boolean = true, days: String = "MON", time: LocalTime = LocalTime.of(21, 0), last: LocalDate? = null, direction: String = "") =
        AiSerialEntity(workId, enabled, days, time, direction, last, t0).also { settingRows[workId] = it }
    private fun board(id: String = "b1", workId: String = "w", number: Int = 4, status: String = "open", at: Instant = t0.minusSeconds(3600)) =
        SerialBoardEntity(id = id, workId = workId, episodeNumber = number, status = status, openedAt = at).also { boardRows.add(it) }
    private fun opinion(id: String, boardId: String = "b1", author: String = "author-$id", kind: String = "general", hidden: Boolean = false, at: Long = 100, simulation: Map<String, Any?>? = null) =
        SerialOpinionEntity(id = id, boardId = boardId, authorId = author, kind = kind, body = "의견 $id", simulation = simulation, hidden = hidden, createdAt = Instant.ofEpochSecond(at)).also { opinionRows.add(it) }
    private fun vote(member: String, opinionId: String, boardId: String = "b1") = SerialVoteEntity(boardId, member, opinionId).also { voteRows.add(it) }
    private fun request(enabled: Boolean = true, days: List<String> = listOf("MON", "WED"), time: String = "21:00", direction: String = "") =
        SerialSettingsRequest(enabled, days, time, direction)

    // ---- 설정

    @Test fun `settings of a work that was never configured are the defaults`() {
        work()

        assertEquals(SerialSettingsResponse(false, emptyList(), "21:00", ""), service.settings("w", owner))
    }

    @Test fun `settings and every other owner action are 404 for another member`() {
        work()

        assertEquals(404, status { service.settings("w", alice) }.status)
        assertEquals(404, status { service.saveSettings("w", alice, request()) }.status)
        assertEquals(404, status { service.run("w", alice) }.status)
        assertEquals(404, status { service.boards("w", alice) }.status)
        assertEquals(404, status { service.hide("w", alice, "o1") }.status)
        assertTrue(settingRows.isEmpty())
    }

    @Test fun `saving validates the input before it looks the work up`() {
        for (bad in listOf(request(days = listOf("MON", "MON")), request(days = emptyList()), request(time = "25:00"), request(direction = "가".repeat(2001)))) {
            assertEquals(422, status { service.saveSettings("missing", owner, bad) }.status)
        }

        verifyNoInteractions(access, settingRepo)
    }

    @Test fun `saving stores normalized values and answers with the wire fields`() {
        work()

        val saved = service.saveSettings("w", owner, request(days = listOf("WED", "MON"), time = "07:30", direction = "  따뜻한 분위기로  "))

        assertEquals(SerialSettingsResponse(true, listOf("MON", "WED"), "07:30", "따뜻한 분위기로"), saved)
        assertEquals(saved, service.settings("w", owner))
        assertEquals("MON,WED", settingRows.getValue("w").days)
        assertEquals(LocalTime.of(7, 30), settingRows.getValue("w").runTime)
    }

    @Test fun `an enabled serial opens the board for the next episode`() {
        work()
        nextEpisode = 4

        service.saveSettings("w", owner, request())

        val opened = boardRows.single()
        assertEquals(listOf("w", 4, "open"), listOf(opened.workId, opened.episodeNumber, opened.status))
        assertNull(opened.closedAt)
    }

    @Test fun `no world link is needed to turn it on`() {
        work()

        // 세계관 연결에 관한 확인이 어디에도 없다: 작품 접근 확인만 거치고 저장된다.
        assertTrue(service.saveSettings("w", owner, request()).enabled)
        verify(access).own("w", owner)
    }

    @Test fun `no board opens before the first episode is published`() {
        work()
        nextEpisode = 1

        service.saveSettings("w", owner, request())

        assertTrue(boardRows.isEmpty())
        assertTrue(settingRows.getValue("w").enabled)
    }

    @Test fun `saving again keeps the single active board`() {
        work()
        val existing = board(status = "running")

        service.saveSettings("w", owner, request())

        assertEquals(listOf(existing), boardRows)
    }

    @Test fun `turning it off while a run is queued or running is refused and changes nothing`() {
        for (state in listOf("queued", "running")) {
            boardRows.clear(); settingRows.clear()
            work(); val row = serial(direction = "그대로"); val active = board(status = state)

            val failure = status { service.saveSettings("w", owner, request(enabled = false, days = emptyList(), direction = "바뀐 방향")) }

            assertEquals(listOf<Any?>(409, "SERIAL_RUNNING"), listOf(failure.status, failure.code), state)
            assertEquals(listOf<Any?>(true, "그대로", state), listOf(row.enabled, row.direction, active.status), state)
        }
    }

    @Test fun `saving while already off is not a turn-off even with a run board left over`() {
        for (state in listOf("queued", "running")) {
            boardRows.clear(); settingRows.clear()
            work(); val row = serial(enabled = false, days = "MON"); val leftover = board(status = state)

            // 막는 것은 켜짐에서 끄기로 바뀔 때뿐이다: 이미 꺼진 설정의 요일·시각·방향 저장은 실행 상태와 무관하게 된다.
            service.saveSettings("w", owner, request(enabled = false, days = listOf("TUE"), time = "20:30", direction = "새 방향"))

            assertEquals(listOf<Any?>(false, "TUE", LocalTime.of(20, 30), "새 방향", state), listOf(row.enabled, row.days, row.runTime, row.direction, leftover.status), state)
        }
    }

    @Test fun `turning it off while only an open board waits works and leaves that board open`() {
        work(); serial()
        val open = board()

        service.saveSettings("w", owner, request(enabled = false, days = emptyList()))

        assertFalse(settingRows.getValue("w").enabled)
        assertEquals(listOf("open"), boardRows.map { it.status })
        assertEquals("open", open.status)
    }

    @Test fun `days time and direction can still be changed while a run is queued or running`() {
        for (state in listOf("queued", "running")) {
            boardRows.clear(); settingRows.clear()
            work(); serial(); val active = board(status = state)

            service.saveSettings("w", owner, request(days = listOf("TUE"), time = "20:30", direction = "새 방향"))

            val row = settingRows.getValue("w")
            assertEquals(listOf<Any?>(true, "TUE", LocalTime.of(20, 30), "새 방향", state), listOf(row.enabled, row.days, row.runTime, row.direction, active.status), state)
        }
    }

    // ---- 지금 마감·실행

    @Test fun `run needs an enabled serial`() {
        work()
        board()

        assertEquals("SERIAL_DISABLED", status { service.run("w", owner) }.code)
        serial(enabled = false)
        assertEquals("SERIAL_DISABLED", status { service.run("w", owner) }.code)
        assertEquals(409, status { service.run("w", owner) }.status)
        assertEquals("open", boardRows.single().status)
    }

    @Test fun `run needs an active board`() {
        work()
        serial()
        board(status = "published")

        val failure = status { service.run("w", owner) }

        assertEquals(409, failure.status)
        assertEquals("SERIAL_NO_BOARD", failure.code)
    }

    @Test fun `run on a queued or running board is already running`() {
        work()
        serial()
        val active = board(status = "queued")

        assertEquals("SERIAL_RUNNING", status { service.run("w", owner) }.code)
        active.status = "running"
        assertEquals("SERIAL_RUNNING", status { service.run("w", owner) }.code)
    }

    @Test fun `run queues the open board and nothing else changes`() {
        work()
        serial()
        val open = board()
        val old = board(id = "old", status = "published", at = t0.minusSeconds(9000))

        service.run("w", owner)

        assertEquals(listOf("queued", "published"), listOf(open.status, old.status))
        assertNull(open.closedAt)
    }

    // ---- 의견

    private fun general(body: String = "의견") = CleanOpinion("general", body, null, emptyList())

    @Test fun `each member writes one opinion per board`() {
        work()
        board()

        service.add("w", alice, general("첫 의견"))
        service.add("w", bob, general("다른 회원"))
        val again = status { service.add("w", alice, general("두 번째")) }

        assertEquals(409, again.status)
        assertEquals("OPINION_EXISTS", again.code)
        assertEquals(listOf("alice", "bob"), opinionRows.map { it.authorId })
    }

    @Test fun `the same member may write on the next board`() {
        work()
        board(status = "published")
        opinion("old", boardId = "b1", author = alice)
        board(id = "b2", number = 5)

        service.add("w", alice, general())

        assertEquals(listOf("b1", "b2"), opinionRows.map { it.boardId })
    }

    @Test fun `a unique violation from a concurrent insert is also an existing opinion`() {
        work()
        board()
        // 사전 확인은 지나갔지만 저장 순간 다른 요청이 먼저 저장한 경우(부분 유니크가 마지막 방어)
        doThrow(DataIntegrityViolationException("serial_opinion_board_id_author_id_key")).`when`(opinionRepo).saveAndFlush(anyOpinion())

        assertEquals("OPINION_EXISTS", status { service.add("w", alice, general()) }.code)
    }

    @Test fun `only an open board takes opinions`() {
        work()
        assertEquals("SERIAL_NO_BOARD", status { service.add("w", alice, general()) }.code)
        val active = board(status = "queued")
        assertEquals("SERIAL_NO_BOARD", status { service.add("w", alice, general()) }.code)
        active.status = "running"
        assertEquals("SERIAL_NO_BOARD", status { service.add("w", alice, general()) }.code)
        assertTrue(opinionRows.isEmpty())
    }

    @Test fun `a non-public or missing work takes no opinions`() {
        work("hidden", public = false)
        board(workId = "hidden")

        assertEquals(404, status { service.add("hidden", alice, general()) }.status)
        assertEquals(404, status { service.add("missing", alice, general()) }.status)
        assertEquals(404, status { service.vote("hidden", alice, "o1") }.status)
        assertEquals(404, status { service.board("hidden", null) }.status)
    }

    @Test fun `the owner may write an opinion on their own board`() {
        work()
        board()

        service.add("w", owner, general("작가 의견"))

        assertEquals(owner, opinionRows.single().authorId)
    }

    @Test fun `a simulation opinion keeps its premise beats and scene and a general one keeps none`() {
        work()
        board()

        service.add("w", alice, CleanOpinion("simulation", "전제 그대로", "전제 그대로", listOf("비트1", "비트2")), "장면 미리보기")
        service.add("w", bob, general())

        val sim = opinionRows.first { it.authorId == alice }
        assertEquals("simulation", sim.kind)
        assertEquals(mapOf("premise" to "전제 그대로", "beats" to listOf("비트1", "비트2"), "scene" to "장면 미리보기"), sim.simulation)
        assertNull(opinionRows.first { it.authorId == bob }.simulation)
    }

    @Test fun `a simulation opinion is not saved on another board than the one it was made for`() {
        work()
        board(id = "b1", number = 4, status = "published")
        board(id = "b2", number = 5)
        val simulation = CleanOpinion("simulation", "전제", "전제", emptyList())

        // AI를 기다리는 사이 b1이 발행돼 다음 게시판 b2가 열렸다: 이전 회차 문맥으로 만든 장면을 b2에 저장하지 않는다(러너가 예약을 해제한다).
        val failure = status { service.add("w", alice, simulation, "장면", "b1") }

        assertEquals(listOf(409, "SERIAL_NO_BOARD"), listOf(failure.status, failure.code))
        assertTrue(opinionRows.isEmpty())
        // 처음 본 게시판이 지금도 열려 있으면 그대로 저장한다.
        service.add("w", alice, simulation, "장면", "b2")
        assertEquals(listOf("b2"), opinionRows.map { it.boardId })
    }

    @Test fun `checking before a simulation returns the open board and refuses a second opinion`() {
        work()
        val open = board(number = 5)

        val ready = service.openBoardFor("w", alice)

        assertEquals(listOf(open.id, 5, "작품 w", "소개 w"), listOf(ready.boardId, ready.episodeNumber, ready.title, ready.summary))
        opinion("o1", author = alice)
        assertEquals("OPINION_EXISTS", status { service.openBoardFor("w", alice) }.code)
    }

    // ---- 투표

    @Test fun `a vote is created moved and repeated without a second row`() {
        work()
        board()
        opinion("a"); opinion("b")

        service.vote("w", alice, "a")
        service.vote("w", alice, "a")
        assertEquals(listOf("a"), voteRows.map { it.opinionId })

        service.vote("w", alice, "b")
        assertEquals(listOf("b"), voteRows.map { it.opinionId })
        service.vote("w", bob, "b")
        assertEquals(2, voteRows.size)
        assertEquals(listOf("b", "b"), voteRows.map { it.opinionId })
    }

    @Test fun `a vote may be cancelled and cancelling without one is harmless`() {
        work()
        board()
        opinion("a")
        vote(alice, "a")

        service.cancelVote("w", alice)
        service.cancelVote("w", alice)
        service.cancelVote("w", bob)

        assertTrue(voteRows.isEmpty())
    }

    @Test fun `a member may vote for their own opinion`() {
        work()
        board()
        opinion("mine", author = alice)

        service.vote("w", alice, "mine")

        assertEquals("mine", voteRows.single().opinionId)
    }

    @Test fun `hidden foreign or unknown opinions cannot be voted for`() {
        work()
        board()
        board(id = "elsewhere", workId = "w", status = "published", number = 3)
        opinion("hidden", hidden = true)
        opinion("foreign", boardId = "elsewhere")

        for (target in listOf("hidden", "foreign", "unknown")) assertEquals(404, status { service.vote("w", alice, target) }.status, target)
        assertTrue(voteRows.isEmpty())
    }

    @Test fun `votes need an open board`() {
        work()
        opinion("a")
        assertEquals("SERIAL_NO_BOARD", status { service.vote("w", alice, "a") }.code)
        assertEquals("SERIAL_NO_BOARD", status { service.cancelVote("w", alice) }.code)
        board(status = "queued")
        assertEquals("SERIAL_NO_BOARD", status { service.vote("w", alice, "a") }.code)
        assertTrue(voteRows.isEmpty())
    }

    @Test fun `a concurrent first vote by the same member is a conflict and not a server error`() {
        work()
        board()
        opinion("a")
        // 사전 조회는 비어 있었지만 저장 순간 다른 요청이 같은 회원의 첫 표를 먼저 넣은 경우(기본키가 마지막 방어)
        doThrow(DataIntegrityViolationException("serial_vote_pkey")).`when`(voteRepo).saveAndFlush(anyVote())

        val failure = status { service.vote("w", alice, "a") }

        assertEquals(listOf(409, "VOTE_CONFLICT"), listOf(failure.status, failure.code))
        assertTrue(voteRows.isEmpty())
    }

    // ---- 숨김

    @Test fun `the owner hides an opinion and only that one`() {
        work()
        board()
        val bad = opinion("bad"); val good = opinion("good")

        service.hide("w", owner, "bad")

        assertEquals(listOf(true, false), listOf(bad.hidden, good.hidden))
    }

    @Test fun `an opinion of another work cannot be hidden`() {
        work(); work("other", ownerId = "someone")
        board(); board(id = "ob", workId = "other")
        val foreign = opinion("x", boardId = "ob")

        assertEquals(404, status { service.hide("w", owner, "x") }.status)
        assertEquals(404, status { service.hide("w", owner, "unknown") }.status)
        assertFalse(foreign.hidden)
    }

    // ---- 독자 게시판

    @Test fun `an anonymous reader sees the open board by votes then time with names and counts`() {
        work()
        val open = board(number = 5)
        opinion("first", author = "u1", at = 10)
        opinion("second", author = "u2", at = 20)
        opinion("popular", author = "u3", at = 30, kind = "simulation", simulation = mapOf("premise" to "전제", "beats" to listOf("비트"), "scene" to "장면"))
        vote("v1", "popular"); vote("v2", "popular"); vote("v3", "first")
        names["u1"] = "하나"; names["u2"] = "둘"; names["u3"] = "셋"

        val view = service.board("w", null)

        assertEquals(SerialBoardRef(open.id, 5), view.board)
        assertEquals(listOf("popular", "first", "second"), view.opinions.map { it.id })
        assertEquals(listOf(2, 1, 0), view.opinions.map { it.votes })
        assertEquals(listOf("셋", "하나", "둘"), view.opinions.map { it.authorName })
        assertEquals(SerialSimulationView("전제", listOf("비트"), "장면"), view.opinions.first().simulation)
        assertNull(view.opinions[1].simulation)
        assertEquals(Instant.ofEpochSecond(30), view.opinions.first().createdAt)
        assertEquals(listOf(null, null, null), listOf(view.myOpinionId, view.myVoteOpinionId, view.summary))
    }

    @Test fun `a logged-in member gets their own opinion and vote`() {
        work()
        board()
        opinion("mine", author = alice, at = 10); opinion("other", author = bob, at = 20)
        vote(alice, "other")
        names[alice] = "앨리스"; names[bob] = "밥"

        val view = service.board("w", alice)

        assertEquals("mine", view.myOpinionId)
        assertEquals("other", view.myVoteOpinionId)
        assertEquals(listOf("other", "mine").sorted(), view.opinions.map { it.id }.sorted())
    }

    @Test fun `members who left Core show as withdrawn`() {
        work()
        board()
        opinion("gone", author = "ghost")

        assertEquals("탈퇴한 회원", service.board("w", null).opinions.single().authorName)
    }

    @Test fun `hidden opinions leave the list but their author keeps the one-opinion limit`() {
        work()
        board()
        opinion("bad", author = alice, hidden = true); opinion("fine", author = bob)
        vote(bob, "bad")

        val forAlice = service.board("w", alice)
        val forBob = service.board("w", bob)

        assertEquals(listOf("fine"), forAlice.opinions.map { it.id })
        assertEquals("bad", forAlice.myOpinionId)
        // 숨겨진 의견에 던진 표는 보이지 않으므로 내 투표가 아닌 것으로 알려 다시 고를 수 있다.
        assertNull(forBob.myVoteOpinionId)
        assertEquals(0, forAlice.opinions.single().votes)
    }

    @Test fun `there is no board while one is queued or running and the summary is the last published one`() {
        work()
        board(id = "old", status = "published", number = 2, at = t0.minusSeconds(9000)).summary = "옛 종합"
        board(id = "last", status = "published", number = 3, at = t0.minusSeconds(5000)).summary = "마지막 종합"
        board(id = "failed", status = "failed", number = 4, at = t0.minusSeconds(100))
        board(id = "now", status = "queued", number = 4, at = t0.minusSeconds(50))
        opinion("a", boardId = "now")

        val view = service.board("w", null)

        assertNull(view.board)
        assertEquals(emptyList<Any>(), view.opinions)
        assertEquals("마지막 종합", view.summary)
    }

    @Test fun `a work without any board has an empty reader view`() {
        work()

        val view = service.board("w", alice)

        assertNull(view.board)
        assertNull(view.summary)
        assertEquals(emptyList<Any>(), view.opinions)
        assertNull(view.myOpinionId)
    }

    // ---- 소유자 기록

    @Test fun `owner records are newest first with the contract fields`() {
        work()
        board(id = "b1", number = 2, status = "published", at = t0.minusSeconds(900)).also { it.publishedEpisodeNumber = 2; it.closedAt = t0.minusSeconds(800) }
        board(id = "b2", number = 3, status = "failed", at = t0.minusSeconds(500)).also { it.failureReason = "크레딧이 부족합니다."; it.closedAt = t0.minusSeconds(400) }
        board(id = "b3", number = 3, status = "open", at = t0.minusSeconds(100))

        val records = service.boards("w", owner)

        assertEquals(
            listOf(
                SerialBoardRecord("b3", 3, "open", null, null, null),
                SerialBoardRecord("b2", 3, "failed", null, "크레딧이 부족합니다.", t0.minusSeconds(400)),
                SerialBoardRecord("b1", 2, "published", 2, null, t0.minusSeconds(800)),
            ),
            records,
        )
    }

    @Test fun `owner records are capped at fifty`() {
        work()
        (1..60).forEach { board(id = "b$it", number = it, status = "published", at = t0.minusSeconds(1000L - it)) }

        assertEquals(50, service.boards("w", owner).size)
    }

    // ---- 실행 준비

    @Test fun `claiming moves the board to running once and records today as the run date`() {
        work()
        val row = serial()
        val open = board()

        assertTrue(service.claim("b1", "open", LocalDate.parse("2026-11-23"), t0))
        assertFalse(service.claim("b1", "open", LocalDate.parse("2026-11-23"), t0))

        assertEquals("running", open.status)
        assertEquals(t0, open.closedAt)
        assertEquals(LocalDate.parse("2026-11-23"), row.lastRunDate)
    }

    @Test fun `claiming refuses a serial that was turned off before the claim`() {
        work(); val row = serial(enabled = false); val open = board()

        // 일정 점검이 열린 게시판을 읽은 뒤 소유자가 끄기를 저장한 경우다: 작품 잠금 안에서 enabled를 다시 보고 시작하지 않는다.
        assertFalse(service.claim("b1", "open", LocalDate.parse("2026-11-23"), t0))

        assertEquals("open", open.status)
        assertNull(row.lastRunDate)
        verify(boardRepo, never()).claim(ArgumentMatchers.anyString(), ArgumentMatchers.anyString(), anyInstant())
    }

    @Test fun `claiming a work that has no settings row starts nothing`() {
        work(); val open = board()

        assertFalse(service.claim("b1", "open", LocalDate.parse("2026-11-23"), t0))

        assertEquals("open", open.status)
    }

    @Test fun `claiming takes the work lock first so run and disable cannot be overwritten`() {
        work(); serial(); board()

        assertTrue(service.claim("b1", "open", LocalDate.parse("2026-11-23"), t0))

        // 지금 실행(open → queued)·끄기 저장(queued → open)은 작품 잠금 아래에서 상태를 쓰므로 선점도 같은 잠금을 쥐고 해야 서로를 덮지 않는다.
        val order = inOrder(access, boardRepo)
        order.verify(access).lockScope("w")
        order.verify(boardRepo).claim("b1", "open", t0)
    }

    @Test fun `claiming from the wrong state or an unknown board does nothing`() {
        work()
        val row = serial()
        val queued = board(status = "queued")

        assertFalse(service.claim("b1", "open", LocalDate.parse("2026-11-23"), t0))
        assertFalse(service.claim("unknown", "open", LocalDate.parse("2026-11-23"), t0))
        verify(access, never()).lockScope("unknown")

        assertEquals("queued", queued.status)
        assertNull(row.lastRunDate)
    }

    @Test fun `due boards are the open boards of enabled serials whose time has come`() {
        work(); work("late"); work("off"); work("done"); work("tue"); work("running")
        val now = ZonedDateTime.parse("2026-11-23T21:10:00+09:00[Asia/Seoul]")
        serial("w"); board("b-w", "w")
        serial("late", time = LocalTime.of(19, 0)); board("b-late", "late")
        serial("off", enabled = false); board("b-off", "off")
        serial("done", last = LocalDate.parse("2026-11-23")); board("b-done", "done")
        serial("tue", days = "TUE"); board("b-tue", "tue")
        serial("running"); board("b-running", "running", status = "running")

        assertEquals(listOf("b-w"), service.due(now).map { it.id })
    }

    @Test fun `queued boards are listed for execution`() {
        board("q", status = "queued"); board("o", workId = "x"); board("r", workId = "y", status = "running")

        assertEquals(listOf("q"), service.queued().map { it.id })
    }

    @Test fun `the run input holds the top three opinions the owner and the direction`() {
        work()
        serial(direction = "따뜻하게")
        board(number = 4)
        opinion("a", at = 1); opinion("b", at = 2); opinion("c", at = 3); opinion("d", at = 4); opinion("hid", at = 0, hidden = true)
        vote("m1", "d"); vote("m2", "d"); vote("m3", "b"); vote("m4", "hid"); vote("m5", "hid"); vote("m6", "hid")

        val input = service.runInput("b1")

        assertEquals(listOf("w", "b1", owner, "작품 w", "소개 w", 4, "따뜻하게"), listOf(input.workId, input.boardId, input.owner, input.title, input.summary, input.number, input.direction))
        assertEquals(listOf("d", "b", "a"), input.opinions.map { it.opinion.id })
        assertEquals(listOf(2, 1, 0), input.opinions.map { it.votes })
    }

    @Test fun `the run input moves the target when a human published the episode meanwhile`() {
        work(); serial(); val running = board(number = 4, status = "running")
        nextEpisode = 5

        val input = service.runInput("b1")

        assertEquals(5, input.number)
        assertEquals(5, running.episodeNumber)
    }

    @Test fun `the run input is refused for a deleted work`() {
        work(deleted = true); serial(); board(status = "running")

        assertEquals(404, status { service.runInput("b1") }.status)
    }

    // ---- 발행

    private fun episode(number: Int, revision: Int = 0) = EpisodeResponse(number, DraftResponse("새 회차", "", revision), emptyList(), null, false, null)
    private val generated = GeneratedEpisode("종합 문장", "새 제목", "새 본문", BigDecimal("1.2345"))

    private fun stubPublish(number: Int = 4) {
        `when`(versions.saveWithVersionForSerial("w", owner, number, DraftRequest("새 제목", "새 본문", 0, ""))).thenReturn(VersionResponse("v-new", "새 제목", "새 본문", 1, number, "2026-11-23T12:10:00Z"))
        doAnswer { nextEpisode = number + 1; null }.`when`(publication).publishScheduled("w", owner, number, "v-new")
    }

    @Test fun `publishing creates the missing episode saves a version publishes it and opens the next board`() {
        work(); serial()
        val running = board(number = 4, status = "running")
        // 회차 행이 없다: 합류한 서비스의 404를 잡으면 바깥 트랜잭션이 rollback-only가 되므로 저장소로 먼저 확인한다.
        `when`(episodeRepo.findByWorkIdAndSequence("w", 4)).thenReturn(null)
        `when`(episodes.createForSerial("w", owner, CreateEpisodeRequest("새 제목"))).thenReturn(episode(4))
        stubPublish()

        service.publish("b1", owner, generated, t0)

        assertEquals(listOf("published", "종합 문장", 4), listOf(running.status, running.summary, running.publishedEpisodeNumber))
        assertNull(running.failureReason)
        val order = inOrder(access, episodeRepo, episodes, versions, publication, boardRepo)
        order.verify(access).own("w", owner)
        order.verify(episodeRepo).findByWorkIdAndSequence("w", 4)
        order.verify(episodes).createForSerial("w", owner, CreateEpisodeRequest("새 제목"))
        order.verify(versions).saveWithVersionForSerial("w", owner, 4, DraftRequest("새 제목", "새 본문", 0, ""))
        order.verify(publication).publishScheduled("w", owner, 4, "v-new")
        // 끝난 게시판의 상태가 먼저 반영돼야 같은 작품의 다음 게시판이 부분 유니크에 걸리지 않는다.
        order.verify(boardRepo).saveAndFlush(running)
        val next = boardRows.single { it !== running }
        assertEquals(listOf(5, "open", "w"), listOf(next.episodeNumber, next.status, next.workId))
        order.verify(boardRepo).saveAndFlush(next)
    }

    @Test fun `publishing never goes through the entries that AI writing locks`() {
        work(); serial(); board(number = 4, status = "running")
        `when`(episodeRepo.findByWorkIdAndSequence("w", 4)).thenReturn(null)
        `when`(episodes.createForSerial("w", owner, CreateEpisodeRequest("새 제목"))).thenReturn(episode(4))
        stubPublish()

        service.publish("b1", owner, generated, t0)

        // 공개 진입점(REST·MCP가 쓰는 것)은 켜진 동안 소유자도 막으므로, 자율 연재 실행은 자기 진입점으로만 저장한다.
        verify(episodes, never()).create(ArgumentMatchers.anyString(), ArgumentMatchers.anyString(), ArgumentMatchers.any(CreateEpisodeRequest::class.java) ?: CreateEpisodeRequest("x"))
        verify(episodes, never()).update(ArgumentMatchers.anyString(), ArgumentMatchers.anyString(), ArgumentMatchers.anyInt(), ArgumentMatchers.any(DraftRequest::class.java) ?: DraftRequest("t", "b", 0))
        verify(versions, never()).saveWithVersion(ArgumentMatchers.anyString(), ArgumentMatchers.anyString(), ArgumentMatchers.anyInt(), ArgumentMatchers.any(DraftRequest::class.java) ?: DraftRequest("t", "b", 0))
    }

    @Test fun `publishing writes into an existing draft instead of creating another episode`() {
        work(); serial(); board(number = 4, status = "running")
        `when`(episodeRepo.findByWorkIdAndSequence("w", 4)).thenReturn(EpisodeEntity(id = "e4", workId = "w", sequence = 4))
        `when`(episodes.read("w", owner, 4)).thenReturn(episode(4, revision = 3))
        `when`(versions.saveWithVersionForSerial("w", owner, 4, DraftRequest("새 제목", "새 본문", 3, ""))).thenReturn(VersionResponse("v-new", "새 제목", "새 본문", 4, 4, "2026-11-23T12:10:00Z"))
        doAnswer { nextEpisode = 5; null }.`when`(publication).publishScheduled("w", owner, 4, "v-new")

        service.publish("b1", owner, generated, t0)

        verify(episodes, never()).createForSerial("w", owner, CreateEpisodeRequest("새 제목"))
        verify(publication).publishScheduled("w", owner, 4, "v-new")
        assertEquals("published", boardRows.first { it.id == "b1" }.status)
    }

    @Test fun `a long generated title is cut to the episode title limit`() {
        work(); serial(); board(number = 4, status = "running")
        val title = "가".repeat(130)
        `when`(episodes.createForSerial("w", owner, CreateEpisodeRequest("가".repeat(120)))).thenReturn(episode(4))
        `when`(versions.saveWithVersionForSerial("w", owner, 4, DraftRequest("가".repeat(120), "새 본문", 0, ""))).thenReturn(VersionResponse("v-new", "t", "새 본문", 1, 4, "x"))

        service.publish("b1", owner, generated.copy(title = title), t0)

        verify(episodes).createForSerial("w", owner, CreateEpisodeRequest("가".repeat(120)))
    }

    @Test fun `publishing is refused when a human already published the target episode`() {
        work(); serial()
        val running = board(number = 4, status = "running")
        nextEpisode = 5

        val failure = status { service.publish("b1", owner, generated, t0) }

        assertEquals(409, failure.status)
        // 사람이 발행한 회차를 AI 원고로 바꾸지 않는다: 저장도 발행도 없다.
        verifyNoInteractions(versions)
        verify(publication, never()).publishScheduled(ArgumentMatchers.anyString(), ArgumentMatchers.anyString(), ArgumentMatchers.anyInt(), ArgumentMatchers.anyString())
        assertEquals("running", running.status)
    }

    @Test fun `publishing is refused when the board is no longer running or the work was taken away`() {
        work(); serial()
        val done = board(status = "failed")
        assertEquals(409, status { service.publish("b1", owner, generated, t0) }.status)
        assertEquals("failed", done.status)

        boardRows.clear(); board(id = "b2", status = "running")
        assertEquals(404, status { service.publish("b2", "someone-else", generated, t0) }.status)
        verifyNoInteractions(versions)
    }

    @Test fun `publishing never overwrites a draft the owner is writing`() {
        work(); serial()
        val running = board(number = 4, status = "running")
        `when`(episodeRepo.findByWorkIdAndSequence("w", 4)).thenReturn(EpisodeEntity(id = "e4", workId = "w", sequence = 4))
        `when`(episodes.read("w", owner, 4)).thenReturn(EpisodeResponse(4, DraftResponse("내 원고", "작가가 쓰던 본문", 2), emptyList(), null, false, null))

        val failure = status { service.publish("b1", owner, generated, t0) }

        // 쓰던 본문이 있으면 AI 원고로 덮지 않는다: 저장도 발행도 없고 실패 처리와 예약 해제는 호출한 러너가 한다.
        assertEquals(listOf(409, "SERIAL_DRAFT_EXISTS", "작성 중인 원고가 있어 발행하지 않았습니다."), listOf(failure.status, failure.code, failure.message))
        verifyNoInteractions(versions)
        verify(publication, never()).publishScheduled(ArgumentMatchers.anyString(), ArgumentMatchers.anyString(), ArgumentMatchers.anyInt(), ArgumentMatchers.anyString())
        assertEquals("running", running.status)
        assertEquals(1, boardRows.size)
    }

    @Test fun `a draft with only whitespace is empty and is replaced as before`() {
        work(); serial(); board(number = 4, status = "running")
        `when`(episodeRepo.findByWorkIdAndSequence("w", 4)).thenReturn(EpisodeEntity(id = "e4", workId = "w", sequence = 4))
        `when`(episodes.read("w", owner, 4)).thenReturn(EpisodeResponse(4, DraftResponse("새 회차", " \n  ", 3), emptyList(), null, false, null))
        `when`(versions.saveWithVersionForSerial("w", owner, 4, DraftRequest("새 제목", "새 본문", 3, ""))).thenReturn(VersionResponse("v-new", "새 제목", "새 본문", 4, 4, "2026-11-23T12:10:00Z"))
        doAnswer { nextEpisode = 5; null }.`when`(publication).publishScheduled("w", owner, 4, "v-new")

        service.publish("b1", owner, generated, t0)

        verify(publication).publishScheduled("w", owner, 4, "v-new")
        assertEquals("published", boardRows.first { it.id == "b1" }.status)
    }

    @Test fun `a failing publication leaves the board running for the caller to fail`() {
        work(); serial()
        val running = board(number = 4, status = "running")
        `when`(episodeRepo.findByWorkIdAndSequence("w", 4)).thenReturn(EpisodeEntity(id = "e4", workId = "w", sequence = 4))
        `when`(episodes.read("w", owner, 4)).thenReturn(episode(4))
        `when`(versions.saveWithVersionForSerial("w", owner, 4, DraftRequest("새 제목", "새 본문", 0, ""))).thenReturn(VersionResponse("v-new", "t", "b", 1, 4, "x"))
        doThrow(ContentFailure(403, "권리 제한 중인 작품은 공개할 수 없어요.")).`when`(publication).publishScheduled("w", owner, 4, "v-new")

        assertEquals(403, status { service.publish("b1", owner, generated, t0) }.status)
        assertEquals("running", running.status)
        assertEquals(1, boardRows.size)
    }

    // ---- 실패

    @Test fun `failing records the reason closes the board and reopens it for the same episode with its opinions and votes`() {
        work(); serial()
        val running = board(number = 4, status = "running").also { it.closedAt = t0.minusSeconds(60) }
        val a = opinion("a", author = alice); val b = opinion("b", author = bob)
        vote(alice, "b"); vote(bob, "b")

        service.fail("b1", "크레딧이 부족합니다.", t0)

        assertEquals(listOf("failed", "크레딧이 부족합니다.", t0.minusSeconds(60)), listOf(running.status, running.failureReason, running.closedAt))
        val retry = boardRows.single { it !== running }
        assertEquals(listOf("open", 4, "w"), listOf(retry.status, retry.episodeNumber, retry.workId))
        assertEquals(listOf(retry.id, retry.id), listOf(a.boardId, b.boardId))
        assertEquals(listOf(retry.id, retry.id), voteRows.map { it.boardId })
        assertEquals(listOf("b", "b"), voteRows.map { it.opinionId })
        assertEquals(listOf(alice, bob), voteRows.map { it.memberId })
        val order = inOrder(boardRepo)
        order.verify(boardRepo).saveAndFlush(running)
        order.verify(boardRepo).saveAndFlush(retry)
    }

    @Test fun `failing a board whose serial was turned off reopens nothing`() {
        work(); serial(enabled = false)
        val running = board(status = "running")
        val a = opinion("a")

        service.fail("b1", "AI 생성에 실패했습니다.", t0)

        assertEquals("failed", running.status)
        assertEquals(1, boardRows.size)
        assertEquals("b1", a.boardId)
    }

    @Test fun `failing a board that is not running does nothing`() {
        work(); serial()
        val published = board(status = "published")

        service.fail("b1", "AI 생성에 실패했습니다.", t0)
        service.fail("unknown", "AI 생성에 실패했습니다.", t0)

        assertEquals(listOf("published", null), listOf(published.status, published.failureReason))
        assertEquals(1, boardRows.size)
    }

    @Test fun `a closing time already set by the claim is kept and a missing one is filled`() {
        work(); serial()
        val running = board(status = "running")

        service.fail("b1", "AI 생성에 실패했습니다.", t0)

        assertEquals(t0, running.closedAt)
    }

    @Test fun `running boards older than thirty minutes are stale`() {
        board("fresh", status = "running").closedAt = t0.minusSeconds(29 * 60)
        board("old", workId = "x", status = "running").closedAt = t0.minusSeconds(31 * 60)
        board("open", workId = "y", status = "open")
        board("done", workId = "z", status = "published").closedAt = t0.minusSeconds(3 * 3600)

        assertEquals(listOf("old"), service.staleRunning(t0).map { it.id })
    }

    // ---- 게시판 맞춤(1분 주기)

    @Test fun `reconcile opens a missing board once an episode is published`() {
        work(); serial(); nextEpisode = 4

        service.reconcile("w")
        service.reconcile("w")

        assertEquals(listOf(4), boardRows.map { it.episodeNumber })
    }

    @Test fun `reconcile moves an open board to the new last episode plus one`() {
        work(); serial()
        val open = board(number = 4)
        nextEpisode = 6

        service.reconcile("w")

        assertEquals(6, open.episodeNumber)
        assertEquals(1, boardRows.size)
    }

    @Test fun `reconcile leaves running boards and disabled serials alone`() {
        work(); serial()
        val running = board(number = 4, status = "running")
        nextEpisode = 6
        service.reconcile("w")
        assertEquals(4, running.episodeNumber)

        work("off"); serial("off", enabled = false)
        service.reconcile("off")
        assertEquals(1, boardRows.size)
    }

    @Test fun `enabled works are listed for the periodic check`() {
        serial("a"); serial("b", enabled = false); serial("c")

        assertEquals(setOf("a", "c"), service.enabledWorkIds().toSet())
    }
}
