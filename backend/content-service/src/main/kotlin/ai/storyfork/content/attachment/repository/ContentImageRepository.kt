package ai.storyfork.content.attachment.repository

import ai.storyfork.content.attachment.entity.ContentImage
import ai.storyfork.content.storage.service.dto.StorageItem
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param

interface ContentImageRepository : JpaRepository<ContentImage, String> {
    fun findByWorkIdAndEpisodeNo(workId: String, episodeNo: Int): List<ContentImage>
    fun countByWorkIdAndEpisodeNo(workId: String, episodeNo: Int): Long
    fun findAllByWorkIdAndEpisodeNoOrderByCreatedAtAscIdAsc(workId: String, episodeNo: Int): List<ContentImage>

    @Query("""
        select new ai.storyfork.content.storage.service.dto.StorageItem(i.id, 'manuscript_image', i.filename,
            concat(w.title, ' · ', cast(i.episodeNo as String), '화'), i.byteSize)
        from ContentImage i
        join ImageWork w on w.id=i.workId
        where w.ownerId=:owner and w.deletedAt is null and i.episodeNo>0 and exists (
            select e.id from ImageEpisode e where e.workId=i.workId and e.sequence=i.episodeNo
        )
    """)
    fun storageItems(@Param("owner") owner: String): List<StorageItem>
}
