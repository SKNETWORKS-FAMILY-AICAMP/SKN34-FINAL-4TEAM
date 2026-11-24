package ai.storyfork.content.preprocessing.service

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content._common.exception.checkContent
import ai.storyfork.content.auth.config.operatorReading
import ai.storyfork.content.episode.repository.EpisodeRepository
import ai.storyfork.content.preprocessing.client.PreprocessingAiClient
import ai.storyfork.content.preprocessing.client.PreprocessingAiFailure
import ai.storyfork.content.preprocessing.client.dto.PreprocessingAiRequest
import ai.storyfork.content.preprocessing.domain.PreprocessingKind
import ai.storyfork.content.preprocessing.domain.PreprocessingStatus
import ai.storyfork.content.preprocessing.entity.PreprocessingJobEntity
import ai.storyfork.content.preprocessing.repository.PreprocessingJobRepository
import ai.storyfork.content.preprocessing.service.dto.PreprocessingJobListResponse
import ai.storyfork.content.preprocessing.service.dto.PreprocessingJobResponse
import ai.storyfork.content.preprocessing.service.dto.PreprocessingProgressRequest
import ai.storyfork.content.preprocessing.service.dto.PreprocessingUpdateResponse
import ai.storyfork.content.work.domain.workPage
import ai.storyfork.content.work.entity.WorkEntity
import ai.storyfork.content.work.repository.WorkRepository
import ai.storyfork.content.world.service.ManuscriptBuildFinished
import ai.storyfork.content.world.service.ManuscriptBuildInput
import ai.storyfork.content.world.service.ManuscriptBuildService
import ai.storyfork.content.world.service.dto.ManuscriptBuildRequest
import java.time.Instant
import java.util.UUID
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Qualifier
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.data.domain.PageRequest
import org.springframework.data.domain.Sort
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Propagation
import org.springframework.transaction.annotation.Transactional
import org.springframework.transaction.event.TransactionalEventListener
import org.springframework.transaction.support.TransactionTemplate

/**
 * 회차 원고 전처리 작업의 접수·진행·재실행(DEC-50, #343 틀 단계)이다. 추출·정리·적재는 AI 서비스가 하고 여기는 작업 기록만 소유한다.
 * AI 호출 동안 DB 트랜잭션·행 잠금을 열어 두지 않도록 클래스에 트랜잭션을 걸지 않고 DB 쓰기마다 [transaction]으로 묶는다.
 */
@Service
class PreprocessingService(
    private val works: WorkRepository,
    private val episodes: EpisodeRepository,
    private val jobs: PreprocessingJobRepository,
    private val ai: PreprocessingAiClient,
    private val build: ManuscriptBuildService,
    @Qualifier("contentTransactions") private val transaction: TransactionTemplate,
) {
    private val log = LoggerFactory.getLogger(javaClass)

    /**
     * 소유자가 작품의 저장 회차 전체로 전처리를 접수한다. 소유자가 아니거나 없는 작품은 404, 저장 회차가 없으면 422,
     * 가장 최근 작업이 진행 중이거나 완료면 409다. 작업을 queued로 저장하고 최초 입력을 준비한 뒤에 AI에 접수한다. 입력을 준비할 수 없으면 404·409·422이고 접수 행을 지운다. AI의 접수 응답이 없으면 작업을 queued로 둔 채 502다(받았는지 알 수 없어 실패로 덮지 않는다).
     */
    fun start(workId: String, owner: String, request: ManuscriptBuildRequest? = null): PreprocessingJobResponse {
        val work = ownedWork(workId, owner)
        if (request != null) checkContent(request.consent && request.key.matches(Regex("[A-Za-z0-9:_-]{1,200}")), 422, "작가 동의와 요청 키가 필요해요.")
        val actor = UUID.fromString(owner)
        val last = jobs.findFirstByWorkIdAndKindOrderByCreatedAtDesc(workId, PreprocessingKind.INITIAL)
        if (last != null) guardQueuedSnapshot(last)
        if (last != null && request != null && build.matches(last.id, actor, request)) {
            val current = build.status(UUID.fromString(last.id), actor) ?: throw missing()
            if (request.resumeToken != null) {
                checkContent(request.resumeToken == current.executionToken, 409, "재개할 작업이 변경되었어요.")
                return retry(last.id, ownerDetail = true)
            }
            if (current.status == "queued" || current.status == "unknown" && last.status == PreprocessingStatus.LOADING)
                return handOff(last, jobs.frozenNumbers(last.id, workId, owner))
            return ownerView(last)
        }
        checkContent(request?.resumeToken == null, 409, "기존 요청으로만 재개할 수 있어요.")
        val id = UUID.randomUUID()
        val world = work.worldStudioId ?: request?.worldId ?: id
        checkContent(request == null || request.worldId == world, 409, "작품에 연결된 세계관이 달라요.")
        val (job, frozen) = claim {
            val previous = jobs.findFirstByWorkIdAndKindOrderByCreatedAtDesc(workId, PreprocessingKind.INITIAL)
            checkContent(previous == null || previous.status == PreprocessingStatus.FAILED, 409, OPEN_JOB_EXISTS)
            if (request != null && jobs.requestKeyExists(workId, request.key))
                throw ContentFailure(409, "이 요청 키는 이미 이전 작업에 사용됐어요.", "PREPROCESSING_REQUEST_KEY_USED")
            if (previous != null && jobs.requiresLoadReview(workId))
                throw ContentFailure(409, "이전 작업의 적재 여부를 먼저 확인해 주세요.", "PREPROCESSING_LOAD_REVIEW_REQUIRED")
            checkContent(episodes.savedNumbers(workId).isNotEmpty(), 422, "저장한 회차가 있어야 세계관을 만들 수 있어요.")
            val input = build.freeze(workId, owner)
            jobs.saveAndFlush(PreprocessingJobEntity(id=id.toString(), workId=workId, worldId=world,
                memberId=owner, total=input.episodes.size)) to input
        }
        try {
            build.prepare(id, workId, actor, request ?: ManuscriptBuildRequest(world, id.toString(), true), frozen)
        } catch (error: Exception) {
            discard(job, workId, owner)
            throw error
        }
        return handOff(job, frozen.episodes.map { it.number })
    }

    fun completedInitialBuild(workId: String, world: UUID): Boolean =
        jobs.findFirstByWorkIdAndKindOrderByCreatedAtDesc(workId, PreprocessingKind.INITIAL)
            ?.let { it.status == PreprocessingStatus.COMPLETED && it.worldId == world } == true

    /** 첫 발행 커밋 콜백에서 아직 묶여 있는 발행 트랜잭션을 중단하고 접수한다. */
    @Transactional(propagation = Propagation.NOT_SUPPORTED, transactionManager = "contentTransactionManager")
    fun startUpdate(workId: String, owner: String, versionId: String): String =
        enqueueUpdate(workId, owner, "publish:$versionId")

    /** WorldStudio의 최종 적재·실패 커밋 뒤, 기존 트랜잭션 자원을 잠시 분리해 접수한다. */
    @TransactionalEventListener
    @Transactional(propagation = Propagation.NOT_SUPPORTED, transactionManager = "worldStudioTransactionManager")
    fun continueUpdate(event: ManuscriptBuildFinished) {
        val result = enqueueUpdate(event.workId, event.owner.toString(), "continue:${event.jobId}:${event.jobVersion}", event.worldId)
        log.info("세계관 후속 업데이트 접수: work={} result={}", event.workId, result)
    }

    /** 두 자동 진입점이 같은 잠금 안에서 진행 작업과 이미 처리한 회차를 읽고, 접수 자리를 하나만 확보한다. */
    private fun enqueueUpdate(workId: String, owner: String, key: String, expectedWorld: UUID? = null): String {
        return try {
            val (job, frozen) = claim {
                val work = works.lockAll(listOf(workId)).singleOrNull()?.takeIf { it.ownerId == owner && it.deletedAt == null }
                    ?: throw ContentFailure(404, "작품을 찾을 수 없어요.", "NO_WORK")
                val world = work.worldStudioId?.takeIf { expectedWorld == null || it == expectedWorld }
                    ?: throw ContentFailure(409, "연결된 세계관을 확인해 주세요.", "NO_WORLD")
                if (!completedInitialBuild(workId, world))
                    throw ContentFailure(409, "세계관의 최초 구축이 끝나야 해요.", "INITIAL_NOT_COMPLETED")
                if (jobs.openOn(world)) throw ContentFailure(409, OPEN_JOB_EXISTS, "OPEN_JOB")
                val excluded = jobs.reflectedNumbers(workId) + jobs.failedUpdateNumbers(workId, world)
                val frozen = build.freezeUpdate(workId, excluded)
                    ?: throw ContentFailure(409, "새로 반영할 회차가 없어요.", "NO_NEW_EPISODES")
                if (jobs.requestKeyExists(workId, key))
                    throw ContentFailure(409, "이 요청 키는 이미 이전 작업에 사용됐어요.", "PREPROCESSING_REQUEST_KEY_USED")
                reserveUpdate(workId, owner, world, frozen) to frozen
            }
            prepareAndHandOffUpdate(job, key, frozen, ownerDetail = false)
            "STARTED"
        } catch (e: ContentFailure) {
            e.code ?: "HTTP_${e.status}"
        } catch (e: RuntimeException) {
            e.javaClass.simpleName
        }
    }

    private fun reserveUpdate(workId: String, owner: String, world: UUID, input: ManuscriptBuildInput): PreprocessingJobEntity =
        jobs.saveAndFlush(PreprocessingJobEntity(id = UUID.randomUUID().toString(), workId = workId, worldId = world,
            memberId = owner, total = input.episodes.size, kind = PreprocessingKind.UPDATE))

    /** 기존 작업을 재개하지 않는 새 update는 고정 입력을 먼저 저장한 뒤 AI에 넘긴다. */
    private fun prepareAndHandOffUpdate(
        job: PreprocessingJobEntity, key: String, input: ManuscriptBuildInput, ownerDetail: Boolean,
    ): PreprocessingJobResponse {
        try {
            build.prepareUpdate(UUID.fromString(job.id), job.workId, UUID.fromString(job.memberId),
                ManuscriptBuildRequest(requireNotNull(job.worldId), key, true), input)
        } catch (error: Exception) {
            discard(job, job.workId, job.memberId)
            throw error
        }
        return handOff(job, input.episodes.map { it.number }, ownerDetail)
    }

    /** 접수가 성립하지 않았다. 최초 입력이 만들어지지 않았으면 접수 행을 지우고(실패 행으로 남기면 작품이 적재 확인 대기로 영구히 막힌다) 만들어진 뒤의 실패만 failed 행으로 남긴다. */
    private fun discard(job: PreprocessingJobEntity, workId: String, owner: String) {
        transaction.executeWithoutResult {
            val row = jobs.lock(job.id) ?: throw missing()
            if (jobs.frozenNumbers(row.id, workId, owner).isEmpty()) jobs.delete(row)
            else {
                row.fail("최초 입력 준비 결과를 확인해 주세요.", Instant.now())
                jobs.saveAndFlush(row)
            }
        }
    }

    /**
     * 소유자 화면용 최신 작업이다. 소유자가 아니거나 없는 작품은 404, 아직 접수한 적이 없으면 404 PREPROCESSING_NOT_STARTED다.
     * 기존 필드는 최초 구축 작업이고 `update`는 진행 중인 업데이트를 우선하며 없으면 가장 최근 것을 싣는다.
     */
    fun latest(workId: String, owner: String): PreprocessingJobResponse {
        ownedWork(workId, owner)
        val job = jobs.findFirstByWorkIdAndKindOrderByCreatedAtDesc(workId, PreprocessingKind.INITIAL) ?: throw ContentFailure(404, "전처리 작업이 없어요.", "PREPROCESSING_NOT_STARTED")
        val update = (jobs.findFirstByWorkIdAndKindAndStatusInOrderByCreatedAtDesc(workId, PreprocessingKind.UPDATE, PreprocessingStatus.OPEN)
            ?: jobs.findFirstByWorkIdAndKindOrderByCreatedAtDesc(workId, PreprocessingKind.UPDATE))?.let(::updateView)
        return ownerView(job, inspectQueued = true).copy(update = update)
    }

    /** AI의 진행 보고를 기록한다. 없는 작업은 404, 이미 끝난 작업은 409, 값 오류는 422다. */
    fun progress(jobId: String, request: PreprocessingProgressRequest): PreprocessingJobResponse =
        requireNotNull(transaction.execute {
            val job = jobs.lock(jobId) ?: throw missing()
            checkContent(jobs.frozenNumbers(job.id,job.workId,job.memberId).isEmpty(),409,"저장된 실행 결과로만 진행 상태를 변경할 수 있어요.")
            job.report(request.stage, request.done, request.total, request.failedEpisodes, request.failed, Instant.now())
            view(jobs.saveAndFlush(job))
        })

    /**
     * 운영 감시용 목록이다. V15 작업 행(manuscript_build_job)이 있는 작업만 최신 접수 순으로 보인다. [status]는 소문자 상태 이름, [page]는 0부터, [size]는 1~100(기본 20)이며 틀린 값은 422다.
     * 작업 행의 `unknown`(적재 결과 확인 대기)은 운영 화면이 모르는 상태라 `loading`으로 보이고, `loading` 필터는 둘 다 찾는다.
     */
    fun list(status: String?, page: String?, size: String?): PreprocessingJobListResponse {
        checkContent(status == null || status in PreprocessingStatus.ALL, 422, "status 값을 확인해 주세요.")
        // page를 채워 부르면 workPage는 항상 값을 준다(기본 size는 그쪽 기본값).
        val window = requireNotNull(workPage(page ?: "0", size))
        val request = PageRequest.of(window.page, window.size, NEWEST_FIRST)
        val found = if (status == null) jobs.snapshots(request)
            else jobs.snapshotsByStatus(if (status == PreprocessingStatus.LOADING) listOf(status, UNCONFIRMED) else listOf(status), request)
        // ponytail: 행 선택·상태 필터는 V15 작업 행이 정하고 표시값(진행 수·실패 회차·시각·사유)은 V15 트리거가 같은 id의 V41 행에 미러링한 것이다. 골격 preprocessing_job 정리는 후속이다.
        return PreprocessingJobListResponse(found.content.map(::view), found.totalElements)
    }

    /**
     * 운영 재실행이다. 최초 구축은 가장 최근 작업을, 업데이트는 다른 작업이 진행 중이지 않으면 이전 실패 작업도 다시 접수한다.
     * 고정 입력과 저장한 추출 결과를 재사용한다. SOURCE_CHANGED는 현재 발행본으로 새 작업을 만든다.
     */
    fun retry(jobId: String, ownerDetail: Boolean = false): PreprocessingJobResponse {
        val (job, numbers, replacement) = claim {
            val job = jobs.lock(jobId) ?: throw missing()
            guardQueuedSnapshot(job)
            val expired = job.status == PreprocessingStatus.RUNNING && jobs.hasExpiredLease(job.id)
            checkContent(job.status == PreprocessingStatus.FAILED || expired, 409, "실패하거나 실행권이 만료된 작업만 다시 실행할 수 있어요.")
            if (job.kind == PreprocessingKind.UPDATE) {
                val work = works.lockAll(listOf(job.workId)).singleOrNull()
                val world = job.worldId
                checkContent(world != null && work != null && work.worldStudioId == world && work.ownerId == job.memberId && work.deletedAt == null,
                    409, "작품에 연결된 세계관이 달라요.")
                checkContent(expired || !jobs.openOn(requireNotNull(world)), 409, "같은 세계관에 진행 중인 전처리 작업이 있어요.")
            } else {
                checkContent(jobs.findFirstByWorkIdAndKindOrderByCreatedAtDesc(job.workId, job.kind)?.id == job.id,
                    409, "더 새로운 전처리 작업이 있어 다시 실행할 수 없어요.")
            }
            val frozen = jobs.frozenNumbers(job.id, job.workId, job.memberId)
            if (frozen.isEmpty()) throw missingSnapshot()
            if (job.kind == PreprocessingKind.UPDATE) {
                val reflected = jobs.reflectedNumbers(job.workId)
                if (job.failedReason == "SOURCE_CHANGED") {
                    val current = build.freezeUpdate(job.workId, reflected, only = frozen.toSet())
                        ?: throw ContentFailure(409, "다시 반영할 수 있는 발행 회차가 없어요.")
                    val replacement = reserveUpdate(job.workId, job.memberId, requireNotNull(job.worldId), current)
                    return@claim Triple(replacement, emptyList(), current)
                }
                // 이전 계약으로 만든 작업에는 다른 작업이 이미 반영한 회차가 섞여 있을 수 있다.
                checkContent(reflected.none { it in frozen }, 409, "이미 다른 작업으로 세계관에 반영된 회차가 있어 다시 실행할 수 없어요.")
            }
            val numbers = job.failedEpisodes.ifEmpty { frozen }
            checkContent(frozen.containsAll(numbers), 409, "최초 입력과 실패 회차가 일치하지 않아요.")
            checkContent(jobs.requeueSnapshot(job.id)==1,409,"스냅샷의 실행 상태를 확인해 주세요.")
            if (expired) job.status = PreprocessingStatus.FAILED
            job.requeue()
            checkContent(numbers.isNotEmpty(), 422, "저장한 회차가 있어야 다시 실행할 수 있어요.")
            Triple(jobs.saveAndFlush(job), numbers, null)
        }
        return if (replacement == null) handOff(job, numbers, ownerDetail)
            else prepareAndHandOffUpdate(job, "retry:${job.id}", replacement, ownerDetail)
    }

    /** 트랜잭션 안에서 접수·재실행 상태를 바꾼다. 같은 작품의 진행 중·완료 작업이 이미 있어 유일 인덱스가 거절하면 409다. */
    private fun <T> claim(block: () -> T): T =
        try { requireNotNull(transaction.execute { block() }) } catch (_: DataIntegrityViolationException) { throw ContentFailure(409, OPEN_JOB_EXISTS) }

    /** 저장이 끝난 작업을 AI에 접수시킨다. 접수 응답이 없으면 502를 반환한다. */
    private fun handOff(job: PreprocessingJobEntity, numbers: List<Int>, ownerDetail: Boolean = true): PreprocessingJobResponse {
        try {
            ai.accept(PreprocessingAiRequest(job.id, job.workId, numbers))
        } catch (e: PreprocessingAiFailure) {
            log.warn("preprocessing job {} was not accepted by the AI service: {}", job.id, e.code)
            // 응답이 없어도 worker가 이미 실행권을 얻었을 수 있다. update만 실행권 없는 queued 상태일 때 실패로 끝낸다.
            if (job.kind == PreprocessingKind.UPDATE)
                runCatching { build.failQueued(UUID.fromString(job.id), UUID.fromString(job.memberId), "AI_INTAKE_FAILED") }
            throw ContentFailure(502, "전처리를 시작하지 못했어요. 잠시 뒤 다시 시도해 주세요.", "PREPROCESSING_AI_FAILED")
        }
        return if(ownerDetail) ownerView(job) else view(job)
    }

    private fun ownedWork(workId: String, owner: String): WorkEntity =
        works.findById(workId).orElse(null)?.takeIf { (it.ownerId == owner || operatorReading()) && it.deletedAt == null } ?: throw ContentFailure(404, "작품을 찾을 수 없어요.")

    private fun missingSnapshot() = ContentFailure(409, "최초 입력을 확인할 수 없어 작업 상태를 확인해야 해요.", "PREPROCESSING_SNAPSHOT_MISSING")

    private fun guardQueuedSnapshot(job: PreprocessingJobEntity) {
        if (job.status == PreprocessingStatus.QUEUED && jobs.frozenNumbers(job.id, job.workId, job.memberId).isEmpty())
            throw missingSnapshot()
    }

    private fun missing() = ContentFailure(404, "전처리 작업을 찾을 수 없어요.")

    private fun view(job: PreprocessingJobEntity) = PreprocessingJobResponse(job.id,job.workId,job.status,job.done,job.total,
        job.failedEpisodes,job.failedReason,job.startedAt?.toString(),job.finishedAt?.toString())

    /** 업데이트 작업 요약이다. 상태·사유는 build 응답과 같은 값(만료된 실행은 unknown)이고 V15 작업 행이 없으면 미러 행의 값이다. */
    private fun updateView(job: PreprocessingJobEntity): PreprocessingUpdateResponse {
        val detail = runCatching { UUID.fromString(job.id) to UUID.fromString(job.memberId) }.getOrNull()?.let { (id, owner) -> build.status(id, owner) }
        return PreprocessingUpdateResponse(job.id, detail?.status ?: job.status, jobs.frozenNumbers(job.id, job.workId, job.memberId), detail?.failureCode ?: job.failedReason)
    }

    private fun ownerView(job: PreprocessingJobEntity, inspectQueued: Boolean = false): PreprocessingJobResponse {
        val detail = runCatching { UUID.fromString(job.id) to UUID.fromString(job.memberId) }.getOrNull()
            ?.let { (id, owner) -> build.status(id, owner) }
        val recovery = if (inspectQueued && detail == null && job.status == PreprocessingStatus.QUEUED) "manual_review"
        else if (detail == null && job.status == PreprocessingStatus.FAILED) {
            if (jobs.requiresLoadReview(job.workId)) "manual_review" else "new_request"
        } else null
        return view(job).copy(build=detail,recovery=recovery)
    }

    companion object {
        /** AI가 접수하지 않았을 때 작업에 남기는 고정 사유다. 호출 오류의 내용은 담지 않는다. */
        const val AI_CALL_FAILED = "AI 서비스가 전처리 요청을 받지 못했어요."
        private const val OPEN_JOB_EXISTS = "이미 진행 중이거나 완료된 전처리 작업이 있어요."
        /** V15 작업 행에만 있는 상태다(적재 결과 확인 대기). V41 미러·운영 화면에서는 loading이다. */
        private const val UNCONFIRMED = "unknown"
        private val NEWEST_FIRST = Sort.by(Sort.Order.desc("createdAt"), Sort.Order.asc("id"))
    }
}
