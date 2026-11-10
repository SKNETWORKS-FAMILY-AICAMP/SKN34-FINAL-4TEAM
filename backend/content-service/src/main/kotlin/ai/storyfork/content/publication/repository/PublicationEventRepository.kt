package ai.storyfork.content.publication.repository

import ai.storyfork.content.publication.entity.PublicationEventEntity
import org.springframework.data.jpa.repository.*

interface PublicationEventRepository : JpaRepository<PublicationEventEntity, String> {
    fun findAllByEpisodeVersionIdInOrderByOccurredAtAscIdAsc(episodeVersionIds: Collection<String>): List<PublicationEventEntity>

    /**
     * 작품별 마지막 발행 시각을 `[작품 id, 시각]` 행으로 쿼리 한 번에 돌려준다(episode_version→episode→work).
     * 발행으로 적용된 기록(`episode_current`가 읽는 publish·republish·replace)만 세며 그런 기록이 없는 작품은 행이 없다.
     */
    @Query("""select e.workId, max(p.occurredAt) from PublicationEventEntity p
        join EpisodeVersionEntity v on v.id = p.episodeVersionId join EpisodeEntity e on e.id = v.episodeId
        where p.outcome = 'applied' and p.action in ('publish', 'republish', 'replace') group by e.workId""")
    fun lastPublishedByWork(): List<Array<Any>>
}
