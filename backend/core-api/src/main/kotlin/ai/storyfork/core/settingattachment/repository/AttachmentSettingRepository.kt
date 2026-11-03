package ai.storyfork.core.settingattachment.repository

import ai.storyfork.core.settingattachment.entity.AttachmentSetting
import jakarta.persistence.LockModeType
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Lock
import org.springframework.data.jpa.repository.Query
import org.springframework.data.repository.query.Param

interface AttachmentSettingRepository : JpaRepository<AttachmentSetting, String> {
    // 현재 Content는 자기 세계관 ID를 작품 ID로 만든다. following Fork의 원본 세계관은 여기서 제외한다.
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("""select s from AttachmentSetting s where s.logicalId = :settingId and exists (
        select w.id from AttachmentWork w, AttachmentWorld world
        where w.id = :workId and w.ownerId = :owner and w.worldId = w.id
        and world.id = w.worldId and world.ownerId = :owner and s.worldId = world.id)""")
    fun lockOwnedLocal(@Param("workId") workId: String, @Param("settingId") settingId: String, @Param("owner") owner: String): AttachmentSetting?
}
