package ai.storyfork.content.world.repository

import ai.storyfork.content.storage.service.dto.StorageItem
import ai.storyfork.content.world.entity.SettingDocumentEntity
import org.springframework.data.jpa.repository.*
import org.springframework.data.repository.query.Param

interface SettingDocumentRepository : JpaRepository<SettingDocumentEntity, String> {
    fun findAllByWorldId(worldId: String): List<SettingDocumentEntity>
    fun existsByWorldId(worldId: String): Boolean

    @Query("""
        select new ai.storyfork.content.storage.service.dto.StorageItem(concat('document:', doc.id), 'setting', coalesce(d.name, v.name), w.name,
            cast(function('octet_length', coalesce(d.content, v.content)) as Long))
        from SettingDocumentEntity doc
        join WorldEntity w on w.id=doc.worldId
        left join SettingDraftEntity d on d.settingDocumentId=doc.id
        left join SettingVersionEntity v on v.settingDocumentId=doc.id and v.revisionNo=(
            select max(saved.revisionNo) from SettingVersionEntity saved where saved.settingDocumentId=doc.id
        )
        where w.ownerId=:owner and (d.settingDocumentId is not null or v.lifecycle='active') and exists (
            select link.id from WorkWorldHistoryEntity link join WorkEntity work on work.id=link.workId
            where link.worldId=w.id and work.ownerId=:owner and work.deletedAt is null and link.revisionNo=(
                select max(recent.revisionNo) from WorkWorldHistoryEntity recent where recent.workId=work.id
            )
        )
    """)
    fun storageItems(@Param("owner") owner: String): List<StorageItem>
}
