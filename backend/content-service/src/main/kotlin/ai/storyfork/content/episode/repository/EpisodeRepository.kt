package ai.storyfork.content.episode.repository

import ai.storyfork.content.episode.entity.EpisodeEntity
import ai.storyfork.content.storage.service.dto.StorageItem
import org.springframework.data.jpa.repository.*
import org.springframework.data.repository.query.Param

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

    @Query("""
        select new ai.storyfork.content.storage.service.dto.StorageItem(e.id, 'manuscript',
            concat(cast(e.sequence as String), '화 · ', coalesce(d.title, v.title)), w.title,
            cast(function('octet_length', coalesce(d.content, v.content)) as Long))
        from EpisodeCurrentEntity e
        join WorkEntity w on w.id=e.workId
        left join EpisodeDraftEntity d on d.episodeId=e.id
        left join EpisodeVersionEntity v on v.episodeId=e.id and v.isSaved=true and v.revisionNo=(
            select max(saved.revisionNo) from EpisodeVersionEntity saved where saved.episodeId=e.id and saved.isSaved=true
        )
        where w.ownerId=:owner and w.deletedAt is null and e.inherited=false and (d.episodeId is not null or v.id is not null)
    """)
    fun storageItems(@Param("owner") owner: String): List<StorageItem>
}
