package ai.storyfork.core.notification.repository

import ai.storyfork.core.notification.entity.NoticePreferenceEntity
import java.util.UUID
import org.springframework.data.jpa.repository.JpaRepository

interface NoticePreferenceRepository : JpaRepository<NoticePreferenceEntity, NoticePreferenceEntity.Key> {
    fun findAllByMemberId(memberId: UUID): List<NoticePreferenceEntity>
}
