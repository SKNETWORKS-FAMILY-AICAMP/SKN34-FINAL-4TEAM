package ai.storyfork.content.fork.service

import ai.storyfork.content._common.exception.ContentFailure
import ai.storyfork.content.episode.repository.EpisodeRepository
import ai.storyfork.content.episode_version.entity.EpisodeVersionEntity
import ai.storyfork.content.episode_version.repository.CheckpointEpisodeRepository
import ai.storyfork.content.episode_version.repository.CheckpointRepository
import ai.storyfork.content.episode_version.repository.EpisodeVersionRepository
import ai.storyfork.content.fork.repository.ForkRepository
import ai.storyfork.content.fork.service.dto.ForkIntegrityResponse
import ai.storyfork.content.work.repository.WorkRepository
import java.io.DataOutputStream
import java.io.OutputStream
import java.security.DigestOutputStream
import java.security.MessageDigest
import java.util.HexFormat
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

@Service
@Transactional(transactionManager = "contentTransactionManager", readOnly = true)
class ForkIntegrityService(
    private val works: WorkRepository,
    private val forks: ForkRepository,
    private val checkpoints: CheckpointRepository,
    private val checkpointEpisodes: CheckpointEpisodeRepository,
    private val episodes: EpisodeRepository,
    private val versions: EpisodeVersionRepository,
) {
    fun read(id: String): ForkIntegrityResponse {
        if (works.findById(id).orElse(null)?.let { it.deletedAt == null } != true) missingFork()
        val fork = forks.findById(id).orElse(null) ?: missingFork()
        val checkpoint = checkpoints.findById(fork.sourceCheckpointId).orElse(null) ?: missingBasis()
        val basis = episodes.findById(checkpoint.episodeId).orElse(null) ?: missingBasis()
        val pinned = checkpointEpisodes.findAllByCheckpointId(checkpoint.id)
        if (checkpoint.workId != fork.sourceWorkId || basis.workId != fork.sourceWorkId ||
            pinned.none { it.episodeId == basis.id && it.episodeVersionId == checkpoint.basisEpisodeVersionId }) missingBasis()

        val sourceNumbers = episodes.findAllById(pinned.map { it.episodeId }).associateBy { it.id }
        val sourceVersions = versions.findAllById(pinned.map { it.episodeVersionId }).associateBy { it.id }
        val source = pinned.map { row ->
            val episode = sourceNumbers[row.episodeId] ?: missingBasis()
            val version = sourceVersions[row.episodeVersionId] ?: missingBasis()
            if (episode.workId != fork.sourceWorkId || episode.sequence > basis.sequence || version.episodeId != episode.id) missingBasis()
            episode.sequence to version
        }

        val forkNumbers = episodes.findAllByWorkIdOrderBySequence(id).filter { it.sequence <= basis.sequence }
            .associate { it.id to it.sequence }
        val copied = versions.findAllByEpisodeIdInOrderByCreatedAtAscIdAsc(forkNumbers.keys)
            .filter { !it.isSaved }.map { forkNumbers.getValue(it.episodeId) to it }
        val forkHash = forkManuscriptHash(copied)
        val sourceHash = forkManuscriptHash(source)
        return ForkIntegrityResponse(basis.sequence, forkHash, sourceHash, forkHash == sourceHash)
    }

    private fun missingFork(): Nothing = throw ContentFailure(404, "포크 작품을 찾을 수 없어요.")
    private fun missingBasis(): Nothing = throw ContentFailure(409, "원작의 고정 기준 기록을 확인할 수 없어요.")
}

/** UTF-8 필드에 길이를 붙여 서로 다른 필드 값이나 회차 경계가 같은 바이트열이 되지 않게 한다. */
internal fun forkManuscriptHash(rows: List<Pair<Int, EpisodeVersionEntity>>): String {
    val digest = MessageDigest.getInstance("SHA-256")
    DataOutputStream(DigestOutputStream(OutputStream.nullOutputStream(), digest)).use { stream ->
        for ((number, version) in rows.sortedWith(compareBy({ it.first }, { it.second.contentVersionId }))) {
            stream.writeInt(number)
            stream.writeInt(version.revisionNo)
            for (field in listOf(version.contentVersionId, version.title, version.content, version.authorNote)) {
                val bytes = field.toByteArray(Charsets.UTF_8)
                stream.writeInt(bytes.size)
                stream.write(bytes)
            }
        }
    }
    return HexFormat.of().formatHex(digest.digest())
}
