package ai.storyfork.core.episode.repository

import ai.storyfork.core.episode.entity.EpisodeEntity
import org.springframework.data.jpa.repository.*

interface EpisodeRepository : JpaRepository<EpisodeEntity, String> {
    @Query("""select count(e) from EpisodeEntity e where e.id=:id and (
        exists(select v.id from EpisodeVersionEntity v where v.episodeId=e.id) or
        exists(select s.id from SettingVisibilityRangeEntity s where s.startEpisodeId=e.id or s.endEpisodeId=e.id) or
        exists(select a.id from AiInputSnapshotEntity a where a.episodeId=e.id) or
        exists(select p.id from ProposalEpisodeChangeEntity p where p.episodeId=e.id) or
        exists(select f.id from ForkPolicyHistoryEntity f where f.startEpisodeId=e.id)
    )""")
    fun referenceCount(@org.springframework.data.repository.query.Param("id") id: String): Long
    @Query("""select count(e) from EpisodeEntity e where e.workId=:work and e.sequence=:number and (
        e.draftRevisionFloor>=0 or exists(select d.episodeId from EpisodeDraftEntity d where d.episodeId=e.id) or
        exists(select v.id from EpisodeVersionEntity v where v.episodeId=e.id and v.isSaved=true))""")
    fun countWritingAt(@org.springframework.data.repository.query.Param("work") work: String, @org.springframework.data.repository.query.Param("number") number: Int): Long
    fun findAllByWorkIdOrderBySequence(workId: String): List<EpisodeEntity>
    fun findByWorkIdAndSequence(workId: String, sequence: Int): EpisodeEntity?
}
