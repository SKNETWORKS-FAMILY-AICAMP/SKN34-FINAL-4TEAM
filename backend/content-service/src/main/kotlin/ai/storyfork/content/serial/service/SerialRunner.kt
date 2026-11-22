package ai.storyfork.content.serial.service

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.auth.service.CoreAuthVerificationService
import ai.storyfork.content.auth.service.CoreCreditService
import ai.storyfork.content.publication.service.PublicationService
import ai.storyfork.content.serial.client.GeneratedEpisode
import ai.storyfork.content.serial.client.SerialAiClient
import ai.storyfork.content.serial.client.SerialAiFailure
import ai.storyfork.content.serial.domain.KST
import ai.storyfork.content.serial.domain.PROPOSAL_BODY_MAX
import ai.storyfork.content.serial.domain.SerialCard
import ai.storyfork.content.serial.domain.SerialEpisode
import ai.storyfork.content.serial.domain.SerialReason
import ai.storyfork.content.serial.domain.cleanProposal
import ai.storyfork.content.serial.domain.serialContext
import ai.storyfork.content.serial.entity.SerialBoardEntity
import ai.storyfork.content.serial.entity.SerialProposalEntity
import ai.storyfork.content.serial.service.dto.SerialProposalCreated
import ai.storyfork.content.serial.service.dto.SerialProposalRequest
import ai.storyfork.content.work.service.WorkService
import ai.storyfork.content.work.service.WorkWorldService
import ai.storyfork.content.world.service.WorldStudioService
import java.math.BigDecimal
import java.time.Instant
import java.time.ZonedDateTime
import java.util.UUID
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Value
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Service
import tools.jackson.databind.json.JsonMapper

/** 회차 실행 중 어느 단계에서 어떤 고정 사유로 실패했는지 나른다. 사유는 [SerialReason]뿐이다. */
private class SerialRunFailure(val reason: String, cause: Throwable? = null) : RuntimeException(reason, cause)

/**
 * AI 자율 연재의 외부 호출 순서를 맡는다. DB 규칙은 [SerialService]가 짧은 트랜잭션으로 하고, 여기서는 Core 크레딧·AI를 DB 트랜잭션·잠금 밖에서 부른다.
 * - 시뮬레이션 제안 글([submit]): 작성자의 상한 예약 → 공개 문맥으로 장면 생성 → 글 저장 → 실제 사용량 정산. 실패면 해제하고 저장하지 않는다.
 * - 점검([tick], 1분마다): 낡은 실행·게시판 맞춤·지금 실행 요청(queued)·일정 도래의 회차 실행을 처리한 뒤, 선택지가 없는 열린 게시판의 선택지를 만든다.
 *   회차 실행은 선점 → 소유자 상한 예약 → 1위 선택지·추천 상위 제안 글·문맥으로 AI 생성 → 저장·발행 → 정산이다. 실패면 해제하고 게시판을 고정 사유로 닫는다. 정산은 저장·발행이 끝난 뒤에 해서 발행에 실패한 실행은 차감하지 않는다.
 *   선택지 생성은 시도 기록 → 소유자 상한 예약 → 공개 문맥으로 AI → 4개 저장 → 정산이고, 실패하면 해제하고 10분 뒤에 다시 시도한다.
 * 단일 서버를 전제한다(다중 서버 분산 잠금은 하지 않는다).
 */
@Service
class SerialRunner(
    private val serial: SerialService,
    private val credits: CoreCreditService,
    private val ai: SerialAiClient,
    private val publication: PublicationService,
    private val works: WorkService,
    private val workWorlds: WorkWorldService,
    private val worldStudio: WorldStudioService,
    private val auth: CoreAuthVerificationService,
    private val mapper: JsonMapper,
    @Value("\${SERIAL_SIMULATION_CREDIT_LIMIT:5}") private val simulationLimit: BigDecimal,
    @Value("\${SERIAL_CHOICE_CREDIT_LIMIT:5}") private val choiceLimit: BigDecimal,
    @Value("\${SERIAL_EPISODE_CREDIT_LIMIT:150}") private val episodeLimit: BigDecimal,
) {
    private val log = LoggerFactory.getLogger(javaClass)

    init {
        require(simulationLimit.signum() > 0 && choiceLimit.signum() > 0 && episodeLimit.signum() > 0) {
            "SERIAL_SIMULATION_CREDIT_LIMIT·SERIAL_CHOICE_CREDIT_LIMIT·SERIAL_EPISODE_CREDIT_LIMIT must be positive"
        }
    }

    // ---- 제안 글 제출

    /** 제안 글을 쓴다. 일반 글은 바로 저장하고, 시뮬레이션 글은 작성자 크레딧으로 장면 미리보기를 만든 뒤 저장한다(잔액 부족은 409 INSUFFICIENT_CREDIT 그대로). */
    fun submit(workId: String, member: String, request: SerialProposalRequest): SerialProposalCreated {
        val clean = cleanProposal(request)
        if (clean.kind != "simulation") return serial.add(workId, member, clean)
        val board = serial.openBoardFor(workId)
        val context = readerContext(workId, board.title, board.summary)
        val key = "serial-sim:" + UUID.randomUUID()
        val reservation = try {
            credits.reserve(member, key, simulationLimit)
        } catch (error: Exception) {
            // 잔액 부족이 아닌 실패(시간 초과·연동 실패)는 응답을 잃었어도 Core에 예약이 남았을 수 있다: 같은 키로 해제를 한 번 부른다(예약이 없어 404여도 삼킨다).
            if ((error as? ContentFailure)?.code != "INSUFFICIENT_CREDIT") release(member, key)
            throw error
        }
        val scene = try {
            ai.simulate(mapOf(
                "workId" to workId, "episodeNumber" to board.episodeNumber, "premise" to clean.premise, "beats" to clean.beats,
                "context" to context, "creditLimit" to simulationLimit, "creditReservationId" to reservation,
            ))
        } catch (error: Exception) {
            release(member, key)
            log.warn("serial simulation failed: {}", error.toString())
            throw ContentFailure(502, "시뮬레이션 미리보기를 만들지 못했어요. 크레딧은 차감되지 않았어요.")
        }
        val created = try {
            serial.add(workId, member, clean, scene.text, board.boardId)
        } catch (error: Exception) {
            release(member, key) // 그 사이 게시판이 닫혔다: 저장하지 못했으니 차감하지 않는다.
            throw error
        }
        settle(member, key, scene.credits)
        return created
    }

    // ---- 일정 점검

    /** 1분마다 도는 점검 하나다(전용 스케줄러). 단계마다 따로 잡아 한 단계·한 게시판의 실패가 다른 것을 막지 않는다. */
    @Scheduled(fixedDelay = 60_000, scheduler = "serialScheduler")
    fun tick() = tick(ZonedDateTime.now(KST))

    internal fun tick(now: ZonedDateTime) {
        val at = now.toInstant()
        attempt("stale") { serial.staleRunning(at).forEach { board -> attempt(board.id) { stale(board, at) } } }
        attempt("reconcile") { serial.enabledWorkIds().forEach { id -> attempt(id) { serial.reconcile(id) } } }
        attempt("queued") { serial.queued().forEach { board -> attempt(board.id) { run(board, "queued", now) } } }
        attempt("due") { serial.due(now).forEach { board -> attempt(board.id) { run(board, "open", now) } } }
        // 선택지는 실행 뒤에 만든다: 방금 마감해 실행하는 게시판에는 만들지 않고, 방금 발행돼 열린 다음 게시판은 같은 점검에서 바로 만든다.
        attempt("choices") { serial.choiceTargets(at).forEach { board -> attempt(board.id) { choose(board, at) } } }
    }

    /** 서버 재시작 따위로 running에 남은 게시판이다: 예약을 풀어 보고(실패해도 계속) 실패로 닫는다. */
    private fun stale(board: SerialBoardEntity, at: Instant) {
        serial.owner(board.workId)?.let { release(it, runKey(board.id)) }
        serial.fail(board.id, SerialReason.AI, at)
    }

    private fun run(board: SerialBoardEntity, from: String, now: ZonedDateTime) {
        val at = now.toInstant()
        if (!serial.claim(board.id, from, now.toLocalDate(), at)) return
        val key = runKey(board.id)
        var owner: String? = null
        var held = false // 예약했지만 아직 정산·해제하지 않았다.
        try {
            val input = serial.runInput(board.id)
            owner = input.owner
            // 예약 발행과 같이 소유자 명의로 일정에 발행하므로 Core가 회원 존재·제한 여부를 먼저 확인한다.
            failing(SerialReason.PUBLISH) { auth.verifyScheduledMember(input.owner) }
            val context = failing(SerialReason.AI) { ownerContext(input) }
            val reservation = try {
                credits.reserve(input.owner, key, episodeLimit)
            } catch (error: Exception) {
                val shortage = (error as? ContentFailure)?.code == "INSUFFICIENT_CREDIT"
                if (!shortage) release(input.owner, key) // 시간 초과로 응답을 잃었어도 Core에 예약이 남았을 수 있다(예약이 없어 404여도 삼킨다).
                throw SerialRunFailure(if (shortage) SerialReason.CREDIT else SerialReason.AI, error)
            }
            held = true
            val episode = generate(input, context, reservation)
            try {
                serial.publish(board.id, input.owner, episode, at)
            } catch (error: Exception) {
                // 소유자가 쓰던 원고가 있어 막힌 실행은 따로 알린다(AI 원고로 덮지 않는다).
                throw SerialRunFailure(if ((error as? ContentFailure)?.code == "SERIAL_DRAFT_EXISTS") SerialReason.DRAFT else SerialReason.PUBLISH, error)
            }
            // 정산은 발행이 끝난 뒤다. 발행되지 않은 실행은 아래 catch에서 차감 없이 해제한다.
            held = false
            settle(input.owner, key, episode.credits)
        } catch (error: Exception) {
            if (held) owner?.let { release(it, key) }
            val reason = (error as? SerialRunFailure)?.reason ?: SerialReason.AI
            log.warn("serial run {} failed ({}): {}", board.id, reason, error.cause?.toString() ?: error.toString())
            serial.fail(board.id, reason, at)
        }
    }

    /**
     * 선택지가 없는 열린 게시판의 선택지 4개를 만든다: 시도 기록(작품 잠금 안) → 소유자 상한 예약 → 공개 문맥으로 AI → 저장 → 정산. 실패하면 해제하고 10분 뒤에 다시 시도한다(그동안 화면은 '선택지를 준비하고 있어요').
     * 회차 실행과 달리 실패를 게시판에 남기지 않는다: 선택지가 없어도 게시판은 제안·실행이 되고, 실행 입력의 1위 선택지만 빠진다.
     */
    private fun choose(board: SerialBoardEntity, at: Instant) {
        val input = serial.beginChoices(board.workId, board.id, at) ?: return
        val key = "serial-choice:" + board.id + ":" + at.toEpochMilli()
        var held = false // 예약했지만 아직 정산·해제하지 않았다.
        try {
            val context = readerContext(input.workId, input.title, input.summary)
            val reservation = try {
                credits.reserve(input.owner, key, choiceLimit)
            } catch (error: Exception) {
                if ((error as? ContentFailure)?.code != "INSUFFICIENT_CREDIT") release(input.owner, key) // 응답을 잃었어도 Core에 예약이 남았을 수 있다.
                throw error
            }
            held = true
            val generated = ai.choices(mapOf(
                "workId" to input.workId, "episodeNumber" to input.number, "direction" to input.direction,
                "context" to context, "creditLimit" to choiceLimit, "creditReservationId" to reservation,
            ))
            serial.saveChoices(input.workId, input.boardId, generated.choices)
            // 정산은 저장이 끝난 뒤다. 저장하지 못한 생성(그 사이 게시판이 닫힘)은 아래 catch에서 차감 없이 해제한다.
            held = false
            settle(input.owner, key, generated.credits)
        } catch (error: Exception) {
            if (held) release(input.owner, key)
            log.warn("serial choices {} failed; retrying later: {}", board.id, error.toString())
        }
    }

    private fun generate(input: RunInput, context: String, reservation: String): GeneratedEpisode {
        val body = mapOf(
            "workId" to input.workId, "episodeNumber" to input.number, "direction" to input.direction,
            "choice" to input.choice?.let { mapOf("text" to it.choice.text, "votes" to it.votes) },
            "proposals" to input.proposals.map { mapOf("title" to it.proposal.title, "body" to it.proposal.body.take(PROPOSAL_BODY_MAX), "likes" to it.likes, "scene" to scene(it.proposal)) },
            "context" to context, "creditLimit" to episodeLimit, "creditReservationId" to reservation,
        )
        val episode = try {
            ai.episode(body)
        } catch (error: Exception) {
            val failure = error as? SerialAiFailure
            // 검수 실패와 크레딧 상한 초과는 일반 실패 문구와 구분해 남긴다.
            throw SerialRunFailure(if (failure?.reviewFailed == true) SerialReason.REVIEW else if (failure?.limitExceeded == true) SerialReason.LIMIT else SerialReason.AI, error)
        }
        // 검수를 통과하지 못한 원고는 발행하지 않는다(AI는 두 번 실패하면 422를 돌려주므로 보통 오지 않는다).
        if (!episode.reviewPassed) throw SerialRunFailure(SerialReason.REVIEW)
        return episode
    }

    private fun scene(proposal: SerialProposalEntity): String? = if (proposal.kind == "simulation") proposal.simulation?.get("scene") as? String else null

    /** 회차 실행의 문맥: 소유자가 허용한 모든 것, 곧 가장 최근 발행 회차와 연결된 세계관이 있으면 그 세계관 초안의 활성 카드다(세계관이 없으면 회차만). */
    private fun ownerContext(input: RunInput): String {
        val episodes = publication.publishedEpisodes(input.workId).items.map { SerialEpisode(it.number, it.title, it.body) }
        val cards = workWorlds.linkedWorldId(input.workId, input.owner)?.let { world ->
            worldStudio.draft(world, UUID.fromString(input.owner)).cards.filter { it.lifecycle == "active" }.map { SerialCard(it.title, it.cardType, it.body, it.aliases) }
        }.orEmpty()
        return serialContext(mapper, input.title, input.summary, episodes, cards)
    }

    /**
     * 시뮬레이션·선택지의 문맥: 독자에게 공개된 회차(독자 열람과 같은 읽기)와 독자 설정 위키의 카드만이다(세계관이 연결돼 있지 않으면 회차만).
     * 선택지는 독자에게 회차보다 먼저 공개되므로 소유자의 비공개 세계관 초안·공개 중단 회차는 싣지 않는다.
     */
    private fun readerContext(workId: String, title: String, summary: String): String {
        val episodes = works.publicEpisodes(workId).map { SerialEpisode(it.number, it.title, it.body) }
        return serialContext(mapper, title, summary, episodes, readerCards(workId))
    }

    private fun readerCards(workId: String): List<SerialCard> = workWorlds.readerCards(workId, null).cards.map { SerialCard(it.title, it.cardType, it.text, it.aliases) }

    // ---- 크레딧 마무리

    /** 확정 금액으로 정산한다. 정산이 안 되면 예약을 풀고(차감 없음) 기록만 남긴다: 이미 저장·발행한 결과는 되돌리지 않는다. */
    private fun settle(member: String, key: String, amount: BigDecimal) {
        try {
            credits.settle(member, key, amount)
        } catch (error: Exception) {
            log.warn("serial settle {} failed; releasing the hold: {}", key, error.toString())
            release(member, key)
        }
    }

    private fun release(member: String, key: String) {
        try {
            credits.release(member, key)
        } catch (error: Exception) {
            log.warn("serial release {} failed: {}", key, error.toString())
        }
    }

    private fun runKey(boardId: String) = "serial-run:" + boardId

    private fun <T> failing(reason: String, block: () -> T): T = try {
        block()
    } catch (error: Exception) {
        throw SerialRunFailure(reason, error)
    }

    private fun attempt(what: String, block: () -> Unit) {
        try {
            block()
        } catch (error: Exception) {
            log.warn("serial {} failed: {}", what, error.toString())
        }
    }
}
