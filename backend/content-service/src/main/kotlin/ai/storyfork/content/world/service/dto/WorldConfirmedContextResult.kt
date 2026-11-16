package ai.storyfork.content.world.service.dto

import java.util.UUID

/** Content 내부 소유자 전용 확정 설정. 회차/인물 지식 필터를 적용한 전체 집필 Context가 아니다. */
data class WorldConfirmedContextResult(
    val worldId: UUID,
    val revisionId: UUID,
    val revisionNo: Long,
    val authorizedSubject: UUID,
    val name: String,
    val description: String,
    // versionId = cardVersionId, card.id = 기존 엔터티/설정 ID. 저장된 metadata를 그대로 보존한다.
    val cards: List<SavedCardResponse>,
    val excludedRemovedCardCount: Int,
) {
    val scope: String = "owner_confirmed_settings"
    val relationshipStatus: String = "not_recorded"
    val currentRelationshipsIncluded: Boolean = false
    val completeWorldContext: Boolean = false
}
