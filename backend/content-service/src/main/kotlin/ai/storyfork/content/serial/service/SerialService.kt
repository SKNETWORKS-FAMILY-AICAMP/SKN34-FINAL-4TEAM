package ai.storyfork.content.serial.service

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content._common.exception.checkContent
import ai.storyfork.content._common.helper.contentId
import ai.storyfork.content.auth.service.CoreNicknameService
import ai.storyfork.content.auth.service.WITHDRAWN_MEMBER_NAME
import ai.storyfork.content.episode.repository.EpisodeRepository
import ai.storyfork.content.episode.service.EpisodeService
import ai.storyfork.content.episode.service.dto.CreateEpisodeRequest
import ai.storyfork.content.episode.service.dto.DraftRequest
import ai.storyfork.content.episode_version.service.EpisodeVersionService
import ai.storyfork.content.publication.service.PublicationService
import ai.storyfork.content.serial.client.GeneratedEpisode
import ai.storyfork.content.serial.domain.CleanOpinion
import ai.storyfork.content.serial.domain.RankedOpinion
import ai.storyfork.content.serial.domain.SerialReason
import ai.storyfork.content.serial.domain.STALE_RUNNING_MINUTES
import ai.storyfork.content.serial.domain.cleanSettings
import ai.storyfork.content.serial.domain.isSerialDue
import ai.storyfork.content.serial.domain.rankOpinions
import ai.storyfork.content.serial.domain.serialDaySet
import ai.storyfork.content.serial.domain.topOpinions
import ai.storyfork.content.serial.entity.AiSerialEntity
import ai.storyfork.content.serial.entity.SerialBoardEntity
import ai.storyfork.content.serial.entity.SerialOpinionEntity
import ai.storyfork.content.serial.entity.SerialVoteEntity
import ai.storyfork.content.serial.repository.AiSerialRepository
import ai.storyfork.content.serial.repository.SerialBoardRepository
import ai.storyfork.content.serial.repository.SerialOpinionRepository
import ai.storyfork.content.serial.repository.SerialVoteRepository
import ai.storyfork.content.serial.service.dto.SerialBoardRecord
import ai.storyfork.content.serial.service.dto.SerialBoardRef
import ai.storyfork.content.serial.service.dto.SerialBoardResponse
import ai.storyfork.content.serial.service.dto.SerialOpinionCreated
import ai.storyfork.content.serial.service.dto.SerialOpinionView
import ai.storyfork.content.serial.service.dto.SerialSettingsRequest
import ai.storyfork.content.serial.service.dto.SerialSettingsResponse
import ai.storyfork.content.serial.service.dto.SerialSimulationView
import ai.storyfork.content.work.repository.WorkRepository
import ai.storyfork.content.work.service.WorkAccessService
import java.time.Instant
import java.time.LocalDate
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

/** 의견을 받을 수 있는 열린 게시판과 그 작품의 표시 정보다. 시뮬레이션이 AI를 부르기 전에 확인한 값이다. */
data class OpenBoard(val boardId: String, val episodeNumber: Int, val title: String, val summary: String)

/** 회차 실행에 쓰는 입력이다: 소유자·연재 방향·득표 상위 의견과, 실행 시점의 다음 회차 번호다. */
data class RunInput(
    val workId: String, val boardId: String, val owner: String, val title: String, val summary: String, val number: Int, val direction: String, val opinions: List<RankedOpinion>,
)

private val HH_MM = DateTimeFormatter.ofPattern("HH:mm")
private val ACTIVE = listOf("open", "queued", "running")
private val RUNNING = listOf("queued", "running")

private fun conflict(code: String, message: String) = ContentFailure(409, message, code)

/**
 * AI 자율 연재(UC-18)의 DB 쪽 규칙이다: 설정, 회차마다 열리는 의견 게시판, 의견·투표·숨김, 지금 실행 요청, 그리고 일정 점검([SerialRunner])이 쓰는 실행 선점·발행·실패 처리.
 * 외부 호출(Core 크레딧·AI)은 여기서 하지 않는다: 이 서비스의 메서드는 모두 짧은 트랜잭션이라 AI를 기다리는 동안 DB 트랜잭션·잠금을 열지 않는다.
 * 쓰기는 작품 소유 확인([WorkAccessService.own])이 작품 행을 잠근 뒤에 하며 단일 서버를 전제한다(다중 서버 분산 잠금은 하지 않는다).
 */
@Service
@Transactional(transactionManager = "contentTransactionManager")
class SerialService(
    private val access: WorkAccessService,
    private val publication: PublicationService,
    private val episodes: EpisodeService,
    private val episodeRepo: EpisodeRepository,
    private val versions: EpisodeVersionService,
    private val serialRepo: AiSerialRepository,
    private val boardRepo: SerialBoardRepository,
    private val opinionRepo: SerialOpinionRepository,
    private val voteRepo: SerialVoteRepository,
    private val works: WorkRepository,
    private val nicknames: CoreNicknameService,
) {
    // ---- 설정

    /** 소유자의 설정이다. 저장한 적이 없으면 꺼짐 기본값이다. */
    fun settings(workId: String, owner: String): SerialSettingsResponse {
        access.own(workId, owner)
        return serialRepo.findById(workId).orElse(null)?.response() ?: SerialSettingsResponse(false, emptyList(), "21:00", "")
    }

    /**
     * 요일·시각·방향을 저장한다(세계관 연결은 필요 없다). 입력 오류(422)는 작품 확인(404)보다 먼저 판정한다. 요청의 enabled는 받지 않는다(있어도 무시):
     * 켜기·끄기는 운영 설정의 집필 방식(autonomous)이 하고 [setEnabled]가 받는다. 처음 저장한 작품은 꺼진 채 일정만 남고 게시판은 열지 않는다.
     */
    fun saveSettings(workId: String, owner: String, request: SerialSettingsRequest): SerialSettingsResponse {
        val clean = cleanSettings(request)
        access.own(workId, owner)
        val row = serialRepo.findById(workId).orElse(null) ?: AiSerialEntity(workId = workId)
        row.days = clean.days
        row.runTime = clean.runTime
        row.direction = clean.direction
        row.updatedAt = Instant.now().truncatedTo(ChronoUnit.MICROS)
        serialRepo.save(row)
        return row.response()
    }

    /**
     * 집필 방식이 autonomous가 되면 켜고 다른 방식이 되면 끈다. [ai.storyfork.content.work.service.WorkSettingsService]가 소유 확인(작품 잠금)을 쥔 같은 트랜잭션에서 부른다.
     * 처음 켜는 작품은 기본값(요일 없음·21:00·방향 없음)으로 설정 행을 만들고, 켜지면 발행된 회차가 있을 때 다음 회차 게시판을 연다(발행된 회차가 없으면 열지 않는다: AI는 1화를 쓰지 않는다).
     * 켜짐에서 끄려는데 실행 중(queued·running)이면 409 SERIAL_RUNNING이다(켜진 동안은 소유자가 2화부터 못 바꾸므로 실행이 저장·발행하는 도중에 잠금이 풀리지 않게 한다). 이미 그 상태면 아무것도 하지 않는다.
     */
    fun setEnabled(workId: String, enabled: Boolean) {
        val existing = serialRepo.findById(workId).orElse(null)
        if ((existing?.enabled ?: false) == enabled) return
        if (!enabled && boardRepo.findFirstByWorkIdAndStatusIn(workId, RUNNING) != null) throw conflict("SERIAL_RUNNING", "AI 자율 집필을 실행하는 중이라 집필 방식을 바꿀 수 없어요. 끝난 뒤에 다시 시도해 주세요.")
        val row = existing ?: AiSerialEntity(workId = workId)
        row.enabled = enabled
        row.updatedAt = Instant.now().truncatedTo(ChronoUnit.MICROS)
        serialRepo.save(row)
        if (enabled) openIfNeeded(workId)
    }

    /** 열린 게시판을 지금 마감·실행하도록 queued로 바꾼다. 실제 실행은 1분 안의 일정 점검이 한다. 꺼짐·열린 게시판 없음·이미 실행 중은 409다. */
    fun run(workId: String, owner: String) {
        access.own(workId, owner)
        if (serialRepo.findById(workId).orElse(null)?.enabled != true) throw conflict("SERIAL_DISABLED", "AI 집필이 꺼져 있어요. 켠 뒤에 실행해 주세요.")
        val board = boardRepo.findFirstByWorkIdAndStatusIn(workId, ACTIVE) ?: throw conflict("SERIAL_NO_BOARD", "마감할 의견 게시판이 아직 없어요. 1화를 발행하면 열려요.")
        if (board.status != "open") throw conflict("SERIAL_RUNNING", "이미 실행 중이에요.")
        board.status = "queued"
    }

    /** 소유자 기록: 게시판을 최신순으로 최대 50개 돌려준다. */
    fun boards(workId: String, owner: String): List<SerialBoardRecord> {
        access.own(workId, owner)
        return boardRepo.findTop50ByWorkIdOrderByOpenedAtDescIdDesc(workId).map {
            SerialBoardRecord(it.id, it.episodeNumber, it.status, it.publishedEpisodeNumber, it.failureReason, it.closedAt)
        }
    }

    // ---- 독자 게시판

    /**
     * 공개 작품의 열린 게시판과 의견(득표순, 숨긴 의견 제외)이다. [member]가 있으면 그 회원의 의견·투표를 채운다. 비공개·없는 작품은 404다.
     * 의견을 받는 게시판은 open뿐이라 마감·실행 중(queued·running)에는 board가 null이다. summary는 마지막으로 발행된 게시판의 종합 문장이다.
     * ponytail: 트랜잭션 안에서 Core 닉네임을 조회한다(다른 응답과 같은 시연 규모 방식).
     */
    fun board(workId: String, member: String?): SerialBoardResponse {
        access.published(workId)
        val summary = boardRepo.findFirstByWorkIdAndStatusOrderByOpenedAtDesc(workId, "published")?.summary
        val open = boardRepo.findFirstByWorkIdAndStatus(workId, "open") ?: return SerialBoardResponse(null, emptyList(), null, null, summary)
        val rows = opinionRepo.findAllByBoardId(open.id)
        val voteRows = voteRepo.findAllByBoardId(open.id)
        val ranked = rankOpinions(rows, voteRows)
        val names = nicknames.nicknames(ranked.map { it.opinion.authorId })
        val shown = ranked.map { it.opinion.id }.toSet()
        return SerialBoardResponse(
            SerialBoardRef(open.id, open.episodeNumber),
            ranked.map { SerialOpinionView(it.opinion.id, names[it.opinion.authorId] ?: WITHDRAWN_MEMBER_NAME, it.opinion.kind, it.opinion.body, simulationView(it.opinion), it.votes, it.opinion.createdAt) },
            // 숨겨진 의견도 그 회원의 의견이라 한 게시판에 하나라는 제한은 그대로다. 숨겨진 의견에 던진 표는 보이지 않으므로 내 투표가 아니다.
            member?.let { who -> rows.firstOrNull { it.authorId == who }?.id },
            member?.let { who -> voteRows.firstOrNull { it.memberId == who }?.opinionId?.takeIf { it in shown } },
            summary,
        )
    }

    /** 의견을 낼 수 있는지 확인한다: 공개 작품(404)·열린 게시판(409 SERIAL_NO_BOARD)·아직 의견 없음(409 OPINION_EXISTS). 시뮬레이션이 크레딧을 쓰기 전에 부른다. */
    fun openBoardFor(workId: String, member: String): OpenBoard {
        val work = access.published(workId)
        val board = open(workId)
        if (opinionRepo.findByBoardIdAndAuthorId(board.id, member) != null) throw conflict("OPINION_EXISTS", "이 게시판에는 이미 의견을 냈어요.")
        return OpenBoard(board.id, board.episodeNumber, work.title, work.summary)
    }

    /**
     * 열린 게시판에 의견을 저장한다. 시뮬레이션 의견은 AI가 만든 [scene]을 함께 저장하고, [boardId](시뮬레이션이 처음 확인한 게시판)가 있으면 지금 열린 게시판이 그것일 때만 저장한다(아니면 409 SERIAL_NO_BOARD).
     * 같은 회원의 두 번째 의견은 409 OPINION_EXISTS다(동시 요청은 유니크 제약이 막는다).
     */
    fun add(workId: String, member: String, opinion: CleanOpinion, scene: String? = null, boardId: String? = null): SerialOpinionCreated {
        val board = openBoardFor(workId, member)
        // 시뮬레이션은 AI를 기다리는 사이 게시판이 발행돼 다음 게시판이 열릴 수 있다. 처음 확인한 게시판([boardId])이 아니면 저장하지 않는다(러너가 예약을 해제한다).
        if (boardId != null && board.boardId != boardId) throw conflict("SERIAL_NO_BOARD", "의견을 쓰던 게시판이 마감됐어요. 새 게시판에 다시 써 주세요.")
        val simulation = if (opinion.kind == "simulation") mapOf("premise" to opinion.premise, "beats" to opinion.beats, "scene" to scene) else null
        val row = SerialOpinionEntity(id = contentId(), boardId = board.boardId, authorId = member, kind = opinion.kind, body = opinion.body, simulation = simulation)
        try {
            opinionRepo.saveAndFlush(row)
        } catch (_: DataIntegrityViolationException) {
            throw conflict("OPINION_EXISTS", "이 게시판에는 이미 의견을 냈어요.")
        }
        return SerialOpinionCreated(row.id)
    }

    /** 투표하거나 다른 의견으로 옮긴다(같은 의견에 다시 해도 한 표다). 자기 의견에도 할 수 있고 숨긴·다른 게시판·없는 의견은 404다. */
    fun vote(workId: String, member: String, opinionId: String) {
        access.published(workId)
        val board = open(workId)
        val target = opinionRepo.findById(opinionId).orElse(null)?.takeIf { it.boardId == board.id && !it.hidden } ?: throw ContentFailure(404, "의견을 찾을 수 없어요.")
        val mine = voteRepo.findByBoardIdAndMemberId(board.id, member)
        if (mine == null) {
            try {
                voteRepo.saveAndFlush(SerialVoteEntity(board.id, member, target.id))
            } catch (_: DataIntegrityViolationException) {
                // 같은 회원의 첫 표가 동시에 들어왔다(기본키가 마지막 방어). 이 트랜잭션은 이어 쓸 수 없으니 409로 알리고 다시 누르면 옮긴다.
                throw conflict("VOTE_CONFLICT", "투표를 처리하는 중이에요. 잠시 뒤 다시 눌러 주세요.")
            }
        } else mine.opinionId = target.id
    }

    /** 내 표를 취소한다. 던진 표가 없어도 괜찮다. */
    fun cancelVote(workId: String, member: String) {
        access.published(workId)
        val board = open(workId)
        voteRepo.findByBoardIdAndMemberId(board.id, member)?.let { voteRepo.delete(it) }
    }

    /** 소유자가 의견을 숨긴다(악성 의견). 이 작품의 게시판에 있는 의견만 숨길 수 있다. */
    fun hide(workId: String, owner: String, opinionId: String) {
        access.own(workId, owner)
        val row = opinionRepo.findById(opinionId).orElse(null)
        val board = row?.let { boardRepo.findById(it.boardId).orElse(null) }
        if (row == null || board == null || board.workId != workId) throw ContentFailure(404, "의견을 찾을 수 없어요.")
        row.hidden = true
    }

    // ---- 일정 점검이 쓰는 실행 준비

    fun enabledWorkIds(): List<String> = serialRepo.findAllByEnabledTrue().map { it.workId }

    /** 지금 실행 요청(queued)이 들어온 게시판이다. */
    fun queued(): List<SerialBoardEntity> = boardRepo.findAllByStatus("queued")

    /** 일정이 도래한 열린 게시판이다: 켜져 있고 오늘(KST) 고른 요일의 정한 시각부터 1시간 안이며 오늘 아직 실행하지 않은 작품(삭제된 작품 제외)의 열린 게시판. */
    fun due(now: ZonedDateTime): List<SerialBoardEntity> = serialRepo.findAllByEnabledTrue()
        .filter { isSerialDue(it.days, it.runTime, it.lastRunDate, now) && works.findById(it.workId).orElse(null)?.deletedAt == null }
        .mapNotNull { boardRepo.findFirstByWorkIdAndStatus(it.workId, "open") }

    /** 서버 재시작 따위로 running에 [STALE_RUNNING_MINUTES]분 넘게 남은 게시판이다. */
    fun staleRunning(now: Instant): List<SerialBoardEntity> = boardRepo.findAllByStatusAndClosedAtBefore("running", now.minus(STALE_RUNNING_MINUTES, ChronoUnit.MINUTES))

    fun owner(workId: String): String? = works.findById(workId).orElse(null)?.ownerId

    /**
     * 실행 선점이다: [from](open 또는 queued)인 게시판을 조건부로 running으로 바꿔 한 번만 실행하게 하고, 그 작품의 오늘(KST) 실행을 기록한다.
     * 이미 다른 점검이 가져갔거나 상태가 달라졌으면 false다.
     */
    fun claim(boardId: String, from: String, today: LocalDate, now: Instant): Boolean {
        val workId = boardRepo.findById(boardId).orElse(null)?.workId ?: return false
        // 지금 실행(open → queued)·끄기 저장(queued → open)은 작품 잠금 아래에서 상태를 쓴다. 선점도 같은 잠금을 쥐어야 그 쓰기가 running을 덮어쓰지 않는다.
        access.lockScope(workId)
        // 일정 점검이 열린 게시판을 읽은 뒤 소유자가 끄기를 저장했을 수 있다: 같은 잠금 안에서 enabled를 다시 보고 꺼졌으면 시작하지 않는다(이미 running인 실행만 끝까지 간다).
        if (serialRepo.findById(workId).orElse(null)?.enabled != true) return false
        if (boardRepo.claim(boardId, from, now) != 1) return false
        serialRepo.findById(workId).ifPresent { it.lastRunDate = today }
        return true
    }

    /**
     * 선점한 게시판의 실행 입력이다. 그 사이 사람이 직접 발행해 대상 회차가 이미 발행됐으면 지금의 마지막+1로 맞추고, 삭제된 작품은 404다.
     */
    fun runInput(boardId: String): RunInput {
        val board = boardRepo.findById(boardId).orElseThrow { ContentFailure(404, "게시판을 찾을 수 없어요.") }
        val work = works.findById(board.workId).orElse(null)
        checkContent(work != null && work.deletedAt == null, 404, "작품을 찾을 수 없어요.")
        val number = publication.nextEpisodeNumber(board.workId)
        // AI는 1화를 쓰지 않는다: 발행된 회차가 없으면 쓸 회차가 없다(게시판은 1화가 발행된 뒤에만 열리므로 정상 흐름에서는 일어나지 않는다).
        if (number < 2) throw conflict("SERIAL_NO_BOARD", "발행된 회차가 없어 AI가 이어 쓸 회차가 없어요.")
        board.episodeNumber = number
        val direction = serialRepo.findById(board.workId).orElse(null)?.direction.orEmpty()
        val top = topOpinions(opinionRepo.findAllByBoardId(boardId), voteRepo.findAllByBoardId(boardId))
        return RunInput(board.workId, boardId, work!!.ownerId, work.title, work.description, board.episodeNumber, direction, top)
    }

    // ---- 실행 결과

    /**
     * AI가 만든 회차를 소유자 명의로 저장·발행하고 게시판을 published로 닫은 뒤 다음 게시판을 연다(한 트랜잭션).
     * 새 회차 만들기·버전 저장은 기존 서비스의 자율 연재 전용 진입점을 쓰고(켜진 동안 소유자의 원고 수정을 막는 AI 집필 잠금을 건너뛴다), 발행은 예약 발행([PublicationService.publishScheduled])과 같은 경로다: 사람이 누르는 권리 확인 대신 소유자가 켠 자율 연재를 사전 승인으로 보고
     * 권리 확인 응답을 기록한다. 그 사이 사람이 대상 회차를 이미 발행했다면 덮어쓰지 않고 409다.
     */
    fun publish(boardId: String, owner: String, episode: GeneratedEpisode, now: Instant) {
        val board = boardRepo.findById(boardId).orElseThrow { ContentFailure(404, "게시판을 찾을 수 없어요.") }
        access.own(board.workId, owner)
        checkContent(board.status == "running", 409, "실행 중인 게시판이 아니에요.")
        val number = publication.nextEpisodeNumber(board.workId)
        checkContent(number == board.episodeNumber, 409, "그 사이 다음 회차 번호가 바뀌었어요.")
        // 회차 제목은 120자까지다. 모델이 더 길게 쓰면 잘라 쓴다.
        val title = episode.title.trim().take(120).dropLastWhile { it.isHighSurrogate() }
        // 회차 행이 있는지는 저장소로 먼저 본다: 합류한 서비스([EpisodeService.read])의 404를 잡으면 그 서비스가 바깥 트랜잭션을 rollback-only로 만들어 커밋 때 전부 되돌아간다.
        val draft = if (episodeRepo.findByWorkIdAndSequence(board.workId, number) == null) {
            episodes.createForSerial(board.workId, owner, CreateEpisodeRequest(title)).also { checkContent(it.number == number, 409, "회차 번호가 어긋났어요.") }
        } else {
            // 소유자가 이 회차에 쓰던 본문이 있으면 AI 원고로 덮지 않는다(초안은 저장 버전이 없어 되돌릴 수 없다). 빈 초안(예: 1화 발행이 만든 '새 회차')만 쓴다.
            episodes.read(board.workId, owner, number).also {
                if (it.draft.body.isNotBlank()) throw ContentFailure(409, SerialReason.DRAFT, "SERIAL_DRAFT_EXISTS")
            }
        }
        val saved = versions.saveWithVersionForSerial(board.workId, owner, number, DraftRequest(title, episode.text, draft.draft.revision, ""))
        publication.publishScheduled(board.workId, owner, number, saved.id)
        board.status = "published"
        board.summary = episode.summary.trim().take(2000).ifBlank { null }
        board.publishedEpisodeNumber = number
        // 끝난 게시판의 상태를 먼저 반영해야 같은 작품의 다음 게시판이 부분 유니크 인덱스에 걸리지 않는다.
        boardRepo.saveAndFlush(board)
        openIfNeeded(board.workId)
    }

    /**
     * 실행 중인 게시판을 failed와 고정 사유로 닫는다. 켜져 있으면 같은 대상 회차의 새 게시판을 열고 독자의 의견·투표를 옮겨, 소유자가 지금 실행으로 같은 입력을 다시 시도할 수 있게 한다.
     * running이 아니면(이미 끝남) 아무것도 하지 않는다. 마감 시각은 선점 때 적은 값을 둔다.
     */
    fun fail(boardId: String, reason: String, now: Instant) {
        val board = boardRepo.findById(boardId).orElse(null) ?: return
        if (board.status != "running") return
        access.lockScope(board.workId)
        board.status = "failed"
        board.failureReason = reason
        board.closedAt = board.closedAt ?: now
        boardRepo.saveAndFlush(board)
        val retry = openIfNeeded(board.workId) ?: return
        opinionRepo.findAllByBoardId(board.id).forEach { it.boardId = retry.id }
        // 표의 기본키에 게시판이 들어 있어 옮기지 않고 새 게시판의 표로 다시 만든다.
        val votes = voteRepo.findAllByBoardId(board.id)
        voteRepo.deleteAll(votes)
        voteRepo.saveAll(votes.map { SerialVoteEntity(retry.id, it.memberId, it.opinionId) })
    }

    /**
     * 켜진 작품의 게시판을 맞춘다(1분 주기): 열린 게시판이 없으면 열고(1화를 사람이 직접 발행한 경우 포함), 사람이 직접 발행해 대상 회차가 이미 발행됐으면 열린 게시판의 대상을 새 마지막+1로 올린다.
     * ponytail: 발행 서비스를 건드리지 않고 이 점검이 보정해 최대 1분 늦다. 실행 시점에는 [runInput]·[publish]가 번호를 다시 확인한다.
     */
    fun reconcile(workId: String) {
        access.lockScope(workId)
        val open = boardRepo.findFirstByWorkIdAndStatus(workId, "open")
        if (open == null) {
            openIfNeeded(workId)
            return
        }
        val next = publication.nextEpisodeNumber(workId)
        if (open.episodeNumber < next) open.episodeNumber = next
    }

    // ---- 내부

    private fun open(workId: String): SerialBoardEntity =
        boardRepo.findFirstByWorkIdAndStatus(workId, "open") ?: throw conflict("SERIAL_NO_BOARD", "지금 열린 의견 게시판이 없어요.")

    /** 켜져 있고(삭제되지 않은 작품) 발행된 회차가 있으며 열린 게시판이 없을 때 마지막 발행 회차+1 대상으로 새 게시판을 연다. 작품 잠금을 쥔 호출만 부른다. */
    private fun openIfNeeded(workId: String): SerialBoardEntity? {
        if (serialRepo.findById(workId).orElse(null)?.enabled != true) return null
        if (works.findById(workId).orElse(null)?.deletedAt != null) return null
        val next = publication.nextEpisodeNumber(workId)
        if (next < 2 || boardRepo.findFirstByWorkIdAndStatusIn(workId, ACTIVE) != null) return null
        return boardRepo.saveAndFlush(SerialBoardEntity(id = contentId(), workId = workId, episodeNumber = next))
    }

    private fun AiSerialEntity.response() = SerialSettingsResponse(enabled, serialDaySet(days).sortedBy { it.value }.map { it.name.take(3) }, runTime.format(HH_MM), direction)

    private fun simulationView(row: SerialOpinionEntity): SerialSimulationView? = row.simulation?.let {
        SerialSimulationView(it["premise"] as? String ?: "", (it["beats"] as? List<*>)?.map { beat -> beat.toString() } ?: emptyList(), it["scene"] as? String)
    }
}
