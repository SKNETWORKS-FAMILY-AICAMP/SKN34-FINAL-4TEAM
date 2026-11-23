package ai.storyfork.content.world.studio.repository

import ai.storyfork.content.storage.service.dto.StorageItem
import ai.storyfork.content.world.studio.entity.SettingCardDraft
import java.util.UUID
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Modifying
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param

interface SettingCardDraftRepository : JpaRepository<SettingCardDraft, UUID> {
    fun findAllByWorldId(worldId: UUID): List<SettingCardDraft>
    fun countByWorldIdAndFieldsLifecycle(worldId: UUID, lifecycle: String): Long
    /** 카드 유형(카테고리 코드)별로 센 지우지 않은 세계관의 활성 카드 초안 수 `[cardType, 수]`다. 운영 카테고리 표의 사용 수이며 쿼리 한 번이다. */
    @Query("select d.fields.cardType, count(d) from SettingCardDraft d join StudioWorld w on w.id = d.worldId where w.deletedAt is null and d.fields.lifecycle = 'active' group by d.fields.cardType")
    fun cardCounts(): List<Array<Any>>
    @Modifying(clearAutomatically=true,flushAutomatically=true)
    @Query("delete from SettingCardDraft d where d.worldId=:world")
    fun deleteWorldDrafts(@Param("world") world: UUID)

    @Query("""
        select new ai.storyfork.content.storage.service.dto.StorageItem(concat('card:', cast(d.cardId as String)), 'setting', d.fields.title, coalesce(worldDraft.name, ''),
            cast(function('octet_length', d.fields.body) as Long))
        from SettingCardDraft d
        join StudioWorld w on w.id=d.worldId
        left join WorldDraft worldDraft on worldDraft.worldId=w.id
        where w.ownerSubject=:owner and w.deletedAt is null and d.fields.lifecycle='active'
    """)
    fun storageItems(@Param("owner") owner: UUID): List<StorageItem>
}
