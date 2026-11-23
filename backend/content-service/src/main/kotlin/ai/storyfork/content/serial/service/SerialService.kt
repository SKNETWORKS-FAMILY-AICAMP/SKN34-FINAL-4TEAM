package ai.storyfork.content.serial.service

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content._common.exception.checkContent
import ai.storyfork.content._common.helper.contentId
import ai.storyfork.content.auth.service.CoreNicknameService
import ai.storyfork.content.auth.service.WITHDRAWN_MEMBER_NAME
import ai.storyfork.content.episode.entity.EpisodeCurrentEntity
import ai.storyfork.content.episode.repository.EpisodeCurrentRepository
import ai.storyfork.content.episode.repository.EpisodeRepository
import ai.storyfork.content.episode.service.EpisodeService
import ai.storyfork.content.episode.service.dto.CreateEpisodeRequest
import ai.storyfork.content.episode.service.dto.DraftRequest
import ai.storyfork.content.episode_version.service.EpisodeVersionService
import ai.storyfork.content.publication.service.PublicationService
import ai.storyfork.content.serial.client.GeneratedEpisode
import ai.storyfork.content.serial.domain.CHOICES_RETRY_MINUTES
import ai.storyfork.content.serial.domain.CleanProposal
import ai.storyfork.content.serial.domain.RankedChoice
import ai.storyfork.content.serial.domain.RankedProposal
import ai.storyfork.content.serial.domain.SerialReason
import ai.storyfork.content.serial.domain.STALE_RUNNING_MINUTES
import ai.storyfork.content.serial.domain.cleanSettings
import ai.storyfork.content.serial.domain.isSerialDue
import ai.storyfork.content.serial.domain.rankChoices
import ai.storyfork.content.serial.domain.serialDaySet
import ai.storyfork.content.serial.domain.topChoice
import ai.storyfork.content.serial.domain.topProposals
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
import ai.storyfork.content.serial.service.dto.SerialBoardRecord
import ai.storyfork.content.serial.service.dto.SerialBoardRef
import ai.storyfork.content.serial.service.dto.SerialBoardResponse
import ai.storyfork.content.serial.service.dto.SerialChoiceView
import ai.storyfork.content.serial.service.dto.SerialProposalCreated
import ai.storyfork.content.serial.service.dto.SerialProposalView
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

/** 제안 글을 받을 수 있는 열린 게시판과 그 작품의 표시 정보다. 시뮬레이션이 AI를 부르기 전에 확인한 값이다. */
data class OpenBoard(val boardId: String, val episodeNumber: Int, val title: String, val summary: String)

/** 선택지 생성에 쓰는 입력이다: 소유자·작품 표시 정보·연재 방향과 선택지를 만들 대상 회차 번호다. */
data class ChoiceInput(val workId: String, val boardId: String, val owner: String, val title: String, val summary: String, val number: Int, val direction: String)

/** 회차 실행에 쓰는 입력이다: 소유자·연재 방향·1위 선택지(선택지가 없으면 null)·추천 상위 제안 글과, 실행 시점의 다음 회차 번호다. */
data class RunInput(
    val workId: String, val boardId: String, val owner: String, val title: String, val summary: String, val number: Int, val direction: String,
    val choice: RankedChoice?, val proposals: List<RankedProposal>,
)

private val HH_MM = DateTimeFormatter.ofPattern("HH:mm")
private val ACTIVE = listOf("open", "queued", "running")
private val RUNNING = listOf("queued", "running")

private fun conflict(code: String, message: String) = ContentFailure(409, message, code)

/** [number]회가 운영 제한인지다. 제한 판정은 독자 경로와 같은 episode_current의 restricted다(물려받은 원작 회차의 제한 포함). */
private fun List<EpisodeCurrentEntity>.restricted(number: Int) = any { it.sequence == number && it.restricted }

/**
 * 게시판이 운영 제한에 걸렸는지다: 대상 회차나 그 앞의 마지막 발행 회차가 제한이다. 걸린 게시판은 독자에게 없는 것과 같고(읽기는 board 없음, 쓰기는 404) 일정 점검은 실행하지 않는다.
 * 게시판·선택지·제안 글·표는 지우거나 옮기지 않는다(제한이 풀리면 그대로 다시 보인다).
 */
private fun List<EpisodeCurrentEntity>.frozen(board: SerialBoardEntity) = restricted(board.episodeNumber) || lastOrNull { it.publishedVersionId != null }?.restricted == true

/**
 * AI 자율 연재(UC-18)의 DB 쪽 규칙이다: 설정, 회차마다 열리는 게시판(AI 선택지 투표·제안 글·추천·숨김), 지금 실행 요청, 그리고 일정 점검([SerialRunner])이 쓰는 선택지 시도 기록·실행 선점·발행·실패 처리.
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
    private val choiceRepo: SerialChoiceRepository,
    private val proposalRepo: SerialProposalRepository,
    private val likeRepo: SerialProposalLikeRepository,
    private val voteRepo: SerialVoteRepository,
    private val works: WorkRepository,
    private val nicknames: CoreNicknameService,
    private val current: EpisodeCurrentRepository,
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
        val board = boardRepo.findFirstByWorkIdAndStatusIn(workId, ACTIVE) ?: throw conflict("SERIAL_NO_BOARD", "마감할 게시판이 아직 없어요. 1화를 발행하면 열려요.")
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
     * 공개 작품의 열린 게시판과 AI 선택지(번호순·득표 수), 제안 글(최신순 최대 200개, 숨긴 글 제외)이다. [member]가 있으면 그 회원의 투표(myChoiceId)와 글마다 추천·작성 여부를 채운다. 비공개·없는 작품은 404다.
     * 투표·제안을 받는 게시판은 open뿐이라 마감·실행 중(queued·running)에는 board가 null이고 choices·proposals는 비어 있다. summary는 마지막으로 발행된 게시판의 종합 문장이다.
     * 대상 회차나 그 앞의 마지막 발행 회차가 운영 제한이면 열린 게시판도 없는 것과 같고, summary는 그 게시판이 발행한 회차가 제한이면 감춘다.
     * ponytail: 트랜잭션 안에서 Core 닉네임을 조회한다(다른 응답과 같은 시연 규모 방식).
     */
    fun board(workId: String, member: String?): SerialBoardResponse {
        access.published(workId)
        val enabled = serialRepo.findById(workId).orElse(null)?.enabled == true
        val episodeRows = current.findAllByWorkIdOrderBySequence(workId)
        val summary = boardRepo.findFirstByWorkIdAndStatusOrderByOpenedAtDesc(workId, "published")?.takeUnless { episodeRows.restricted(it.publishedEpisodeNumber ?: it.episodeNumber) }?.summary
        val open = boardRepo.findFirstByWorkIdAndStatus(workId, "open")?.takeUnless { episodeRows.frozen(it) } ?: return SerialBoardResponse(enabled, null, emptyList(), null, emptyList(), summary)
        val votes = voteRepo.findAllByBoardId(open.id)
        val rows = proposalRepo.findTop200ByBoardIdAndHiddenFalseOrderByCreatedAtDescIdDesc(open.id)
        val likes = likesOf(rows)
        val counts = likes.groupingBy { it.proposalId }.eachCount()
        val liked = likes.filter { it.memberId == member }.map { it.proposalId }.toSet()
        val names = nicknames.nicknames(rows.map { it.authorId })
        return SerialBoardResponse(
            enabled,
            SerialBoardRef(open.id, open.episodeNumber),
            rankChoices(choiceRepo.findAllByBoardId(open.id), votes).map { SerialChoiceView(it.choice.id, it.choice.position, it.choice.text, it.votes) },
            member?.let { who -> votes.firstOrNull { it.memberId == who }?.choiceId },
            rows.map {
                SerialProposalView(it.id, names[it.authorId] ?: WITHDRAWN_MEMBER_NAME, it.kind, it.title, it.body, simulationView(it), counts[it.id] ?: 0, it.id in liked, it.authorId == member, it.createdAt)
            },
            summary,
        )
    }

    /** 제안 글을 쓸 수 있는지 확인한다: 공개 작품(404)·열린 게시판(409 SERIAL_NO_BOARD). 시뮬레이션이 크레딧을 쓰기 전에 부른다. */
    fun openBoardFor(workId: String): OpenBoard {
        val work = access.published(workId)
        val board = open(workId)
        return OpenBoard(board.id, board.episodeNumber, work.title, work.summary)
    }

    /**
     * 열린 게시판에 제안 글을 저장한다(회원당 개수 제한 없음). 시뮬레이션 글은 AI가 만든 [scene]을 함께 저장하고, [boardId](시뮬레이션이 처음 확인한 게시판)가 있으면 지금 열린 게시판이 그것일 때만 저장한다(아니면 409 SERIAL_NO_BOARD).
     */
    fun add(workId: String, member: String, proposal: CleanProposal, scene: String? = null, boardId: String? = null): SerialProposalCreated {
        val board = openBoardFor(workId)
        // 시뮬레이션은 AI를 기다리는 사이 게시판이 발행돼 다음 게시판이 열릴 수 있다. 처음 확인한 게시판([boardId])이 아니면 저장하지 않는다(러너가 예약을 해제한다).
        if (boardId != null && board.boardId != boardId) throw conflict("SERIAL_NO_BOARD", "글을 쓰던 게시판이 마감됐어요. 새 게시판에 다시 써 주세요.")
        val simulation = if (proposal.kind == "simulation") mapOf("premise" to proposal.premise, "beats" to proposal.beats, "scene" to scene) else null
        val row = SerialProposalEntity(id = contentId(), boardId = board.boardId, authorId = member, kind = proposal.kind, title = proposal.title, body = proposal.body, simulation = simulation)
        proposalRepo.save(row)
        return SerialProposalCreated(row.id)
    }

    /** 선택지에 투표하거나 다른 선택지로 옮긴다(같은 선택지에 다시 해도 한 표다). 소유자도 한다. 열린 게시판의 선택지가 아니거나 없으면 404다. */
    fun vote(workId: String, member: String, choiceId: String) {
        access.published(workId)
        val board = open(workId)
        val target = choiceRepo.findById(choiceId).orElse(null)?.takeIf { it.boardId == board.id } ?: throw ContentFailure(404, "선택지를 찾을 수 없어요.")
        val mine = voteRepo.findByBoardIdAndMemberId(board.id, member)
        if (mine == null) {
            try {
                voteRepo.saveAndFlush(SerialVoteEntity(board.id, member, target.id))
            } catch (_: DataIntegrityViolationException) {
                // 같은 회원의 첫 표가 동시에 들어왔다(기본키가 마지막 방어). 이 트랜잭션은 이어 쓸 수 없으니 409로 알리고 다시 누르면 옮긴다.
                throw conflict("VOTE_CONFLICT", "투표를 처리하는 중이에요. 잠시 뒤 다시 눌러 주세요.")
            }
        } else mine.choiceId = target.id
    }

    /** 내 표를 취소한다. 던진 표가 없어도 괜찮다. */
    fun cancelVote(workId: String, member: String) {
        access.published(workId)
        val board = open(workId)
        voteRepo.findByBoardIdAndMemberId(board.id, member)?.let { voteRepo.delete(it) }
    }

    /** 제안 글을 추천한다(글마다 회원당 한 번, 이미 했으면 그대로다). 열린 게시판의 숨기지 않은 글만이고 자기 글에도 할 수 있다. 없는·숨긴·다른 게시판 글은 404다. */
    fun like(workId: String, member: String, proposalId: String) {
        access.published(workId)
        val target = proposalOnOpenBoard(workId, proposalId)
        if (likeRepo.findByProposalIdAndMemberId(target.id, member) != null) return
        try {
            likeRepo.saveAndFlush(SerialProposalLikeEntity(target.id, member))
        } catch (_: DataIntegrityViolationException) {
            // 같은 회원의 첫 추천이 동시에 들어왔다(기본키가 마지막 방어). 투표와 같이 409로 알리고 화면을 새로 읽게 한다.
            throw conflict("LIKE_CONFLICT", "추천을 처리하는 중이에요. 잠시 뒤 다시 눌러 주세요.")
        }
    }

    /** 내 추천을 취소한다. 추천한 적이 없어도 괜찮다. 글을 찾는 규칙은 [like]와 같다. */
    fun unlike(workId: String, member: String, proposalId: String) {
        access.published(workId)
        val target = proposalOnOpenBoard(workId, proposalId)
        likeRepo.findByProposalIdAndMemberId(target.id, member)?.let { likeRepo.delete(it) }
    }

    /** 소유자가 제안 글을 숨긴다(악성 글). 이 작품의 게시판에 있는 글만 숨길 수 있다. */
    fun hide(workId: String, owner: String, proposalId: String) {
        access.own(workId, owner)
        val row = proposalRepo.findById(proposalId).orElse(null)
        val board = row?.let { boardRepo.findById(it.boardId).orElse(null) }
        if (row == null || board == null || board.workId != workId) throw ContentFailure(404, "제안 글을 찾을 수 없어요.")
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

    /**
     * 선택지를 만들어야 하는 게시판이다: 켜져 있고 삭제되지 않은 작품의 열린 게시판 가운데 선택지가 아직 없고, 마지막 시도가 없거나 [CHOICES_RETRY_MINUTES]분 넘게 지난 것.
     * 실제 시작은 [beginChoices]가 작품 잠금 안에서 다시 확인한다.
     */
    fun choiceTargets(now: Instant): List<SerialBoardEntity> {
        val retryBefore = now.minus(CHOICES_RETRY_MINUTES, ChronoUnit.MINUTES)
        return serialRepo.findAllByEnabledTrue()
            .filter { works.findById(it.workId).orElse(null)?.deletedAt == null }
            .mapNotNull { boardRepo.findFirstByWorkIdAndStatus(it.workId, "open") }
            .filter { board -> board.choicesTriedAt.let { it == null || !it.isAfter(retryBefore) } && !choiceRepo.existsByBoardId(board.id) }
    }

    /**
     * 선택지 생성을 시작한다: 작품 잠금 안에서 조건(켜짐·열린 게시판·선택지 없음·마지막 시도 10분 경과·공개 작품)을 다시 확인하고 시도 시각을 적은 뒤 입력을 돌려준다. 조건이 달라졌으면 null이다.
     * 시도 시각은 실패해도 남아 10분 뒤에야 다시 시도한다(Core 예약 키의 시도 시각이기도 하다).
     */
    fun beginChoices(workId: String, boardId: String, now: Instant): ChoiceInput? {
        access.lockScope(workId)
        val setting = serialRepo.findById(workId).orElse(null)?.takeIf { it.enabled } ?: return null
        val board = boardRepo.findById(boardId).orElse(null)?.takeIf { it.workId == workId && it.status == "open" } ?: return null
        val tried = board.choicesTriedAt
        if ((tried != null && tried.isAfter(now.minus(CHOICES_RETRY_MINUTES, ChronoUnit.MINUTES))) || choiceRepo.existsByBoardId(boardId)) return null
        // 선택지는 독자에게 보이는 게시판에만 만든다: 독자가 읽을 수 없는 작품(비공개·제한·삭제)에는 시도하지도 크레딧을 쓰지도 않는다.
        val work = access.get(workId).takeIf { it.publiclyVisible() } ?: return null
        board.choicesTriedAt = now
        return ChoiceInput(workId, boardId, work.ownerId, work.title, work.summary, board.episodeNumber, setting.direction)
    }

    /**
     * AI가 만든 선택지를 번호 1~4로 게시판에 저장한다(작품 잠금 안). 그 사이 게시판이 열려 있지 않거나(지금 실행·마감·실패) 이미 선택지가 있으면 409 SERIAL_NO_BOARD이고 러너가 예약을 해제한다(차감 없음).
     */
    fun saveChoices(workId: String, boardId: String, texts: List<String>) {
        access.lockScope(workId)
        val board = boardRepo.findById(boardId).orElse(null)?.takeIf { it.workId == workId && it.status == "open" } ?: throw conflict("SERIAL_NO_BOARD", "선택지를 붙일 열린 게시판이 없어요.")
        if (choiceRepo.existsByBoardId(board.id)) throw conflict("SERIAL_NO_BOARD", "이미 선택지가 있어요.")
        choiceRepo.saveAll(texts.mapIndexed { index, text -> SerialChoiceEntity(id = contentId(), boardId = board.id, position = index + 1, text = text) })
    }

    fun owner(workId: String): String? = works.findById(workId).orElse(null)?.ownerId

    /**
     * 실행 선점이다: [from](open 또는 queued)인 게시판을 조건부로 running으로 바꿔 한 번만 실행하게 하고, 그 작품의 오늘(KST) 실행을 기록한다.
     * 이미 다른 점검이 가져갔거나 상태가 달라졌으면 false다. 운영 제한에 걸린 게시판도 false다: 아무것도 바꾸지 않아 제한이 풀린 다음 점검이 다시 선점한다.
     */
    fun claim(boardId: String, from: String, today: LocalDate, now: Instant): Boolean {
        val board = boardRepo.findById(boardId).orElse(null) ?: return false
        val workId = board.workId
        // 지금 실행(open → queued)·끄기 저장(queued → open)은 작품 잠금 아래에서 상태를 쓴다. 선점도 같은 잠금을 쥐어야 그 쓰기가 running을 덮어쓰지 않는다.
        access.lockScope(workId)
        // 일정 점검이 열린 게시판을 읽은 뒤 소유자가 끄기를 저장했을 수 있다: 같은 잠금 안에서 enabled를 다시 보고 꺼졌으면 시작하지 않는다(이미 running인 실행만 끝까지 간다).
        if (serialRepo.findById(workId).orElse(null)?.enabled != true) return false
        // 운영이 제한한 회차에 걸려 있는 동안은 실행하지 않는다(상태·마감 시각·오늘 실행 기록을 그대로 둔다). 일정 창(1시간)을 넘기면 그날은 건너뛴다.
        if (current.findAllByWorkIdOrderBySequence(workId).frozen(board)) return false
        if (boardRepo.claim(boardId, from, now) != 1) return false
        serialRepo.findById(workId).ifPresent { it.lastRunDate = today }
        return true
    }

    /**
     * 선점한 게시판의 실행 입력이다(1위 선택지와 추천 상위 3개 제안 글). 그 사이 사람이 직접 발행해 대상 회차가 이미 발행됐으면 지금의 마지막+1로 맞추고, 삭제된 작품은 404다.
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
        val choice = topChoice(choiceRepo.findAllByBoardId(boardId), voteRepo.findAllByBoardId(boardId))
        val rows = proposalRepo.findAllByBoardId(boardId)
        return RunInput(board.workId, boardId, work!!.ownerId, work.title, work.description, board.episodeNumber, direction, choice, topProposals(rows, likesOf(rows)))
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
     * 실행 중인 게시판을 failed와 고정 사유로 닫는다. 켜져 있으면 같은 대상 회차의 새 게시판을 열고 선택지·투표·제안 글(추천은 글을 따라간다)과 선택지 시도 시각을 옮겨, 소유자가 지금 실행으로 같은 입력을 다시 시도할 수 있게 한다.
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
        retry.choicesTriedAt = board.choicesTriedAt
        choiceRepo.findAllByBoardId(board.id).forEach { it.boardId = retry.id }
        proposalRepo.findAllByBoardId(board.id).forEach { it.boardId = retry.id }
        // 표의 기본키에 게시판이 들어 있어 옮기지 않고 새 게시판의 표로 다시 만든다(선택지는 옮겼으니 같은 선택지를 가리킨다).
        val votes = voteRepo.findAllByBoardId(board.id)
        voteRepo.deleteAll(votes)
        voteRepo.saveAll(votes.map { SerialVoteEntity(retry.id, it.memberId, it.choiceId) })
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

    /** 독자 쓰기의 열린 게시판이다: 없으면 409, 있어도 운영 제한에 걸려 있으면 독자에게는 없는 것과 같아 404다. */
    private fun open(workId: String): SerialBoardEntity {
        val board = boardRepo.findFirstByWorkIdAndStatus(workId, "open") ?: throw conflict("SERIAL_NO_BOARD", "지금 열린 게시판이 없어요.")
        if (current.findAllByWorkIdOrderBySequence(workId).frozen(board)) throw ContentFailure(404, "게시판을 찾을 수 없어요.")
        return board
    }

    /** 열린 게시판의 숨기지 않은 글이다(추천·추천 취소 대상). */
    private fun proposalOnOpenBoard(workId: String, proposalId: String): SerialProposalEntity {
        val board = open(workId)
        return proposalRepo.findById(proposalId).orElse(null)?.takeIf { it.boardId == board.id && !it.hidden } ?: throw ContentFailure(404, "제안 글을 찾을 수 없어요.")
    }

    private fun likesOf(rows: List<SerialProposalEntity>): List<SerialProposalLikeEntity> =
        if (rows.isEmpty()) emptyList() else likeRepo.findAllByProposalIdIn(rows.map { it.id })

    /** 켜져 있고(삭제되지 않은 작품) 발행된 회차가 있으며 열린 게시판이 없을 때 마지막 발행 회차+1 대상으로 새 게시판을 연다. 작품 잠금을 쥔 호출만 부른다. */
    private fun openIfNeeded(workId: String): SerialBoardEntity? {
        if (serialRepo.findById(workId).orElse(null)?.enabled != true) return null
        if (works.findById(workId).orElse(null)?.deletedAt != null) return null
        val next = publication.nextEpisodeNumber(workId)
        if (next < 2 || boardRepo.findFirstByWorkIdAndStatusIn(workId, ACTIVE) != null) return null
        return boardRepo.saveAndFlush(SerialBoardEntity(id = contentId(), workId = workId, episodeNumber = next))
    }

    private fun AiSerialEntity.response() = SerialSettingsResponse(enabled, serialDaySet(days).sortedBy { it.value }.map { it.name.take(3) }, runTime.format(HH_MM), direction)

    private fun simulationView(row: SerialProposalEntity): SerialSimulationView? = row.simulation?.let {
        SerialSimulationView(it["premise"] as? String ?: "", (it["beats"] as? List<*>)?.map { beat -> beat.toString() } ?: emptyList(), it["scene"] as? String)
    }
}
