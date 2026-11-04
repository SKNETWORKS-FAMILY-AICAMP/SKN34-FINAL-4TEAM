package ai.storyfork.core.world.studio.repository

import ai.storyfork.core.world.studio.entity.WorldDraft
import java.util.UUID
import org.springframework.data.jpa.repository.JpaRepository

interface WorldDraftRepository : JpaRepository<WorldDraft, UUID> {
}
