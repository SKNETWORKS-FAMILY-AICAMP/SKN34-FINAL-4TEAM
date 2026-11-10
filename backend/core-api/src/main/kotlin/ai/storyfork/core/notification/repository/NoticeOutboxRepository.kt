package ai.storyfork.core.notification.repository

import ai.storyfork.core.notification.entity.NoticeOutboxEntity
import java.util.UUID
import org.springframework.data.jpa.repository.JpaRepository

interface NoticeOutboxRepository : JpaRepository<NoticeOutboxEntity, UUID> {
    /** 아직 보내지 않은 사건을 오래된 순으로 가져온다. */
    fun findTop50BySentAtIsNullOrderByOccurredAtAscIdAsc(): List<NoticeOutboxEntity>
}
