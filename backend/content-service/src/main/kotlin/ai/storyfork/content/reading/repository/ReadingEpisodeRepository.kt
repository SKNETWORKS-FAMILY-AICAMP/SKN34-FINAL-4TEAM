package ai.storyfork.content.reading.repository

import ai.storyfork.content.reading.entity.ReadingEpisodeEntity
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Query

interface ReadingEpisodeRepository : JpaRepository<ReadingEpisodeEntity, ReadingEpisodeEntity.Key> {
    fun findAllByMemberId(memberId: String): List<ReadingEpisodeEntity>
    fun deleteAllByMemberIdAndWorkId(memberId: String, workId: String)

    /** 회차를 하나 이상 연 서로 다른 회원 수다(운영 퍼널, DEC-57). */
    @Query("select count(distinct r.memberId) from ReadingEpisodeEntity r")
    fun countReaders(): Long

    /** 같은 작품에서 서로 다른 회차를 둘 이상 연 서로 다른 회원 수다. 같은 회차를 다시 열어도 한 행이라 둘로 세지 않는다(운영 퍼널, DEC-57). */
    @Query("""select count(distinct r.memberId) from ReadingEpisodeEntity r where exists (
        select o.memberId from ReadingEpisodeEntity o where o.memberId = r.memberId and o.workId = r.workId and o.episodeNumber <> r.episodeNumber)""")
    fun countRepeatReaders(): Long
}
