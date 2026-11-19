package ai.storyfork.content.fork.service

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.episode.repository.EpisodeCurrentRepository
import ai.storyfork.content.episode.repository.EpisodeRepository
import ai.storyfork.content.episode_version.repository.CheckpointRepository
import ai.storyfork.content.fork.repository.ForkRepository
import ai.storyfork.content.fork.service.dto.LeakReferencesResponse
import ai.storyfork.content.work.repository.WorkRepository
import ai.storyfork.content.world.service.PublicWorldService
import java.util.UUID
import org.springframework.beans.factory.annotation.Qualifier
import org.springframework.stereotype.Service
import org.springframework.transaction.support.TransactionTemplate

/** 새 회차에 붙는 기본 제목이다. 작가가 지은 제목이 아니라서 누설 비교 기준에서 뺀다. */
private const val DEFAULT_EPISODE_TITLE = "새 회차"

/**
 * 운영 서비스 전용 정보 누설 비교 기준(DEC-55)이다. Fork 작품이면 Fork 독자에게 보이면 안 되는 원작 쪽 제목을 준다:
 * 원작 연결 세계관의 카드 중 Fork 기준 회차에 안 보이는 것(작가 전용·기준 회차 뒤, DEC-53 [PublicWorldService.hiddenCardTitles])과 기준 회차 뒤 원작 회차다.
 * Fork가 아니면 비어 있고 없는·삭제된 작품은 404다. Content와 WorldStudio 트랜잭션은 겹치지 않게 차례로 연다.
 * ponytail: 회차 제목은 현재 초안과 발행본만 본다(이전 저장 버전의 옛 제목은 뺀다). 개명이 잦아 놓치면 저장 버전 제목까지 넓힌다.
 */
@Service
class ForkLeakReferenceService(
    private val works: WorkRepository,
    private val forks: ForkRepository,
    private val checkpoints: CheckpointRepository,
    private val episodes: EpisodeRepository,
    private val current: EpisodeCurrentRepository,
    private val publicWorlds: PublicWorldService,
    @Qualifier("contentTransactions") private val transaction: TransactionTemplate,
) {
    /** Fork의 원작·고정 기준 회차·원작 연결 세계관과 기준 회차 뒤 원작 회차 제목이다. */
    private class Origin(val workId: String, val basis: Int, val worldId: UUID?, val episodeTitles: List<String>)

    fun read(id: String): LeakReferencesResponse {
        val origin = transaction.execute { origin(id) } ?: return LeakReferencesResponse(null, emptyList(), emptyList())
        val cards = origin.worldId?.let { publicWorlds.hiddenCardTitles(it, origin.basis) }.orEmpty()
        // 빈 제목은 어떤 글에도 들어 있는 것으로 읽혀 글자 대조를 모두 걸리게 하므로 기준에서 뺀다.
        return LeakReferencesResponse(origin.workId, cards.filter { it.isNotBlank() }, origin.episodeTitles)
    }

    /** Fork가 아니면 null이다. 없는·삭제된 작품은 404, 고정 기준 기록을 읽을 수 없으면 409다. */
    private fun origin(id: String): Origin? {
        works.findById(id).orElse(null)?.takeIf { it.deletedAt == null } ?: throw ContentFailure(404, "작품을 찾을 수 없어요.")
        val fork = forks.findById(id).orElse(null) ?: return null
        val basis = checkpoints.findById(fork.sourceCheckpointId).orElse(null)?.let { episodes.findById(it.episodeId).orElse(null) }?.sequence
            ?: throw ContentFailure(409, "원작의 고정 기준 기록을 확인할 수 없어요.")
        val titles = current.titlesAfter(fork.sourceWorkId, basis).flatMap { listOfNotNull(it[0] as String?, it[1] as String?) }
            .filter { it.isNotBlank() && it != DEFAULT_EPISODE_TITLE }.distinct().sorted()
        return Origin(fork.sourceWorkId, basis, works.findById(fork.sourceWorkId).orElse(null)?.worldStudioId, titles)
    }
}
