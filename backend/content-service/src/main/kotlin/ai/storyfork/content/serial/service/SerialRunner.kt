package ai.storyfork.content.serial.service

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.auth.service.CoreAuthVerificationService
import ai.storyfork.content.auth.service.CoreCreditService
import ai.storyfork.content.context.service.ManuscriptQaService
import ai.storyfork.content.context.service.dto.QaEpisodeRef
import ai.storyfork.content.publication.service.PublicationService
import ai.storyfork.content.publication.service.dto.PublishedEpisodeResponse
import ai.storyfork.content.serial.client.GeneratedEpisode
import ai.storyfork.content.serial.client.SerialAiClient
import ai.storyfork.content.serial.client.SerialAiFailure
import ai.storyfork.content.serial.domain.KST
import ai.storyfork.content.serial.domain.PROPOSAL_BODY_MAX
import ai.storyfork.content.serial.domain.RECENT_EPISODES
import ai.storyfork.content.serial.domain.RELATED_MAX
import ai.storyfork.content.serial.domain.SUMMARIES_PER_TICK
import ai.storyfork.content.serial.domain.SerialCard
import ai.storyfork.content.serial.domain.SerialEpisode
import ai.storyfork.content.serial.domain.SerialReason
import ai.storyfork.content.serial.domain.SerialRelated
import ai.storyfork.content.serial.domain.SerialSummary
import ai.storyfork.content.serial.domain.cleanProposal
import ai.storyfork.content.serial.domain.relatedQuery
import ai.storyfork.content.serial.domain.serialContext
import ai.storyfork.content.serial.entity.SerialBoardEntity
import ai.storyfork.content.serial.entity.SerialProposalEntity
import ai.storyfork.content.serial.service.dto.SerialProposalCreated
import ai.storyfork.content.serial.service.dto.SerialProposalRequest
import ai.storyfork.content.work.service.WorkService
import ai.storyfork.content.work.service.WorkWorldService
import ai.storyfork.content.world.service.WorldStudioService
import ai.storyfork.content.world.service.dto.RelationshipPayload
import java.math.BigDecimal
import java.time.Instant
import java.time.ZonedDateTime
import java.util.UUID
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Value
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Service
import tools.jackson.databind.JsonNode
import tools.jackson.databind.json.JsonMapper
import tools.jackson.databind.node.ObjectNode

/** 회차 실행 중 어느 단계에서 어떤 사유로 실패했는지 나른다. 사유는 [SerialReason]의 고정 문구이거나, 인물 시뮬레이션이 막은 실패를 AI가 설명한 문구([SerialAiFailure.detail])다. */
private class SerialRunFailure(val reason: String, cause: Throwable? = null) : RuntimeException(reason, cause)

/** 회차 실행이 읽은 세계관이다: AI 요청의 [world]와, 같은 읽기에서 나온 문맥용 활성 카드([cards], 연결된 세계관일 때만)다. */
private class OwnerWorld(val world: ObjectNode, val cards: List<SerialCard>)

/**
 * AI 자율 연재의 외부 호출 순서를 맡는다. DB 규칙은 [SerialService]가 짧은 트랜잭션으로 하고, 여기서는 Core 크레딧·AI를 DB 트랜잭션·잠금 밖에서 부른다.
 * - 시뮬레이션 제안 글([submit]): 작성자의 상한 예약 → 공개 문맥으로 장면 생성 → 글 저장 → 실제 사용량 정산. 실패면 해제하고 저장하지 않는다.
 * - 점검([tick], 1분마다): 낡은 실행·게시판 맞춤·지금 실행 요청(queued)·일정 도래의 회차 실행을 처리한 뒤, 선택지가 없는 열린 게시판의 선택지를 만들고, 마지막으로 요약이 없는 공개 회차의 요약을 만든다.
 *   회차 실행은 선점 → 세계관 읽기(인물 시뮬레이션의 필수 입력, 없으면 이 실행 실패) → 관련 장면 검색(독자 범위, 실패하면 이 실행 실패) → 소유자 상한 예약 → 1위 선택지·추천 상위 제안 글·문맥(최근 회차 원문·이전 회차 요약·관련 장면 인용)·세계관으로 AI 생성 → 저장·발행 → 정산이다.
 *   실패면 해제하고 게시판을 사유(고정 문구, 인물 시뮬레이션이 막은 실패는 AI가 설명한 문구 그대로)로 닫는다. 정산은 저장·발행이 끝난 뒤에 해서 발행에 실패한 실행은 차감하지 않는다.
 *   선택지 생성은 시도 기록 → 공개 문맥 → 소유자 상한 예약 → AI → 4개 저장 → 정산이고, 실패하면 해제하고 10분 뒤에 다시 시도한다. 회차 요약은 점검마다 최대 3개를 같은 순서(예약 → AI → 저장 → 정산)로 만들고 실패하면 다음 점검에 다시 한다.
 * 단일 서버를 전제한다(다중 서버 분산 잠금은 하지 않는다).
 */
@Service
class SerialRunner internal constructor( // 원고 검색(ManuscriptQaService)이 internal이라 생성자도 internal이다(Spring은 그대로 주입한다).
    private val serial: SerialService,
    private val summaries: SerialSummaryService,
    private val qa: ManuscriptQaService,
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
    @Value("\${SERIAL_SUMMARY_CREDIT_LIMIT:5}") private val summaryLimit: BigDecimal,
    @Value("\${SERIAL_EPISODE_CREDIT_LIMIT:1000}") private val episodeLimit: BigDecimal,
) {
    private val log = LoggerFactory.getLogger(javaClass)

    init {
        require(simulationLimit.signum() > 0 && choiceLimit.signum() > 0 && summaryLimit.signum() > 0 && episodeLimit.signum() > 0) {
            "SERIAL_SIMULATION_CREDIT_LIMIT·SERIAL_CHOICE_CREDIT_LIMIT·SERIAL_SUMMARY_CREDIT_LIMIT·SERIAL_EPISODE_CREDIT_LIMIT must be positive"
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
        // 요약은 맨 끝이다: 실행·선택지가 먼저이고, 요약이 아직 없어도 문맥에서 그 회차만 빠질 뿐 실행은 막지 않는다.
        attempt("summaries") { summaries.targets(SUMMARIES_PER_TICK).forEach { target -> attempt(target.episodeId) { summarize(target, at) } } }
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
            val published = failing(SerialReason.AI) { publication.publishedEpisodes(input.workId).items }
            // 회차 집필은 인물 시뮬레이션을 반드시 거치므로 세계관이 없으면 AI를 부르지 않고 이 실행을 실패로 끝낸다(대신할 세계관을 찾지 않는다). 크레딧 예약 앞이라 해제할 것도 없다.
            val owned = failing(SerialReason.AI) { ownerWorld(input) } ?: throw SerialRunFailure(SerialReason.NO_WORLD)
            // 관련 장면 검색은 문맥에 들어가므로 크레딧 예약 앞이다(검색이 실패하면 임의로 빼지 않고 이 실행을 실패로 끝낸다).
            val related = failing(SerialReason.SEARCH) { relatedScenes(input, published) }
            val context = failing(SerialReason.AI) { ownerContext(input, published, related, owned.cards) }
            val reservation = try {
                credits.reserve(input.owner, key, episodeLimit)
            } catch (error: Exception) {
                val shortage = (error as? ContentFailure)?.code == "INSUFFICIENT_CREDIT"
                if (!shortage) release(input.owner, key) // 시간 초과로 응답을 잃었어도 Core에 예약이 남았을 수 있다(예약이 없어 404여도 삼킨다).
                throw SerialRunFailure(if (shortage) SerialReason.CREDIT else SerialReason.AI, error)
            }
            held = true
            val episode = generate(input, context, owned.world, reservation)
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
     * 선택지가 없는 열린 게시판의 선택지 4개를 만든다: 시도 기록(작품 잠금 안) → 공개 문맥 → 소유자 상한 예약 → AI → 저장 → 정산. 실패하면 해제하고 10분 뒤에 다시 시도한다(그동안 화면은 '선택지를 준비하고 있어요').
     * 회차 실행과 달리 실패를 게시판에 남기지 않는다: 선택지가 없어도 게시판은 제안·실행이 되고, 실행 입력의 1위 선택지만 빠진다.
     */
    private fun choose(board: SerialBoardEntity, at: Instant) {
        val input = serial.beginChoices(board.workId, board.id, at) ?: return
        val context = readerContext(input.workId, input.title, input.summary)
        paid(input.owner, "serial-choice:" + board.id + ":" + at.toEpochMilli(), choiceLimit, "serial choices " + board.id) { reservation ->
            val generated = ai.choices(mapOf(
                "workId" to input.workId, "episodeNumber" to input.number, "direction" to input.direction,
                "context" to context, "creditLimit" to choiceLimit, "creditReservationId" to reservation,
            ))
            serial.saveChoices(input.workId, input.boardId, generated.choices)
            generated.credits
        }
    }

    /**
     * 요약이 없는(또는 발행 버전이 바뀐) 공개 회차 하나의 요약을 만든다: 소유자 상한 예약 → AI(제목·본문만) → 저장 → 정산. 실패하면 해제하고 다음 점검이 다시 한다.
     * 키에 시도 시각을 넣어 다음 점검의 재시도가 닫힌 예약의 키를 다시 쓰지 않게 한다(Core는 닫힌 예약 키의 재예약을 거절한다).
     */
    private fun summarize(target: SummaryTarget, at: Instant) {
        paid(target.owner, "serial-summary:" + target.episodeId + ":" + at.toEpochMilli(), summaryLimit, "serial summary " + target.episodeId) { reservation ->
            val made = ai.summarize(mapOf(
                "workId" to target.workId, "episodeNumber" to target.number, "title" to target.title, "body" to target.body,
                "creditLimit" to summaryLimit, "creditReservationId" to reservation,
            ))
            summaries.save(target.episodeId, target.versionId, made.summary)
            made.credits
        }
    }

    /**
     * [owner]의 상한 [limit]을 예약하고, [work]가 AI 호출과 저장을 끝내 돌려준 확정 금액으로 정산한다(정산은 저장 뒤이므로 저장하지 못하면 차감 없이 해제한다).
     * 어느 단계가 실패해도 예약을 해제하고(예약 호출이 잔액 부족이 아닌 이유로 실패했으면 응답을 잃은 예약도 같은 키로 해제) 로그만 남긴다: 선택지·요약처럼 다음 점검이 다시 하는 일에 쓴다.
     */
    private fun paid(owner: String, key: String, limit: BigDecimal, what: String, work: (reservation: String) -> BigDecimal) {
        var held = false // 예약했지만 아직 정산·해제하지 않았다.
        try {
            val reservation = try {
                credits.reserve(owner, key, limit)
            } catch (error: Exception) {
                if ((error as? ContentFailure)?.code != "INSUFFICIENT_CREDIT") release(owner, key) // 응답을 잃었어도 Core에 예약이 남았을 수 있다.
                throw error
            }
            held = true
            val amount = work(reservation)
            held = false
            settle(owner, key, amount)
        } catch (error: Exception) {
            if (held) release(owner, key)
            log.warn("{} failed; retrying later: {}", what, error.toString())
        }
    }

    private fun generate(input: RunInput, context: String, world: ObjectNode, reservation: String): GeneratedEpisode {
        val body = mapOf(
            "workId" to input.workId, "episodeNumber" to input.number, "direction" to input.direction,
            "choice" to input.choice?.let { mapOf("text" to it.choice.text, "votes" to it.votes) },
            "proposals" to input.proposals.map { mapOf("title" to it.proposal.title, "body" to it.proposal.body.take(PROPOSAL_BODY_MAX), "likes" to it.likes, "scene" to scene(it.proposal)) },
            "context" to context, "world" to world, "creditLimit" to episodeLimit, "creditReservationId" to reservation,
        )
        val episode = try {
            ai.episode(body)
        } catch (error: Exception) {
            val failure = error as? SerialAiFailure
            // 검수 실패와 크레딧 상한 초과는 일반 실패 문구와 구분해 남기고, 인물 시뮬레이션이 막은 실패(인물 카드 없음·필수 인물 문서 비어 있음 등)는 AI가 설명한 문구를 그대로 남긴다.
            throw SerialRunFailure(if (failure?.reviewFailed == true) SerialReason.REVIEW else if (failure?.limitExceeded == true) SerialReason.LIMIT else failure?.detail ?: SerialReason.AI, error)
        }
        // 검수를 통과하지 못한 원고는 발행하지 않는다(AI는 두 번 실패하면 422를 돌려주므로 보통 오지 않는다).
        if (!episode.reviewPassed) throw SerialRunFailure(SerialReason.REVIEW)
        return episode
    }

    private fun scene(proposal: SerialProposalEntity): String? = if (proposal.kind == "simulation") proposal.simulation?.get("scene") as? String else null

    /**
     * 회차 실행의 문맥: 소유자가 허용한 모든 것, 곧 가장 최근 발행 회차 3개의 원문과 그 이전 회차의 요약, 관련 장면 인용([related]), 연결된 세계관이 있으면 그 세계관 초안의 활성 카드([cards], 세계관 읽기와 같은 읽기에서 나온 것)다.
     */
    private fun ownerContext(input: RunInput, published: List<PublishedEpisodeResponse>, related: List<SerialRelated>, cards: List<SerialCard>): String {
        val episodes = published.map { SerialEpisode(it.number, it.title, it.body) }
        return serialContext(mapper, input.title, input.summary, episodes, cards, summariesFor(input.workId, episodes), related)
    }

    /**
     * 회차 실행이 AI의 인물 시뮬레이션에 넘기는 세계관이다. 일정 실행에는 사용자 토큰이 없어 AI가 Content MCP를 부를 수 없으므로 Content가 읽어 요청의 `world`로 싣는다.
     * MCP `world_studio_read(id, episode)`와 같은 서비스 읽기([WorldStudioService.draft])를 소유자 권한으로, 기준 회차(대상 회차의 직전 회차: 대상은 마지막 회차+1이다) 시점의 관계로 읽고
     * 「동일 인물」 관계만 최신 시점으로 한 번 더 읽어 `identity`에 덧붙인다(공개 회차 전에 작가가 이어 둔 두 카드는 기준 회차 시점으로는 묶이지 않는다. AI의 `read_world`와 같은 규칙).
     * 연결된 세계관이 없으면 Fork가 이어받는 원작 세계관([WorkWorldService.inheritedWorld], MCP `work_inherited_world`와 같은 읽기)을 싣고 `identity`는 그 응답의 관계에서 가려낸다. 둘 다 없으면 null이다.
     * 읽지 못하면 예외다: 읽지 못한 연결 세계관을 이어받는 세계관·관계 없는 세계관으로 대신하지 않는다.
     * 연결과 최신 시점 초안은 한 번만 읽어 요청의 `world`와 문맥의 카드가 같은 세계관의 같은 읽기에서 나오게 한다(두 번 읽는 사이 연결이 바뀌어 두 세계관이 섞이지 않게).
     */
    private fun ownerWorld(input: RunInput): OwnerWorld? {
        val basis = input.number - 1
        val subject = UUID.fromString(input.owner)
        val linked = workWorlds.linkedWorldId(input.workId, input.owner)
        if (linked != null) {
            val latest = worldStudio.draft(linked, subject)
            val cards = latest.cards.filter { it.lifecycle == "active" }.map { SerialCard(it.title, it.cardType, it.body, it.aliases) }
            return OwnerWorld(world(worldStudio.draft(linked, subject, basis), latest.relationships), cards)
        }
        val inherited = workWorlds.inheritedWorld(input.workId, input.owner, basis.toString())
        if (inherited.worldId == null) return null
        check(inherited.relationshipStatus == "current") { "원작 세계관의 관계를 읽을 수 없어요." } // MCP world_studio_read가 관계 저장 미완료에 503으로 답하는 것과 같다.
        return OwnerWorld(world(inherited, inherited.relationships), emptyList())
    }

    /** 세계관 읽기 응답([read])의 JSON에 `identity`(최신 시점 관계 [latest] 가운데 「동일 인물」 관계)를 덧붙인 AI 요청의 `world`다. */
    private fun world(read: Any, latest: List<RelationshipPayload>): ObjectNode =
        mapper.valueToTree<ObjectNode>(read).set("identity", mapper.valueToTree<JsonNode>(latest.filter { it.category == "identity" }))

    /**
     * 관련 장면 검색: 1위 선택지 글과 추천 상위 제안 글 제목을 질의로 독자 범위에서 최근 3화 이전 회차의 인용을 최대 6개 찾는다.
     * 최근 3화 이전 회차가 없거나 질의할 것이 없으면 검색하지 않고 빈 목록이다. 검색 단계가 실패하면 예외다(호출한 쪽이 이 실행을 [SerialReason.SEARCH]로 끝낸다).
     */
    private fun relatedScenes(input: RunInput, published: List<PublishedEpisodeResponse>): List<SerialRelated> {
        val basis = published.dropLast(RECENT_EPISODES).lastOrNull() ?: return emptyList()
        val query = relatedQuery(input.choice?.choice?.text, input.proposals.map { it.proposal.title }) ?: return emptyList()
        return qa.searchRelated(input.workId, query, QaEpisodeRef(basis.number, basis.versionId), RELATED_MAX).map { SerialRelated(it.episode, it.quote) }
    }

    /**
     * 시뮬레이션·선택지의 문맥: 독자에게 공개된 회차(독자 열람과 같은 읽기)와 독자 설정 위키의 카드만이다(세계관이 연결돼 있지 않으면 회차만). 이전 회차 요약도 싣는다.
     * 선택지는 독자에게 회차보다 먼저 공개되므로 소유자의 비공개 세계관 초안·공개 중단 회차는 싣지 않는다.
     */
    private fun readerContext(workId: String, title: String, summary: String): String {
        val episodes = works.publicEpisodes(workId).map { SerialEpisode(it.number, it.title, it.body) }
        return serialContext(mapper, title, summary, episodes, readerCards(workId), summariesFor(workId, episodes))
    }

    /**
     * 회차의 저장된 요약이다(최근 [RECENT_EPISODES]화는 원문이 있어 [serialContext]가 뺀다). 요약이 아직 없거나 발행 버전이 바뀐 회차는 빠지고, 독자에게 본문이 가려진 회차(원작이 삭제된 Fork의 상속 회차)의 요약도 싣지 않는다.
     */
    private fun summariesFor(workId: String, episodes: List<SerialEpisode>): List<SerialSummary> {
        val stored = summaries.stored(workId)
        return episodes.mapNotNull { episode -> stored[episode.number]?.takeIf { episode.body.isNotBlank() }?.let { SerialSummary(episode.number, episode.title, it) } }
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
