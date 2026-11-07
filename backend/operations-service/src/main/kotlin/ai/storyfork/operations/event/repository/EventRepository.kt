package ai.storyfork.operations.event.repository

import ai.storyfork.operations.event.entity.EventEntity
import java.util.UUID
import org.springframework.data.jpa.repository.JpaRepository

interface EventRepository : JpaRepository<EventEntity, UUID>
