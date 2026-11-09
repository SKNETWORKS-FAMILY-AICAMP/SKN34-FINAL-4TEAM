package ai.storyfork.core.notification.repository

import ai.storyfork.core.notification.entity.NoticeOutboxEntity
import java.time.Instant
import java.util.UUID
import org.springframework.data.domain.Pageable
import org.springframework.data.jpa.repository.JpaRepository
import org.springframework.data.jpa.repository.Query

interface NoticeOutboxRepository : JpaRepository<NoticeOutboxEntity, UUID> {
    /** 보낼 때가 된 대기 사건을 오래된 순으로 가져온다. */
    @Query("select o from NoticeOutboxEntity o where o.status = 'PENDING' and o.nextAttemptAt <= :now order by o.nextAttemptAt, o.id")
    fun due(now: Instant, pageable: Pageable): List<NoticeOutboxEntity>
}
