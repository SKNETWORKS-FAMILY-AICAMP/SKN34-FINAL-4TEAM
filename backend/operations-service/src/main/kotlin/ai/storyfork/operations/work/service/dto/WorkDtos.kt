package ai.storyfork.operations.work.service.dto

import java.util.UUID

/**
 * Content `OperationsWork`: Content computes every value, so the enum-like strings are passed through untouched.
 * [ownerId] stays a String because Content `work.owner_id` is a varchar: one non-UUID owner must not fail the whole list.
 */
data class OperationsWork(
    val workId: UUID,
    val ownerId: String,
    val title: String,
    val authorName: String,
    val originKind: String,
    val creationType: String,
    val rightsConfirmed: Boolean,
    val visibility: String,
    val restricted: Boolean,
)

data class OperationsWorkList(val items: List<OperationsWork>)
