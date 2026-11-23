package ai.storyfork.content.fork.repository

import ai.storyfork.content.fork.entity.ForkEntity
import org.springframework.data.jpa.repository.*

interface ForkRepository : JpaRepository<ForkEntity, String> {
    fun findAllByOwnerIdAndSourceWorkId(ownerId: String, sourceWorkId: String): List<ForkEntity>

    /** 삭제되지 않은 Fork 작품 수다(운영 퍼널, DEC-57). */
    @Query("select count(f) from ForkEntity f join WorkEntity w on w.id = f.workId where w.deletedAt is null")
    fun countLive(): Long

    /** 삭제되지 않은 Fork를 만든 서로 다른 회원 중 회차를 하나 이상 연(읽은) 회원 수다(운영 퍼널, DEC-57). */
    @Query("""select count(distinct f.ownerId) from ForkEntity f join WorkEntity w on w.id = f.workId
        where w.deletedAt is null and exists (select r.memberId from ReadingEpisodeEntity r where r.memberId = f.ownerId)""")
    fun countOwnersWhoRead(): Long

    /**
     * 삭제되지 않은 Fork를 기준 회차(Fork를 만들 때 고정한 원작 회차 번호)별로 센 `[기준 회차, 수]` 행이다. Fork가 없는 회차는 행이 없다.
     * 기준 회차는 `ForkLeakReferenceService`와 같이 고정 체크포인트의 기준 회차 행(`checkpoint.episode_id`)의 번호다(운영 퍼널, DEC-57).
     */
    @Query("""select e.sequence, count(f) from ForkEntity f join WorkEntity w on w.id = f.workId
        join CheckpointEntity c on c.id = f.sourceCheckpointId join EpisodeEntity e on e.id = c.episodeId
        where w.deletedAt is null group by e.sequence""")
    fun countByBaseEpisode(): List<Array<Any>>

    /**
     * 삭제되지 않은 Fork 중 Fork 작가가 직접 저장한 원고 버전(`is_saved`)이 자기 회차에 하나 이상 있는 수다.
     * Fork를 만들 때 물려받은 회차의 복사본은 저장 버전이 아니라 빠진다(운영 퍼널, DEC-57).
     */
    @Query("""select count(f) from ForkEntity f join WorkEntity w on w.id = f.workId where w.deletedAt is null and exists (
        select v.id from EpisodeVersionEntity v join EpisodeEntity e on e.id = v.episodeId where e.workId = f.workId and v.isSaved = true)""")
    fun countSaved(): Long

    /**
     * 삭제되지 않은 Fork 중 Fork 작가가 직접 발행한 적이 있는 Fork마다 `[Fork 생성 시각, 첫 직접 발행 시각]` 한 행이다. 발행한 적 없는 Fork는 행이 없다.
     * 직접 발행은 Fork 자기 회차 버전의 적용된 발행 기록이며 `PublicationEventRepository.lastPublishedByWork`와 같은 publish·republish·replace다.
     * 물려받은 회차는 발행 기록이 없어 빠진다(운영 퍼널, DEC-57).
     */
    @Query("""select f.createdAt, min(p.occurredAt) from ForkEntity f join WorkEntity w on w.id = f.workId
        join EpisodeEntity e on e.workId = f.workId join EpisodeVersionEntity v on v.episodeId = e.id
        join PublicationEventEntity p on p.episodeVersionId = v.id
        where w.deletedAt is null and p.outcome = 'applied' and p.action in ('publish', 'republish', 'replace')
        group by f.workId, f.createdAt""")
    fun firstPublications(): List<Array<Any>>
}
