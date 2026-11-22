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
import ai.storyfork.content.serial.domain.CleanProposal
import ai.storyfork.content.serial.entity.AiSerialEntity
import ai.storyfork.content.serial.entity.SerialBoardEntity
import ai.storyfork.content.serial.entity.SerialChoiceEntity
import ai.storyfork.content.serial.entity.SerialProposalEntity
import ai.storyfork.content.serial.entity.SerialProposalLikeEntity
import ai.storyfork.content.serial.entity.SerialVoteEntity
import ai.storyfork.content.serial.repository.AiSerialRepository
import ai.storyfork.content.serial.repository.SerialBoardRepository
import ai.storyfork.content.serial.repository.SerialChoiceRepository
import ai.storyfork.content.serial.repository.SerialProposalLikeRepository
import ai.storyfork.content.serial.repository.SerialProposalRepository
import ai.storyfork.content.serial.repository.SerialVoteRepository
import ai.storyfork.content.serial.service.ChoiceInput
import ai.storyfork.content.serial.service.SerialService
import ai.storyfork.content.serial.service.dto.SerialBoardRecord
import ai.storyfork.content.serial.service.dto.SerialBoardRef
import ai.storyfork.content.serial.service.dto.SerialChoiceView
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
 * AI 자율 연재의 DB 쪽 규칙(설정·게시판·선택지 투표·제안 글·추천·선택지 생성·실행 선점·발행·실패)을 DB 없이 검증한다. 저장소는 메모리 대역이고, 작품 접근은 WorkAccessService와 같은 규칙(소유자 확인·공개 확인은 404)을 흉내 낸다.
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
    private val choiceRepo = mock(SerialChoiceRepository::class.java)
    private val proposalRepo = mock(SerialProposalRepository::class.java)
    private val likeRepo = mock(SerialProposalLikeRepository::class.java)
    private val voteRepo = mock(SerialVoteRepository::class.java)
    private val works = mock(WorkRepository::class.java)
    private val nicknames = mock(CoreNicknameService::class.java)
    private val service = SerialService(access, publication, episodes, episodeRepo, versions, settingRepo, boardRepo, choiceRepo, proposalRepo, likeRepo, voteRepo, works, nicknames)

    private val workRows = mutableMapOf<String, WorkEntity>()
    private val publicWorks = mutableSetOf<String>()
    private val settingRows = mutableMapOf<String, AiSerialEntity>()
    private val boardRows = mutableListOf<SerialBoardEntity>()
    private val choiceRows = mutableListOf<SerialChoiceEntity>()
    private val proposalRows = mutableListOf<SerialProposalEntity>()
    private val likeRows = mutableListOf<SerialProposalLikeEntity>()
    private val voteRows = mutableListOf<SerialVoteEntity>()
    private val names = mutableMapOf<String, String>()
    private var nextEpisode = 4
    private val active = setOf("open", "queued", "running")

    private fun anySetting() = ArgumentMatchers.any(AiSerialEntity::class.java) ?: AiSerialEntity()
    private fun anyBoard() = ArgumentMatchers.any(SerialBoardEntity::class.java) ?: SerialBoardEntity()
    private fun anyProposal() = ArgumentMatchers.any(SerialProposalEntity::class.java) ?: SerialProposalEntity()
    private fun anyLike() = ArgumentMatchers.any(SerialProposalLikeEntity::class.java) ?: SerialProposalLikeEntity()
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
        `when`(access.get(ArgumentMatchers.anyString())).thenAnswer { call -> workRows[call.arguments[0]]?.let { accessOf(it) } ?: throw ContentFailure(404, "작품을 찾을 수 없어요.") }
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

        `when`(choiceRepo.findAllByBoardId(ArgumentMatchers.anyString())).thenAnswer { call -> choiceRows.filter { it.boardId == call.arguments[0] } }
        `when`(choiceRepo.findById(ArgumentMatchers.anyString())).thenAnswer { call -> Optional.ofNullable(choiceRows.find { it.id == call.arguments[0] }) }
        `when`(choiceRepo.existsByBoardId(ArgumentMatchers.anyString())).thenAnswer { call -> choiceRows.any { it.boardId == call.arguments[0] } }
        `when`(choiceRepo.saveAll(ArgumentMatchers.anyCollection<SerialChoiceEntity>())).thenAnswer { call ->
            (call.arguments[0] as Collection<*>).map { it as SerialChoiceEntity }.also { rows -> rows.forEach { c -> if (choiceRows.none { it === c }) choiceRows.add(c) } }
        }

        `when`(proposalRepo.findAllByBoardId(ArgumentMatchers.anyString())).thenAnswer { call -> proposalRows.filter { it.boardId == call.arguments[0] } }
        `when`(proposalRepo.findById(ArgumentMatchers.anyString())).thenAnswer { call -> Optional.ofNullable(proposalRows.find { it.id == call.arguments[0] }) }
        `when`(proposalRepo.findTop200ByBoardIdAndHiddenFalseOrderByCreatedAtDescIdDesc(ArgumentMatchers.anyString())).thenAnswer { call ->
            proposalRows.filter { it.boardId == call.arguments[0] && !it.hidden }.sortedWith(compareByDescending<SerialProposalEntity> { it.createdAt }.thenByDescending { it.id }).take(200)
        }
        `when`(proposalRepo.save(anyProposal())).thenAnswer { call -> (call.arguments[0] as SerialProposalEntity).also { p -> if (proposalRows.none { it === p }) proposalRows.add(p) } }

        `when`(likeRepo.findAllByProposalIdIn(ArgumentMatchers.anyCollection<String>())).thenAnswer { call -> likeRows.filter { it.proposalId in (call.arguments[0] as Collection<*>) } }
        `when`(likeRepo.findByProposalIdAndMemberId(ArgumentMatchers.anyString(), ArgumentMatchers.anyString())).thenAnswer { call ->
            likeRows.find { it.proposalId == call.arguments[0] && it.memberId == call.arguments[1] }
        }
        `when`(likeRepo.saveAndFlush(anyLike())).thenAnswer { call -> (call.arguments[0] as SerialProposalLikeEntity).also { l -> if (likeRows.none { it === l }) likeRows.add(l) } }
        doAnswer { call -> likeRows.remove(call.arguments[0] as SerialProposalLikeEntity); null }.`when`(likeRepo).delete(anyLike())

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

    private fun accessOf(work: WorkEntity) = WorkAccessResult(work.id, work.ownerId, work.title, work.description, 1, "world", if (work.id in publicWorks) "public" else "private", false, false, null, work.restricted, work.deletedAt != null)
    private fun work(id: String = "w", ownerId: String = owner, public: Boolean = true, deleted: Boolean = false, restricted: Boolean = false) =
        WorkEntity(id = id, ownerId = ownerId, title = "작품 $id", description = "소개 $id", deletedAt = if (deleted) t0 else null, restricted = restricted).also {
            workRows[id] = it
            if (public) publicWorks.add(id)
        }
    private fun serial(workId: String = "w", enabled: Boolean = true, days: String = "MON", time: LocalTime = LocalTime.of(21, 0), last: LocalDate? = null, direction: String = "") =
        AiSerialEntity(workId, enabled, days, time, direction, last, t0).also { settingRows[workId] = it }
    private fun board(id: String = "b1", workId: String = "w", number: Int = 4, status: String = "open", at: Instant = t0.minusSeconds(3600)) =
        SerialBoardEntity(id = id, workId = workId, episodeNumber = number, status = status, openedAt = at).also { boardRows.add(it) }
    private fun proposal(id: String, boardId: String = "b1", author: String = "author-$id", kind: String = "general", hidden: Boolean = false, at: Long = 100, simulation: Map<String, Any?>? = null) =
        SerialProposalEntity(id = id, boardId = boardId, authorId = author, kind = kind, title = "제목 $id", body = "본문 $id", simulation = simulation, hidden = hidden, createdAt = Instant.ofEpochSecond(at)).also { proposalRows.add(it) }
    private fun like(member: String, proposalId: String) = SerialProposalLikeEntity(proposalId, member).also { likeRows.add(it) }
    /** 게시판의 선택지 4개(c1~c4, 번호 1~4)다. 다른 게시판에는 [prefix]로 id를 구분한다. */
    private fun choices(boardId: String = "b1", prefix: String = "c") = (1..4).map { SerialChoiceEntity(id = prefix + it, boardId = boardId, position = it, text = "선택지 " + prefix + it).also { c -> choiceRows.add(c) } }
    private fun vote(member: String, choiceId: String, boardId: String = "b1") = SerialVoteEntity(boardId, member, choiceId).also { voteRows.add(it) }
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

        // 처음 저장한 작품은 꺼짐이다: 켜기는 운영 설정의 집필 방식(autonomous)이 한다.
        assertEquals(SerialSettingsResponse(false, listOf("MON", "WED"), "07:30", "따뜻한 분위기로"), saved)
        assertEquals(saved, service.settings("w", owner))
        assertEquals("MON,WED", settingRows.getValue("w").days)
        assertEquals(LocalTime.of(7, 30), settingRows.getValue("w").runTime)
        assertTrue(boardRows.isEmpty())
    }

    @Test fun `saving ignores the enabled flag in both directions`() {
        work()
        val on = serial(enabled = true, days = "MON")
        val before = board()

        // 요청의 enabled는 받지 않는다: 켜진 설정은 enabled=false를 보내도 꺼지지 않고 게시판도 그대로다.
        assertTrue(service.saveSettings("w", owner, request(enabled = false, days = listOf("TUE"))).enabled)
        assertEquals(listOf<Any?>(true, "TUE", "open"), listOf(on.enabled, on.days, before.status))

        // 꺼진 설정은 enabled=true를 보내도 켜지지 않고 게시판도 열리지 않는다.
        boardRows.clear(); settingRows.clear()
        val off = serial(enabled = false, days = "MON")
        assertFalse(service.saveSettings("w", owner, request(enabled = true, days = listOf("TUE"))).enabled)
        assertEquals(listOf<Any?>(false, "TUE", true), listOf(off.enabled, off.days, boardRows.isEmpty()))
    }

    @Test fun `turning it on creates the settings row with defaults and opens the board for the next episode`() {
        work()
        nextEpisode = 4

        service.setEnabled("w", true)

        val row = settingRows.getValue("w")
        assertEquals(listOf<Any?>(true, "", LocalTime.of(21, 0), ""), listOf(row.enabled, row.days, row.runTime, row.direction))
        val opened = boardRows.single()
        assertEquals(listOf("w", 4, "open"), listOf(opened.workId, opened.episodeNumber, opened.status))
        assertNull(opened.closedAt)
    }

    @Test fun `turning it on keeps the saved schedule and does not open a second board`() {
        work()
        val row = serial(enabled = false, days = "MON,WED", time = LocalTime.of(7, 30), direction = "방향")
        val existing = board(status = "running")

        service.setEnabled("w", true)
        service.setEnabled("w", true)

        assertEquals(listOf<Any?>(true, "MON,WED", LocalTime.of(7, 30), "방향"), listOf(row.enabled, row.days, row.runTime, row.direction))
        assertEquals(listOf(existing), boardRows)
    }

    @Test fun `no board opens before the first episode is published and a run then has no board`() {
        work()
        nextEpisode = 1

        service.setEnabled("w", true)

        // AI는 1화를 쓰지 않는다: 발행된 회차가 없으면 게시판이 없고 지금 실행은 409 SERIAL_NO_BOARD다.
        assertTrue(boardRows.isEmpty())
        assertTrue(settingRows.getValue("w").enabled)
        assertEquals(listOf<Any?>(409, "SERIAL_NO_BOARD"), status { service.run("w", owner) }.let { listOf(it.status, it.code) })
    }

    @Test fun `turning it off while a run is queued or running is refused and changes nothing`() {
        for (state in listOf("queued", "running")) {
            boardRows.clear(); settingRows.clear()
            work(); val row = serial(direction = "그대로"); val active = board(status = state)

            val failure = status { service.setEnabled("w", false) }

            assertEquals(listOf<Any?>(409, "SERIAL_RUNNING"), listOf(failure.status, failure.code), state)
            assertEquals(listOf<Any?>(true, "그대로", state), listOf(row.enabled, row.direction, active.status), state)
        }
    }

    @Test fun `turning it off when it is already off or was never set is not a turn-off even with a run board left over`() {
        for (state in listOf("queued", "running")) {
            boardRows.clear(); settingRows.clear()
            work(); val row = serial(enabled = false, days = "MON"); val leftover = board(status = state)

            service.setEnabled("w", false)

            assertEquals(listOf<Any?>(false, "MON", state), listOf(row.enabled, row.days, leftover.status), state)
        }
        boardRows.clear(); settingRows.clear()
        work()

        service.setEnabled("w", false)

        assertTrue(settingRows.isEmpty())
    }

    @Test fun `turning it off while only an open board waits works and leaves that board open`() {
        work(); serial()
        val open = board()

        service.setEnabled("w", false)

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

    // ---- 제안 글

    private fun general(title: String = "제목", body: String = "본문") = CleanProposal("general", title, body, null, emptyList())

    @Test fun `a member may write any number of proposals on one board`() {
        work()
        board()

        val first = service.add("w", alice, general("첫 글"))
        service.add("w", alice, general("두 번째 글"))
        service.add("w", bob, general("다른 회원"))

        assertEquals(listOf("alice", "alice", "bob"), proposalRows.map { it.authorId })
        assertEquals(listOf("첫 글", "두 번째 글", "다른 회원"), proposalRows.map { it.title })
        assertEquals(first.id, proposalRows.first().id)
        assertEquals(3, proposalRows.map { it.id }.toSet().size)
    }

    @Test fun `a proposal is saved on the open board with its kind title and text`() {
        work()
        board(status = "published")
        proposal("old", boardId = "b1", author = alice)
        board(id = "b2", number = 5)

        service.add("w", alice, general("새 글", "새 본문"))

        val saved = proposalRows.last()
        assertEquals(listOf("b2", "general", "새 글", "새 본문", false), listOf(saved.boardId, saved.kind, saved.title, saved.body, saved.hidden))
        assertEquals(listOf("b1", "b2"), proposalRows.map { it.boardId })
    }

    @Test fun `only an open board takes proposals`() {
        work()
        assertEquals("SERIAL_NO_BOARD", status { service.add("w", alice, general()) }.code)
        val active = board(status = "queued")
        assertEquals("SERIAL_NO_BOARD", status { service.add("w", alice, general()) }.code)
        active.status = "running"
        assertEquals("SERIAL_NO_BOARD", status { service.add("w", alice, general()) }.code)
        assertTrue(proposalRows.isEmpty())
    }

    @Test fun `a non-public or missing work takes no proposals votes or likes`() {
        work("hidden", public = false)
        board(workId = "hidden")

        assertEquals(404, status { service.add("hidden", alice, general()) }.status)
        assertEquals(404, status { service.add("missing", alice, general()) }.status)
        assertEquals(404, status { service.vote("hidden", alice, "c1") }.status)
        assertEquals(404, status { service.like("hidden", alice, "p1") }.status)
        assertEquals(404, status { service.unlike("hidden", alice, "p1") }.status)
        assertEquals(404, status { service.board("hidden", null) }.status)
        assertTrue(proposalRows.isEmpty())
    }

    @Test fun `the owner may write a proposal on their own board`() {
        work()
        board()

        service.add("w", owner, general("작가 글"))

        assertEquals(owner, proposalRows.single().authorId)
    }

    @Test fun `a simulation proposal keeps its premise beats and scene and a general one keeps none`() {
        work()
        board()

        service.add("w", alice, CleanProposal("simulation", "폐교 장면", "전제 그대로", "전제 그대로", listOf("비트1", "비트2")), "장면 미리보기")
        service.add("w", bob, general())

        val sim = proposalRows.first { it.authorId == alice }
        assertEquals(listOf("simulation", "폐교 장면"), listOf(sim.kind, sim.title))
        assertEquals(mapOf("premise" to "전제 그대로", "beats" to listOf("비트1", "비트2"), "scene" to "장면 미리보기"), sim.simulation)
        assertNull(proposalRows.first { it.authorId == bob }.simulation)
    }

    @Test fun `a simulation proposal is not saved on another board than the one it was made for`() {
        work()
        board(id = "b1", number = 4, status = "published")
        board(id = "b2", number = 5)
        val simulation = CleanProposal("simulation", "제목", "전제", "전제", emptyList())

        // AI를 기다리는 사이 b1이 발행돼 다음 게시판 b2가 열렸다: 이전 회차 문맥으로 만든 장면을 b2에 저장하지 않는다(러너가 예약을 해제한다).
        val failure = status { service.add("w", alice, simulation, "장면", "b1") }

        assertEquals(listOf(409, "SERIAL_NO_BOARD"), listOf(failure.status, failure.code))
        assertTrue(proposalRows.isEmpty())
        // 처음 본 게시판이 지금도 열려 있으면 그대로 저장한다.
        service.add("w", alice, simulation, "장면", "b2")
        assertEquals(listOf("b2"), proposalRows.map { it.boardId })
    }

    @Test fun `checking before a simulation returns the open board and needs one`() {
        work()
        assertEquals("SERIAL_NO_BOARD", status { service.openBoardFor("w") }.code)
        val open = board(number = 5)
        // 제안 글은 개수 제한이 없어 이미 쓴 회원도 다시 쓸 수 있다.
        proposal("p1", author = alice)

        val ready = service.openBoardFor("w")

        assertEquals(listOf(open.id, 5, "작품 w", "소개 w"), listOf(ready.boardId, ready.episodeNumber, ready.title, ready.summary))
    }

    // ---- 투표(선택지)

    @Test fun `a vote is created moved and repeated without a second row`() {
        work()
        board(); choices()

        service.vote("w", alice, "c1")
        service.vote("w", alice, "c1")
        assertEquals(listOf("c1"), voteRows.map { it.choiceId })

        service.vote("w", alice, "c2")
        assertEquals(listOf("c2"), voteRows.map { it.choiceId })
        service.vote("w", bob, "c2")
        assertEquals(2, voteRows.size)
        assertEquals(listOf("c2", "c2"), voteRows.map { it.choiceId })
    }

    @Test fun `a vote may be cancelled and cancelling without one is harmless`() {
        work()
        board(); choices()
        vote(alice, "c1")

        service.cancelVote("w", alice)
        service.cancelVote("w", alice)
        service.cancelVote("w", bob)

        assertTrue(voteRows.isEmpty())
    }

    @Test fun `the owner votes like any member`() {
        work()
        board(); choices()

        service.vote("w", owner, "c3")

        assertEquals(listOf(owner, "c3"), voteRows.single().let { listOf(it.memberId, it.choiceId) })
    }

    @Test fun `choices of another board or unknown choices cannot be voted for`() {
        work()
        board()
        board(id = "elsewhere", workId = "w", status = "published", number = 3)
        choices(); choices(boardId = "elsewhere", prefix = "x")

        for (target in listOf("x1", "unknown")) assertEquals(404, status { service.vote("w", alice, target) }.status, target)
        assertTrue(voteRows.isEmpty())
    }

    @Test fun `a board without choices has nothing to vote for`() {
        work()
        board()

        assertEquals(404, status { service.vote("w", alice, "c1") }.status)
    }

    @Test fun `votes need an open board`() {
        work()
        choices()
        assertEquals("SERIAL_NO_BOARD", status { service.vote("w", alice, "c1") }.code)
        assertEquals("SERIAL_NO_BOARD", status { service.cancelVote("w", alice) }.code)
        board(status = "queued")
        assertEquals("SERIAL_NO_BOARD", status { service.vote("w", alice, "c1") }.code)
        assertTrue(voteRows.isEmpty())
    }

    @Test fun `a concurrent first vote by the same member is a conflict and not a server error`() {
        work()
        board(); choices()
        // 사전 조회는 비어 있었지만 저장 순간 다른 요청이 같은 회원의 첫 표를 먼저 넣은 경우(기본키가 마지막 방어)
        doThrow(DataIntegrityViolationException("serial_vote_pkey")).`when`(voteRepo).saveAndFlush(anyVote())

        val failure = status { service.vote("w", alice, "c1") }

        assertEquals(listOf(409, "VOTE_CONFLICT"), listOf(failure.status, failure.code))
        assertTrue(voteRows.isEmpty())
    }

    // ---- 추천

    @Test fun `a like is created once and repeated without a second row`() {
        work()
        board(); proposal("a"); proposal("b")

        service.like("w", alice, "a")
        service.like("w", alice, "a")
        assertEquals(listOf(listOf("a", alice)), likeRows.map { listOf(it.proposalId, it.memberId) })

        service.like("w", alice, "b")
        service.like("w", bob, "a")
        assertEquals(setOf("a" to alice, "b" to alice, "a" to bob), likeRows.map { it.proposalId to it.memberId }.toSet())
        assertEquals(3, likeRows.size)
    }

    @Test fun `a like may be cancelled and cancelling without one is harmless`() {
        work()
        board(); proposal("a")
        like(alice, "a"); like(bob, "a")

        service.unlike("w", alice, "a")
        service.unlike("w", alice, "a")
        service.unlike("w", "carol", "a")

        assertEquals(listOf(bob), likeRows.map { it.memberId })
    }

    @Test fun `a member may like their own proposal`() {
        work()
        board(); proposal("mine", author = alice)

        service.like("w", alice, "mine")

        assertEquals("mine", likeRows.single().proposalId)
    }

    @Test fun `hidden foreign or unknown proposals cannot be liked or unliked`() {
        work()
        board()
        board(id = "elsewhere", workId = "w", status = "published", number = 3)
        proposal("hidden", hidden = true)
        proposal("foreign", boardId = "elsewhere")

        for (target in listOf("hidden", "foreign", "unknown")) {
            assertEquals(404, status { service.like("w", alice, target) }.status, target)
            assertEquals(404, status { service.unlike("w", alice, target) }.status, target)
        }
        assertTrue(likeRows.isEmpty())
    }

    @Test fun `likes need an open board`() {
        work()
        proposal("a")
        assertEquals("SERIAL_NO_BOARD", status { service.like("w", alice, "a") }.code)
        assertEquals("SERIAL_NO_BOARD", status { service.unlike("w", alice, "a") }.code)
        board(status = "running")
        assertEquals("SERIAL_NO_BOARD", status { service.like("w", alice, "a") }.code)
        assertTrue(likeRows.isEmpty())
    }

    @Test fun `a concurrent first like by the same member is a conflict and not a server error`() {
        work()
        board(); proposal("a")
        doThrow(DataIntegrityViolationException("serial_proposal_like_pkey")).`when`(likeRepo).saveAndFlush(anyLike())

        val failure = status { service.like("w", alice, "a") }

        assertEquals(listOf(409, "LIKE_CONFLICT"), listOf(failure.status, failure.code))
        assertTrue(likeRows.isEmpty())
    }

    // ---- 숨김

    @Test fun `the owner hides a proposal and only that one`() {
        work()
        board()
        val bad = proposal("bad"); val good = proposal("good")

        service.hide("w", owner, "bad")

        assertEquals(listOf(true, false), listOf(bad.hidden, good.hidden))
    }

    @Test fun `a proposal of another work cannot be hidden`() {
        work(); work("other", ownerId = "someone")
        board(); board(id = "ob", workId = "other")
        val foreign = proposal("x", boardId = "ob")

        assertEquals(404, status { service.hide("w", owner, "x") }.status)
        assertEquals(404, status { service.hide("w", owner, "unknown") }.status)
        assertFalse(foreign.hidden)
    }

    // ---- 독자 게시판

    @Test fun `an anonymous reader sees the choices in order and the proposals newest first with names and counts`() {
        work(); serial()
        val open = board(number = 5)
        choices()
        proposal("first", author = "u1", at = 10)
        proposal("second", author = "u2", at = 20)
        proposal("popular", author = "u3", at = 30, kind = "simulation", simulation = mapOf("premise" to "전제", "beats" to listOf("비트"), "scene" to "장면"))
        vote("v1", "c3"); vote("v2", "c3"); vote("v3", "c2")
        like("v1", "popular"); like("v2", "popular"); like("v3", "first")
        names["u1"] = "하나"; names["u2"] = "둘"; names["u3"] = "셋"

        val view = service.board("w", null)

        assertTrue(view.enabled)
        assertEquals(SerialBoardRef(open.id, 5), view.board)
        // 선택지는 득표와 상관없이 번호순이다.
        assertEquals(listOf(SerialChoiceView("c1", 1, "선택지 c1", 0), SerialChoiceView("c2", 2, "선택지 c2", 1), SerialChoiceView("c3", 3, "선택지 c3", 2), SerialChoiceView("c4", 4, "선택지 c4", 0)), view.choices)
        // 제안 글은 최신순이다(추천 수와 상관없음).
        assertEquals(listOf("popular", "second", "first"), view.proposals.map { it.id })
        assertEquals(listOf(2, 0, 1), view.proposals.map { it.likes })
        assertEquals(listOf("셋", "둘", "하나"), view.proposals.map { it.authorName })
        assertEquals(listOf("제목 popular", "제목 second", "제목 first"), view.proposals.map { it.title })
        assertEquals(listOf("본문 popular", "본문 second", "본문 first"), view.proposals.map { it.body })
        assertEquals(SerialSimulationView("전제", listOf("비트"), "장면"), view.proposals.first().simulation)
        assertNull(view.proposals[1].simulation)
        assertEquals(Instant.ofEpochSecond(30), view.proposals.first().createdAt)
        assertEquals(listOf(null, null), listOf(view.myChoiceId, view.summary))
        assertEquals(listOf(false, false, false), view.proposals.map { it.likedByMe })
        assertEquals(listOf(false, false, false), view.proposals.map { it.mine })
    }

    @Test fun `a logged-in member gets their own vote likes and authorship`() {
        work()
        board(); choices()
        proposal("mine", author = alice, at = 10); proposal("other", author = bob, at = 20)
        vote(alice, "c4"); vote(bob, "c1")
        like(alice, "other"); like(bob, "mine"); like(bob, "other")
        names[alice] = "앨리스"; names[bob] = "밥"

        val view = service.board("w", alice)

        assertEquals("c4", view.myChoiceId)
        assertEquals(listOf("other", "mine"), view.proposals.map { it.id })
        assertEquals(listOf(true, false), view.proposals.map { it.likedByMe })
        assertEquals(listOf(false, true), view.proposals.map { it.mine })
        assertEquals(listOf(2, 1), view.proposals.map { it.likes })
        // 다른 회원의 투표는 내 투표가 아니다.
        assertEquals("c1", service.board("w", bob).myChoiceId)
        assertNull(service.board("w", "carol").myChoiceId)
    }

    @Test fun `members who left Core show as withdrawn`() {
        work()
        board()
        proposal("gone", author = "ghost")

        assertEquals("탈퇴한 회원", service.board("w", null).proposals.single().authorName)
    }

    @Test fun `hidden proposals leave the list`() {
        work()
        board()
        proposal("bad", author = alice, hidden = true); proposal("fine", author = bob)
        like(bob, "bad")

        val forAlice = service.board("w", alice)

        assertEquals(listOf("fine"), forAlice.proposals.map { it.id })
        assertEquals(listOf(false), forAlice.proposals.map { it.mine })
    }

    @Test fun `an open board without choices yet shows an empty choice list but still takes votes later`() {
        work(); serial()
        board()
        proposal("a")

        val view = service.board("w", alice)

        assertEquals(emptyList<SerialChoiceView>(), view.choices)
        assertNull(view.myChoiceId)
        assertEquals(1, view.proposals.size)
        assertNotNull(view.board)
    }

    @Test fun `there is no board while one is queued or running and the summary is the last published one`() {
        work(); serial()
        board(id = "old", status = "published", number = 2, at = t0.minusSeconds(9000)).summary = "옛 종합"
        board(id = "last", status = "published", number = 3, at = t0.minusSeconds(5000)).summary = "마지막 종합"
        board(id = "failed", status = "failed", number = 4, at = t0.minusSeconds(100))
        board(id = "now", status = "queued", number = 4, at = t0.minusSeconds(50))
        choices(boardId = "now"); proposal("a", boardId = "now")

        val view = service.board("w", null)

        assertTrue(view.enabled)
        assertNull(view.board)
        assertEquals(emptyList<Any>(), view.choices)
        assertEquals(emptyList<Any>(), view.proposals)
        assertEquals("마지막 종합", view.summary)
    }

    @Test fun `a work without any board has an empty reader view and enabled follows the serial switch`() {
        work()

        val view = service.board("w", alice)

        assertEquals(listOf(false, null, null), listOf(view.enabled, view.board, view.summary))
        assertEquals(listOf<Any>(), view.choices + view.proposals)
        assertNull(view.myChoiceId)
        serial(enabled = true)
        assertTrue(service.board("w", alice).enabled)
        serial(enabled = false)
        assertFalse(service.board("w", alice).enabled)
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

    @Test fun `the run input holds the top choice the top three proposals the owner and the direction`() {
        work()
        serial(direction = "따뜻하게")
        board(number = 4)
        choices()
        proposal("a", at = 1); proposal("b", at = 2); proposal("c", at = 3); proposal("d", at = 4); proposal("hid", at = 0, hidden = true)
        vote("m1", "c3"); vote("m2", "c3"); vote("m3", "c2")
        like("m1", "d"); like("m2", "d"); like("m3", "b"); like("m4", "hid"); like("m5", "hid"); like("m6", "hid")

        val input = service.runInput("b1")

        assertEquals(listOf("w", "b1", owner, "작품 w", "소개 w", 4, "따뜻하게"), listOf(input.workId, input.boardId, input.owner, input.title, input.summary, input.number, input.direction))
        assertEquals(listOf("c3", 2), listOf(input.choice!!.choice.id, input.choice.votes))
        assertEquals(listOf("d", "b", "a"), input.proposals.map { it.proposal.id })
        assertEquals(listOf(2, 1, 0), input.proposals.map { it.likes })
    }

    @Test fun `the top choice is number one without votes the smaller number on a tie and none without choices`() {
        work(); serial(); board(number = 4)
        // 선택지를 만들지 못한 게시판은 선택지 없이(null) 실행한다.
        assertNull(service.runInput("b1").choice)
        assertEquals(emptyList<Any>(), service.runInput("b1").proposals)

        choices()
        assertEquals(listOf("c1", 0), service.runInput("b1").choice!!.let { listOf(it.choice.id, it.votes) })

        vote("m1", "c4"); vote("m2", "c2"); vote("m3", "c4"); vote("m4", "c2")
        assertEquals(listOf("c2", 2), service.runInput("b1").choice!!.let { listOf(it.choice.id, it.votes) })
    }

    @Test fun `the run input moves the target when a human published the episode meanwhile`() {
        work(); serial(); val running = board(number = 4, status = "running")
        nextEpisode = 5

        val input = service.runInput("b1")

        assertEquals(5, input.number)
        assertEquals(5, running.episodeNumber)
    }

    @Test fun `the run input is refused when no episode is published so the AI never writes episode one`() {
        work(); serial(); board(status = "running")
        nextEpisode = 1

        val failure = status { service.runInput("b1") }

        assertEquals(listOf<Any?>(409, "SERIAL_NO_BOARD"), listOf(failure.status, failure.code))
    }

    @Test fun `the run input is refused for a deleted work`() {
        work(deleted = true); serial(); board(status = "running")

        assertEquals(404, status { service.runInput("b1") }.status)
    }

    // ---- 선택지 생성

    private fun minutesAgo(minutes: Long) = t0.minusSeconds(minutes * 60)
    private val four = listOf("가", "나", "다", "라")

    @Test fun `choice targets are open boards of enabled works without choices that were never tried or tried ten minutes ago`() {
        work("fresh"); work("never"); work("old"); work("exact"); work("has"); work("off"); work("queued"); work("gone", deleted = true)
        serial("never"); board("b-never", "never")
        serial("old"); board("b-old", "old").choicesTriedAt = minutesAgo(11)
        serial("exact"); board("b-exact", "exact").choicesTriedAt = minutesAgo(10)
        serial("fresh"); board("b-fresh", "fresh").choicesTriedAt = minutesAgo(9)
        serial("has"); board("b-has", "has"); choices("b-has")
        serial("off", enabled = false); board("b-off", "off")
        serial("queued"); board("b-queued", "queued", status = "queued")
        serial("gone"); board("b-gone", "gone")

        assertEquals(setOf("b-never", "b-old", "b-exact"), service.choiceTargets(t0).map { it.id }.toSet())
    }

    @Test fun `starting choices takes the work lock records the attempt time and returns the input`() {
        work(); serial(direction = "따뜻하게")
        val open = board(number = 5)

        val input = service.beginChoices("w", "b1", t0)

        assertEquals(ChoiceInput("w", "b1", owner, "작품 w", "소개 w", 5, "따뜻하게"), input)
        assertEquals(t0, open.choicesTriedAt)
        verify(access).lockScope("w")
    }

    @Test fun `starting choices again within ten minutes or once choices exist returns nothing and changes nothing`() {
        work(); serial()
        val open = board()

        // 10분 안에 시도했다(실패해도 시도 시각은 남는다).
        open.choicesTriedAt = minutesAgo(9)
        assertNull(service.beginChoices("w", "b1", t0))
        assertEquals(minutesAgo(9), open.choicesTriedAt)
        // 10분이 지났으면 다시 시도한다.
        open.choicesTriedAt = minutesAgo(10)
        assertNotNull(service.beginChoices("w", "b1", t0))
        assertEquals(t0, open.choicesTriedAt)
        // 이미 선택지가 있다.
        open.choicesTriedAt = null
        choices()
        assertNull(service.beginChoices("w", "b1", t0))
        assertNull(open.choicesTriedAt)
    }

    @Test fun `starting choices needs a publicly visible work so a private or restricted work gets none and keeps no attempt`() {
        work("priv", public = false); serial("priv"); val closed = board("b-priv", "priv")
        work("limited", restricted = true); serial("limited"); val limited = board("b-limited", "limited")

        // 선택지는 독자에게 보이는 게시판에만 만든다: 독자가 읽을 수 없는 작품(비공개·제한)에는 시도하지도 크레딧을 쓰지도 않는다.
        assertNull(service.beginChoices("priv", "b-priv", t0))
        assertNull(service.beginChoices("limited", "b-limited", t0))
        assertEquals(listOf(null, null), listOf(closed.choicesTriedAt, limited.choicesTriedAt))
    }

    @Test fun `starting choices needs an enabled serial and a live work and an open board of that work`() {
        work(); val row = serial(enabled = false); val open = board()
        assertNull(service.beginChoices("w", "b1", t0))
        row.enabled = true

        open.status = "queued"
        assertNull(service.beginChoices("w", "b1", t0))
        open.status = "open"
        work("other"); serial("other")
        assertNull(service.beginChoices("other", "b1", t0))
        assertNull(service.beginChoices("w", "unknown", t0))

        work("gone", deleted = true); serial("gone"); val goneBoard = board("g1", "gone")
        assertNull(service.beginChoices("gone", "g1", t0))
        assertEquals(listOf(null, null), listOf(open.choicesTriedAt, goneBoard.choicesTriedAt))
    }

    @Test fun `saving choices numbers them one to four on the open board after taking the work lock`() {
        work(); board()

        service.saveChoices("w", "b1", four)

        assertEquals(listOf(1 to "가", 2 to "나", 3 to "다", 4 to "라"), choiceRows.map { it.position to it.text })
        assertEquals(List(4) { "b1" }, choiceRows.map { it.boardId })
        assertEquals(4, choiceRows.map { it.id }.toSet().size)
        verify(access).lockScope("w")
    }

    @Test fun `saving choices is refused when the board is no longer open or already has choices`() {
        work(); work("other")
        val open = board()
        for (state in listOf("queued", "running", "published", "failed")) {
            open.status = state
            assertEquals("SERIAL_NO_BOARD", status { service.saveChoices("w", "b1", four) }.code, state)
        }
        open.status = "open"
        assertEquals("SERIAL_NO_BOARD", status { service.saveChoices("w", "unknown", four) }.code)
        assertEquals("SERIAL_NO_BOARD", status { service.saveChoices("other", "b1", four) }.code)
        assertTrue(choiceRows.isEmpty())
        choices()
        assertEquals(409, status { service.saveChoices("w", "b1", four) }.status)
        assertEquals(4, choiceRows.size)
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

    @Test fun `failing records the reason closes the board and reopens it for the same episode with its choices proposals and votes`() {
        work(); serial()
        val running = board(number = 4, status = "running").also { it.closedAt = t0.minusSeconds(60); it.choicesTriedAt = t0.minusSeconds(300) }
        val moved = choices()
        val a = proposal("a", author = alice); val b = proposal("b", author = bob)
        like(alice, "b"); like(bob, "b")
        vote(alice, "c2"); vote(bob, "c2")

        service.fail("b1", "크레딧이 부족합니다.", t0)

        assertEquals(listOf("failed", "크레딧이 부족합니다.", t0.minusSeconds(60)), listOf(running.status, running.failureReason, running.closedAt))
        val retry = boardRows.single { it !== running }
        assertEquals(listOf("open", 4, "w"), listOf(retry.status, retry.episodeNumber, retry.workId))
        // 선택지 시도 시각을 이어받아 새 게시판이 곧바로 선택지를 다시 만들지 않는다.
        assertEquals(t0.minusSeconds(300), retry.choicesTriedAt)
        assertEquals(List(4) { retry.id }, moved.map { it.boardId })
        assertEquals(listOf(retry.id, retry.id), listOf(a.boardId, b.boardId))
        assertEquals(listOf(retry.id, retry.id), voteRows.map { it.boardId })
        assertEquals(listOf("c2", "c2"), voteRows.map { it.choiceId })
        assertEquals(listOf(alice, bob), voteRows.map { it.memberId })
        // 추천은 글을 따라간다: 행은 그대로이고 글이 새 게시판으로 옮겨졌다.
        assertEquals(listOf("b", "b"), likeRows.map { it.proposalId })
        val order = inOrder(boardRepo)
        order.verify(boardRepo).saveAndFlush(running)
        order.verify(boardRepo).saveAndFlush(retry)
    }

    @Test fun `failing a board whose serial was turned off reopens nothing`() {
        work(); serial(enabled = false)
        val running = board(status = "running")
        val a = proposal("a")
        val moved = choices()

        service.fail("b1", "AI 생성에 실패했습니다.", t0)

        assertEquals("failed", running.status)
        assertEquals(1, boardRows.size)
        assertEquals("b1", a.boardId)
        assertEquals(List(4) { "b1" }, moved.map { it.boardId })
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
