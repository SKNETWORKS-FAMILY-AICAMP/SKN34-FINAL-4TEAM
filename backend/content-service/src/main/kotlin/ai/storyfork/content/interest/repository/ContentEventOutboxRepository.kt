package ai.storyfork.content.interest.repository

import ai.storyfork.content.interest.entity.ContentEventOutboxEntity
import java.util.UUID
import org.springframework.data.jpa.repository.JpaRepository

interface ContentEventOutboxRepository : JpaRepository<ContentEventOutboxEntity, UUID> {
    /** 아직 보내지 않은 사건을 오래된 순으로 한 주기에 최대 100건 읽는다. */
    fun findTop100ByPublishedAtIsNullOrderByOccurredAtAscIdAsc(): List<ContentEventOutboxEntity>
}
