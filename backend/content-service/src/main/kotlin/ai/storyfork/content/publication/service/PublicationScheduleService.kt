package ai.storyfork.content.publication.service

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content._common.exception.checkContent
import ai.storyfork.content._common.helper.contentId
import ai.storyfork.content.auth.client.exception.CoreAuthException
import ai.storyfork.content.auth.service.CoreAuthVerificationService
import ai.storyfork.content.episode.repository.EpisodeRepository
import ai.storyfork.content.episode.service.EpisodeService
import ai.storyfork.content.publication.entity.PublicationScheduleEntity
import ai.storyfork.content.publication.repository.PublicationScheduleRepository
import ai.storyfork.content.publication.service.dto.PublicationScheduleRequest
import ai.storyfork.content.publication.service.dto.PublicationScheduleResponse
import ai.storyfork.content.work.service.WorkAccessService
import java.time.Instant
import org.slf4j.LoggerFactory
import org.springframework.beans.factory.annotation.Qualifier
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.dao.TransientDataAccessException
import org.springframework.data.domain.PageRequest
import org.springframework.scheduling.annotation.Scheduled
import org.springframework.stereotype.Service
import org.springframework.transaction.CannotCreateTransactionException
import org.springframework.transaction.annotation.Transactional
import org.springframework.transaction.support.TransactionTemplate

@Service
class PublicationScheduleService(
    private val access: WorkAccessService,
    private val episodes: EpisodeRepository,
    private val writing: EpisodeService,
    private val schedules: PublicationScheduleRepository,
    private val publication: PublicationService,
    private val auth: CoreAuthVerificationService,
    @Qualifier("contentTransactions") private val transaction: TransactionTemplate,
) {
    private val log = LoggerFactory.getLogger(javaClass)

    @Transactional("contentTransactionManager")
    fun list(work: String, owner: String, number: Int): List<PublicationScheduleResponse> =
        schedules.findAllByEpisodeIdOrderByScheduledAtDescIdDesc(ownedEpisode(work, owner, number)).map { it.response() }

    @Transactional("contentTransactionManager")
    fun create(work: String, owner: String, number: Int, request: PublicationScheduleRequest): PublicationScheduleResponse {
        val episode = ownedEpisode(work, owner, number)
        validate(work, owner, number, request)
        checkContent(!schedules.existsByEpisodeIdAndStatus(episode, "pending"), 409, "이미 대기 중인 예약이 있어요.")
        return try {
            schedules.saveAndFlush(PublicationScheduleEntity(
                id = contentId(), workId = work, episodeId = episode, ownerId = owner,
                versionId = request.versionId, scheduledAt = request.scheduledAt,
            )).response()
        } catch (_: DataIntegrityViolationException) {
            // 동시 등록은 부분 유니크 인덱스(publication_schedule_one_pending)가 막는다.
            throw ContentFailure(409, "이미 대기 중인 예약이 있어요.")
        }
    }

    @Transactional("contentTransactionManager")
    fun update(work: String, owner: String, number: Int, id: String, request: PublicationScheduleRequest): PublicationScheduleResponse {
        val row = ownedSchedule(ownedEpisode(work, owner, number), id)
        val revision = request.revision ?: throw ContentFailure(400, "예약 수정 번호가 필요해요.")
        row.requireEditable(revision)
        validate(work, owner, number, request)
        row.reschedule(revision, request.versionId, request.scheduledAt)
        return row.response()
    }

    @Transactional("contentTransactionManager")
    fun cancel(work: String, owner: String, number: Int, id: String, revision: Int) {
        ownedSchedule(ownedEpisode(work, owner, number), id).cancel(revision, Instant.now())
    }

    @Scheduled(fixedDelay = 5000)
    fun publishDue() {
        val deferredWorks = mutableSetOf<String>()
        // 같은 시각의 연속 회차가 앞 회차부터 공개되도록 쿼리가 (예약 시각, 회차 번호) 순으로 25건을 고른다.
        schedules.findDue("pending", Instant.now(), PageRequest.of(0, 25)).forEach { candidate ->
            if (candidate.workId in deferredWorks) return@forEach // 앞 회차가 보류된 작품의 뒤 회차는 같은 주기에 실행하지 않는다.
            try {
                try {
                    // Core가 회원 존재·제한 여부와 UUID 일치(불일치는 401)를 확인한다.
                    auth.verifyScheduledMember(candidate.ownerId)
                    transaction.executeWithoutResult {
                        val row = stillDue(candidate) ?: return@executeWithoutResult
                        val episode = episodes.findById(row.episodeId).orElseThrow { ContentFailure(404, "회차를 찾을 수 없어요.") }
                        publication.publishScheduled(row.workId, row.ownerId, episode.sequence, row.versionId)
                        row.complete(Instant.now())
                    }
                } catch (failure: Exception) {
                    if (failure.isTransient()) {
                        // 일시적인 Core·DB 장애는 실패로 확정하지 않고 대기 상태로 두어 다음 주기에 다시 시도한다.
                        deferredWorks += candidate.workId
                        log.warn("Scheduled publication {} deferred: {}", candidate.id, (failure as? CoreAuthException)?.code ?: failure.javaClass.simpleName)
                        return@forEach
                    }
                    val reason = when (failure) {
                        is ContentFailure -> failure.message
                        is CoreAuthException -> if (failure.status == 401) "발행 권한을 확인할 수 없는 회원이에요." else "인증 서비스에서 발행 권한을 확인하지 못했어요."
                        else -> "예약 발행을 처리하지 못했어요."
                    }
                    if (failure !is ContentFailure) log.warn("Scheduled publication {} failed", candidate.id, failure)
                    // 발행을 먼저 롤백한 뒤 같은 대기 예약에만 실패를 기록한다.
                    transaction.executeWithoutResult {
                        stillDue(candidate)?.complete(Instant.now(), reason)
                    }
                }
            } catch (failure: Exception) {
                log.error("Could not record scheduled publication {} result", candidate.id, failure)
            }
        }
    }

    private fun stillDue(candidate: PublicationScheduleEntity): PublicationScheduleEntity? {
        access.lockScope(candidate.workId)
        return schedules.findById(candidate.id).orElse(null)?.takeIf {
            it.revision == candidate.revision && it.isDue(Instant.now())
        }
    }

    private fun ownedEpisode(work: String, owner: String, number: Int): String {
        access.own(work, owner)
        return episodes.findByWorkIdAndSequence(work, number)?.id ?: throw ContentFailure(404, "회차를 찾을 수 없어요.")
    }

    private fun ownedSchedule(episode: String, id: String): PublicationScheduleEntity =
        schedules.findById(id).orElse(null)?.takeIf { it.episodeId == episode }
            ?: throw ContentFailure(404, "이 회차의 예약을 찾을 수 없어요.")

    private fun validate(work: String, owner: String, number: Int, request: PublicationScheduleRequest) {
        checkContent(request.scheduledAt > Instant.now(), message = "예약 시각은 미래로 지정해 주세요.")
        checkContent(request.rightsConfirmed, message = "공개 권리를 확인해 주세요.")
        val episode = writing.read(work, owner, number)
        checkContent(!episode.inherited, 403, "원작 기준 회차는 예약 발행할 수 없어요.")
        checkContent(episode.versions.any { it.id == request.versionId && it.body.isNotBlank() }, 409, "본문이 있는 저장 버전을 선택해 주세요.")
    }

    private fun Exception.isTransient() = this is TransientDataAccessException || this is CannotCreateTransactionException ||
        (this is CoreAuthException && status in 503..504)

    private fun PublicationScheduleEntity.response() =
        PublicationScheduleResponse(id, versionId, scheduledAt.toString(), status, revision, completedAt?.toString(), failureReason)
}
