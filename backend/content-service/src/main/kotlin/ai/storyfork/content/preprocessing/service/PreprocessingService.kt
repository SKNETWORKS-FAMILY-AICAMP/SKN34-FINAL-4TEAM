package ai.storyfork.content.preprocessing.service

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content._common.exception.checkContent
import ai.storyfork.content.episode.repository.EpisodeRepository
import ai.storyfork.content.preprocessing.client.PreprocessingAiClient
import ai.storyfork.content.preprocessing.client.PreprocessingAiFailure
import ai.storyfork.content.preprocessing.client.dto.PreprocessingAiRequest
import ai.storyfork.content.preprocessing.domain.PreprocessingStatus
import ai.storyfork.content.preprocessing.entity.PreprocessingJobEntity
import ai.storyfork.content.preprocessing.repository.PreprocessingJobRepository
import ai.storyfork.content.preprocessing.service.dto.PreprocessingJobListResponse
import ai.storyfork.content.preprocessing.service.dto.PreprocessingJobResponse
import ai.storyfork.content.preprocessing.service.dto.PreprocessingProgressRequest
import ai.storyfork.content.work.domain.workPage
import ai.storyfork.content.work.entity.WorkEntity
import ai.storyfork.content.work.repository.WorkRepository
import java.time.Instant
import java.util.UUID
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Qualifier
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.data.domain.PageRequest
import org.springframework.data.domain.Sort
import org.springframework.stereotype.Service
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
    @Qualifier("contentTransactions") private val transaction: TransactionTemplate,
) {
    private val log = LoggerFactory.getLogger(javaClass)

    /**
     * 소유자가 작품의 저장 회차 전체로 전처리를 접수한다. 소유자가 아니거나 없는 작품은 404, 저장 회차가 없으면 422,
     * 가장 최근 작업이 진행 중이거나 완료면 409다. 작업을 queued로 저장한 뒤에 AI에 접수하고, AI가 받지 않으면 작업을 failed로 남기고 502다.
     */
    fun start(workId: String, owner: String): PreprocessingJobResponse {
        val (job, numbers) = claim {
            val work = ownedWork(workId, owner)
            val numbers = episodes.savedNumbers(workId)
            checkContent(numbers.isNotEmpty(), 422, "저장한 회차가 있어야 세계관을 만들 수 있어요.")
            val last = jobs.findFirstByWorkIdOrderByCreatedAtDesc(workId)
            checkContent(last == null || last.status == PreprocessingStatus.FAILED, 409, OPEN_JOB_EXISTS)
            jobs.saveAndFlush(PreprocessingJobEntity(id = UUID.randomUUID().toString(), workId = workId, worldId = work.worldStudioId,
                memberId = owner, total = numbers.size)) to numbers
        }
        return handOff(job, numbers)
    }

    /** 소유자 화면용 최신 작업이다. 소유자가 아니거나 없는 작품은 404, 아직 접수한 적이 없으면 404 PREPROCESSING_NOT_STARTED다. */
    fun latest(workId: String, owner: String): PreprocessingJobResponse {
        ownedWork(workId, owner)
        val job = jobs.findFirstByWorkIdOrderByCreatedAtDesc(workId) ?: throw ContentFailure(404, "전처리 작업이 없어요.", "PREPROCESSING_NOT_STARTED")
        return view(job)
    }

    /** AI의 진행 보고를 기록한다. 없는 작업은 404, 이미 끝난 작업은 409, 값 오류는 422다. */
    fun progress(jobId: String, request: PreprocessingProgressRequest): PreprocessingJobResponse =
        requireNotNull(transaction.execute {
            val job = jobs.lock(jobId) ?: throw missing()
            job.report(request.stage, request.done, request.total, request.failedEpisodes, request.failed, Instant.now())
            view(jobs.saveAndFlush(job))
        })

    /** 운영 감시용 목록이다. 최신 접수 순이고 [status]는 소문자 상태 이름, [page]는 0부터, [size]는 1~100(기본 20)이며 틀린 값은 422다. */
    fun list(status: String?, page: String?, size: String?): PreprocessingJobListResponse {
        checkContent(status == null || status in PreprocessingStatus.ALL, 422, "status 값을 확인해 주세요.")
        // page를 채워 부르면 workPage는 항상 값을 준다(기본 size는 그쪽 기본값).
        val window = requireNotNull(workPage(page ?: "0", size))
        val request = PageRequest.of(window.page, window.size, NEWEST_FIRST)
        val found = if (status == null) jobs.findAll(request) else jobs.findAllByStatus(status, request)
        return PreprocessingJobListResponse(found.content.map(::view), found.totalElements)
    }

    /**
     * 운영 재실행이다. 실패한 작업이면서 그 작품의 가장 최근 작업일 때만(그 밖은 409) 대기로 되돌리고 실패 회차만(없으면 저장 회차 전체를) 다시 접수한다.
     * 없는 작업은 404, AI가 받지 않으면 작업을 다시 failed로 남기고 502다.
     */
    fun retry(jobId: String): PreprocessingJobResponse {
        val (job, numbers) = claim {
            val job = jobs.lock(jobId) ?: throw missing()
            job.requeue()
            checkContent(jobs.findFirstByWorkIdOrderByCreatedAtDesc(job.workId)?.id == job.id, 409, "더 새로운 전처리 작업이 있어 다시 실행할 수 없어요.")
            val numbers = job.failedEpisodes.ifEmpty { episodes.savedNumbers(job.workId) }
            checkContent(numbers.isNotEmpty(), 422, "저장한 회차가 있어야 다시 실행할 수 있어요.")
            jobs.saveAndFlush(job) to numbers
        }
        return handOff(job, numbers)
    }

    /** 트랜잭션 안에서 접수·재실행 상태를 바꾼다. 같은 작품의 진행 중·완료 작업이 이미 있어 유일 인덱스가 거절하면 409다. */
    private fun <T> claim(block: () -> T): T =
        try { requireNotNull(transaction.execute { block() }) } catch (_: DataIntegrityViolationException) { throw ContentFailure(409, OPEN_JOB_EXISTS) }

    /** 저장이 끝난 작업을 AI에 접수시킨다. AI가 받지 않으면 작업을 failed로 남기고 502다(성공으로 보이게 두지 않는다). */
    private fun handOff(job: PreprocessingJobEntity, numbers: List<Int>): PreprocessingJobResponse {
        try {
            ai.accept(PreprocessingAiRequest(job.id, job.workId, numbers))
        } catch (e: PreprocessingAiFailure) {
            log.warn("preprocessing job {} was not accepted by the AI service: {}", job.id, e.code)
            transaction.executeWithoutResult { job.fail(AI_CALL_FAILED, Instant.now()); jobs.saveAndFlush(job) }
            throw ContentFailure(502, "전처리를 시작하지 못했어요. 잠시 뒤 다시 시도해 주세요.", "PREPROCESSING_AI_FAILED")
        }
        return view(job)
    }

    private fun ownedWork(workId: String, owner: String): WorkEntity =
        works.findById(workId).orElse(null)?.takeIf { it.ownerId == owner && it.deletedAt == null } ?: throw ContentFailure(404, "작품을 찾을 수 없어요.")

    private fun missing() = ContentFailure(404, "전처리 작업을 찾을 수 없어요.")

    private fun view(job: PreprocessingJobEntity) = PreprocessingJobResponse(job.id, job.workId, job.status, job.done, job.total,
        job.failedEpisodes, job.failedReason, job.startedAt?.toString(), job.finishedAt?.toString())

    companion object {
        /** AI가 접수하지 않았을 때 작업에 남기는 고정 사유다. 호출 오류의 내용은 담지 않는다. */
        const val AI_CALL_FAILED = "AI 서비스가 전처리 요청을 받지 못했어요."
        private const val OPEN_JOB_EXISTS = "이미 진행 중이거나 완료된 전처리 작업이 있어요."
        private val NEWEST_FIRST = Sort.by(Sort.Order.desc("createdAt"), Sort.Order.asc("id"))
    }
}
