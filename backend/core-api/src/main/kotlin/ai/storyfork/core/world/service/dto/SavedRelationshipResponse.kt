package ai.storyfork.core.world.service.dto

import java.util.UUID

data class SavedRelationshipResponse(
    val versionId: UUID, val versionNo: Long, val restoredFromVersionId: UUID?, val relationship: RelationshipPayload
)
