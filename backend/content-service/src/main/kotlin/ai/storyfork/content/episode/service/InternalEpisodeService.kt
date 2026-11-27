package ai.storyfork.content.episode.service

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.episode.repository.EpisodeCurrentRepository
import ai.storyfork.content.episode.repository.EpisodeRepository
import ai.storyfork.content.episode.service.dto.OperationsEpisodeResponse
import ai.storyfork.content.interest.entity.ContentEventOutboxEntity
import ai.storyfork.content.interest.repository.ContentEventOutboxRepository
import ai.storyfork.content.work.repository.WorkRepository
import ai.storyfork.content.work.service.WORK_RESTRICTED
import ai.storyfork.content.work.service.WORK_UNRESTRICTED
import java.util.UUID
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

/**
 * 운영 서비스 전용 회차 조회와 제한·해제다. 소유권 검사 없이 서비스 토큰으로만 보호된다. 제한은 독자 열람·조회수·댓글 같은 독자 경로만 막고 작가 집필은 그대로다.
 * 상속 회차(Fork가 원작에서 물려받은 회차)는 직접 바꾸지 못한다: 원작 회차를 제한하면 그 회차를 물려받은 Fork 회차도 뷰가 함께 숨긴다.
 */
@Service
@Transactional(transactionManager="contentTransactionManager")
class InternalEpisodeService(
    private val works: WorkRepository, private val current: EpisodeCurrentRepository, private val episodes: EpisodeRepository,
    private val outbox: ContentEventOutboxRepository,
) {
    /** 작품의 회차(번호순, 본문 없음)다. 없거나 지운 작품은 404다. */
    fun list(workId: String): List<OperationsEpisodeResponse> {
        works.findById(workId).orElse(null)?.takeIf { it.deletedAt == null } ?: throw missingWork()
        return items(workId)
    }

    /**
     * 회차 제한 플래그를 바꾼다(멱등). 작가 저장과 같은 작품 행 잠금으로 직렬화해 전체 행 저장이 플래그를 덮어쓰지 않게 한다.
     * 상속 회차는 409 EPISODE_INHERITED, 없는 회차는 404다. 응답의 제한 여부는 방금 바꾼 값이다(상속이 아닌 회차는 자기 값이 곧 결과다).
     * 플래그가 실제로 바뀔 때만 같은 트랜잭션에서 작품 소유자에게 보낼 운영자 조치 알림 사건(작품 제한과 같은 종류 + 회차 번호)을 outbox에 쓴다(#941).
     */
    fun restrict(workId: String, number: Int, restricted: Boolean): OperationsEpisodeResponse {
        val work = works.lockAll(listOf(workId)).singleOrNull()?.takeIf { it.deletedAt == null } ?: throw missingWork()
        val item = items(workId).firstOrNull { it.number == number } ?: throw missingEpisode()
        if (item.inherited) throw ContentFailure(409, "원작에서 물려받은 회차예요. 원작 회차를 제한해 주세요.", "EPISODE_INHERITED")
        val episode = episodes.findByWorkIdAndSequence(workId, number) ?: throw missingEpisode()
        if (episode.restricted != restricted) {
            episode.restricted = restricted
            outbox.save(ContentEventOutboxEntity(UUID.randomUUID(), if (restricted) WORK_RESTRICTED else WORK_UNRESTRICTED, work.ownerId, "work", workId,
                detailTitle = work.title, detailEpisode = number))
        }
        return item.copy(restricted = restricted)
    }

    private fun items(workId: String) = current.operationsRows(workId).map {
        OperationsEpisodeResponse((it[0] as Number).toInt(), (it[1] ?: it[2] ?: "") as String, it[3] as String, it[4] as Boolean, it[5] as Boolean)
    }

    private fun missingWork(): Nothing = throw ContentFailure(404, "작품을 찾을 수 없어요.")
    private fun missingEpisode(): Nothing = throw ContentFailure(404, "회차를 찾을 수 없어요.")
}
