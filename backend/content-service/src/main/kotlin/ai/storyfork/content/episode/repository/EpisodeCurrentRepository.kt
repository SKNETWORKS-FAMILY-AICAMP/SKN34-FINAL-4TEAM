package ai.storyfork.content.episode.repository

import ai.storyfork.content.episode.entity.EpisodeCurrentEntity
import org.springframework.data.jpa.repository.*
import org.springframework.data.repository.query.Param

interface EpisodeCurrentRepository : JpaRepository<EpisodeCurrentEntity, String> {
    // Same active-row predicate as EpisodeService.assemble, without loading manuscript history.
    @Query("""
        SELECT COALESCE(MAX(e.sequence), 0)
        FROM EpisodeCurrentEntity e
        WHERE e.workId = :workId AND (
            e.draftRevisionFloor >= 0
            OR EXISTS (SELECT d.episodeId FROM EpisodeDraftEntity d WHERE d.episodeId = e.id)
            OR EXISTS (SELECT p.id FROM EpisodeVersionEntity p WHERE p.id = e.publishedVersionId)
            OR EXISTS (SELECT v.id FROM EpisodeVersionEntity v WHERE v.episodeId = e.id AND v.isSaved = true)
        )
    """)
    fun lastNumber(@Param("workId") workId: String): Int

    /**
     * [workId]의 [after]화 뒤 회차의 `[현재 초안 제목, 발행 버전 제목]` 행이다(회차 번호순, 어느 쪽이든 없으면 null). 지운 회차는 뷰가 뺀다.
     * 본문은 읽지 않고 쿼리 한 번이다. 운영 정보 누설 비교 기준(DEC-55)이 쓴다.
     */
    @Query("""select d.title, v.title from EpisodeCurrentEntity c
        left join EpisodeDraftEntity d on d.episodeId = c.id
        left join EpisodeVersionEntity v on v.id = c.publishedVersionId
        where c.workId = :workId and c.sequence > :after order by c.sequence""")
    fun titlesAfter(@Param("workId") workId: String, @Param("after") after: Int): List<Array<Any?>>

    fun findAllByWorkIdOrderBySequence(workId: String): List<EpisodeCurrentEntity>
    fun findByWorkIdAndSequence(workId: String, sequence: Int): EpisodeCurrentEntity?
}
