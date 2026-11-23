package ai.storyfork.content.serial.service

import ai.storyfork.content.episode.repository.EpisodeCurrentRepository
import ai.storyfork.content.episode_version.repository.EpisodeVersionRepository
import ai.storyfork.content.serial.entity.SerialEpisodeSummaryEntity
import ai.storyfork.content.serial.repository.AiSerialRepository
import ai.storyfork.content.serial.repository.SerialEpisodeSummaryRepository
import ai.storyfork.content.work.repository.WorkRepository
import java.time.Instant
import java.time.temporal.ChronoUnit
import org.springframework.stereotype.Service
import org.springframework.transaction.annotation.Transactional

/** 요약을 만들 공개 회차 하나다: 소유자(크레딧 부담)와, AI에 보낼 제목·본문, 저장할 때 쓸 회차·발행 버전 식별자다. */
data class SummaryTarget(val workId: String, val owner: String, val episodeId: String, val versionId: String, val number: Int, val title: String, val body: String)

/**
 * 회차 요약(이전 회차 문맥)의 DB 쪽 규칙이다: 요약이 없거나 발행 버전이 바뀐 공개 회차 고르기, 저장, 문맥에 실을 요약 읽기.
 * 짧은 트랜잭션만 쓰고 AI·Core는 여기서 부르지 않는다([SerialRunner]가 트랜잭션 밖에서 부른다). 회차마다 한 행이라 같은 행을 다시 쓰면 그만이어서 작품 잠금은 쥐지 않는다.
 */
@Service
@Transactional(transactionManager = "contentTransactionManager")
class SerialSummaryService(
    private val serialRepo: AiSerialRepository,
    private val works: WorkRepository,
    private val current: EpisodeCurrentRepository,
    private val versions: EpisodeVersionRepository,
    private val summaryRepo: SerialEpisodeSummaryRepository,
) {
    /**
     * 요약을 만들 회차를 최대 [limit]개 돌려준다: 켜져 있고 삭제되지 않은 작품마다 발행된 회차 가운데 요약이 없거나 요약을 만든 뒤 발행 버전이 바뀐 것을 오래된 회차(번호순)부터,
     * 작품을 돌아가며 한 회차씩 고른다(한 작품이 한도를 다 쓰지 못한다). 본문은 고른 회차만 읽는다.
     * ponytail: 실패한 회차는 다음 점검에 다시 고르므로 크레딧이 모자란 작품이 한도([limit])개 이상이면 뒤 작품이 밀린다. 필요해지면 점검마다 시작 작품을 돌리거나 실패한 작품을 건너뛴다.
     */
    fun targets(limit: Int): List<SummaryTarget> {
        val queues = serialRepo.findAllByEnabledTrue().mapNotNull { setting ->
            val work = works.findById(setting.workId).orElse(null)?.takeIf { it.deletedAt == null } ?: return@mapNotNull null
            val rows = current.findAllByWorkIdOrderBySequence(work.id).filter { it.publishedVersionId != null }
            if (rows.isEmpty()) return@mapNotNull null
            val made = summaryRepo.findAllByEpisodeIdIn(rows.map { it.id }).associate { it.episodeId to it.versionId }
            work to ArrayDeque(rows.filter { made[it.id] != it.publishedVersionId })
        }
        val picked = mutableListOf<SummaryTarget>()
        while (picked.size < limit && queues.any { it.second.isNotEmpty() }) {
            for ((work, queue) in queues) {
                if (picked.size >= limit) break
                val row = queue.removeFirstOrNull() ?: continue
                val versionId = row.publishedVersionId!!
                val version = versions.findById(versionId).orElse(null) ?: continue
                picked += SummaryTarget(work.id, work.ownerId, row.id, versionId, row.sequence, version.title, version.content)
            }
        }
        return picked
    }

    /** 회차 [episodeId]의 요약을 [versionId] 발행 버전의 것으로 저장한다(이미 있으면 같은 행을 바꾼다). */
    fun save(episodeId: String, versionId: String, summary: String) {
        val now = Instant.now().truncatedTo(ChronoUnit.MICROS)
        val row = summaryRepo.findById(episodeId).orElse(null)
        if (row == null) summaryRepo.save(SerialEpisodeSummaryEntity(episodeId, versionId, summary, now))
        else {
            row.versionId = versionId
            row.summary = summary
            row.createdAt = now
        }
    }

    /** 문맥에 실을 수 있는 요약이다: 지금 발행 버전으로 만든 요약만, 회차 번호별로. 요약이 아직 없거나 발행 버전이 바뀐 회차는 빠진다. */
    fun stored(workId: String): Map<Int, String> {
        val rows = current.findAllByWorkIdOrderBySequence(workId).filter { it.publishedVersionId != null }
        if (rows.isEmpty()) return emptyMap()
        val made = summaryRepo.findAllByEpisodeIdIn(rows.map { it.id }).associateBy { it.episodeId }
        return rows.mapNotNull { row -> made[row.id]?.takeIf { it.versionId == row.publishedVersionId }?.let { row.sequence to it.summary } }.toMap()
    }
}
