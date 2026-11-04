package ai.storyfork.core.world.repository

import ai.storyfork.core.world.entity.WorldDraft
import java.util.UUID
import org.springframework.data.jpa.repository.JpaRepository

interface WorldDraftRepository : JpaRepository<WorldDraft, UUID> {
}
