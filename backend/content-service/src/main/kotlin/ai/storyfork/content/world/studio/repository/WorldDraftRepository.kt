package ai.storyfork.content.world.studio.repository

import ai.storyfork.content.world.studio.entity.WorldDraft
import java.util.UUID
import org.springframework.data.jpa.repository.JpaRepository

interface WorldDraftRepository : JpaRepository<WorldDraft, UUID> {
}
