package ai.storyfork.content.episode.service

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content._common.exception.checkContent
import ai.storyfork.content.episode.entity.EpisodeEntity
import ai.storyfork.content.episode.repository.EpisodeCurrentRepository
import ai.storyfork.content.episode.repository.EpisodeRepository
import ai.storyfork.content.episode.service.dto.EpisodeWorldBasisRequest
import ai.storyfork.content.episode.service.dto.EpisodeWorldBasisResponse
import ai.storyfork.content.work.service.WorkAccessService
import ai.storyfork.content.world.domain.WorldNotFound
import ai.storyfork.content.world.service.WorldStudioService
import java.util.UUID
import org.springframework.beans.factory.annotation.Qualifier
import org.springframework.stereotype.Service
import org.springframework.transaction.support.TransactionTemplate

@Service
class EpisodeWorldBasisService(
    private val access: WorkAccessService,
    private val episodes: EpisodeRepository,
    private val current: EpisodeCurrentRepository,
    private val worlds: WorldStudioService,
    @Qualifier("contentTransactions") private val transaction: TransactionTemplate,
) {
    fun read(workId: String, owner: UUID, number: Int): EpisodeWorldBasisResponse {
        val (revision, worldId, versionId) = checkNotNull(transaction.execute {
            val row = ownedEpisode(workId, owner, number)
            Triple(row.basisRevision, row.basisWorldId, row.basisWorldRevisionId)
        })
        val basis = worldId?.let { ownedRevision(it, owner, checkNotNull(versionId)) }
        return EpisodeWorldBasisResponse(revision, basis)
    }

    fun choose(workId: String, owner: UUID, number: Int, request: EpisodeWorldBasisRequest): EpisodeWorldBasisResponse {
        transaction.executeWithoutResult { ownedEpisode(workId, owner, number) }
        // WorldStudio는 별도 트랜잭션에서 소유권과 불변 버전을 검증한다.
        val basis = ownedRevision(request.worldId, owner, request.revisionId)
        val revision = checkNotNull(transaction.execute {
            val row = ownedEpisode(workId, owner, number)
            if (row.basisWorldId != basis.worldId || row.basisWorldRevisionId != basis.revisionId) {
                checkContent(row.basisRevision == request.revision, 409, "기준 세계관이 변경됐어요. 다시 불러와 주세요.")
                row.basisWorldId = basis.worldId
                row.basisWorldRevisionId = basis.revisionId
                row.basisRevision = Math.incrementExact(row.basisRevision)
            }
            row.basisRevision
        })
        return EpisodeWorldBasisResponse(revision, basis)
    }

    private fun ownedRevision(worldId: UUID, owner: UUID, versionId: UUID) =
        try { worlds.revisionSummary(worldId, owner, versionId) }
        catch (_: WorldNotFound) { throw ContentFailure(404, "소유한 세계관의 확정 버전을 찾을 수 없어요.") }

    private fun ownedEpisode(workId: String, owner: UUID, number: Int): EpisodeEntity {
        access.own(workId, owner.toString())
        val visible = current.findByWorkIdAndSequence(workId, number) ?: throw ContentFailure(404, "회차를 찾을 수 없어요.")
        checkContent(!visible.inherited, 403, "원작 기준 회차는 기준 세계관을 변경할 수 없어요.")
        checkContent(visible.publicationStatus != "draft" || episodes.countWritingAt(workId, number) > 0, 404, "집필 회차를 찾을 수 없어요.")
        return episodes.findByWorkIdAndSequence(workId, number) ?: throw ContentFailure(404, "회차를 찾을 수 없어요.")
    }
}
