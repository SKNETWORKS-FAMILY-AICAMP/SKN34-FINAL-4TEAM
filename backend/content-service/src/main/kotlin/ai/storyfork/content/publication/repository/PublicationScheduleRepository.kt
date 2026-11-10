package ai.storyfork.content.publication.repository

import ai.storyfork.content.publication.entity.PublicationScheduleEntity
import java.time.Instant
import org.springframework.data.domain.Pageable
import org.springframework.data.jpa.repository.*
import org.springframework.data.repository.query.Param

interface PublicationScheduleRepository : JpaRepository<PublicationScheduleEntity, String> {
    fun findAllByEpisodeIdOrderByScheduledAtDescIdDesc(episodeId: String): List<PublicationScheduleEntity>
    fun existsByEpisodeIdAndStatus(episodeId: String, status: String): Boolean
    fun findAllByWorkIdAndStatus(workId: String, status: String): List<PublicationScheduleEntity>

    /** 도래한 [status] 예약을 (예약 시각, 회차 번호, id) 순으로 [pageable] 크기만큼 읽는다. 같은 시각이면 앞 회차부터 실행하도록 개수를 자르기 전에 회차 번호로 정렬한다. */
    @Query("""select s from PublicationScheduleEntity s, EpisodeEntity e
        where e.id = s.episodeId and s.status = :status and s.scheduledAt <= :at
        order by s.scheduledAt, e.sequence, s.id""")
    fun findDue(@Param("status") status: String, @Param("at") at: Instant, pageable: Pageable): List<PublicationScheduleEntity>
}
