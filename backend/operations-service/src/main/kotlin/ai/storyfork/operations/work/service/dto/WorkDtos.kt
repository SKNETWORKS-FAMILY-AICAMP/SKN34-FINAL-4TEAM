package ai.storyfork.operations.work.service.dto

import java.util.UUID

/** Content `OperationsWork`: Content computes every value, so the enum-like strings are passed through untouched. */
data class OperationsWork(
    val workId: UUID,
    val ownerId: UUID,
    val title: String,
    val authorName: String,
    val originKind: String,
    val creationType: String,
    val rightsConfirmed: Boolean,
    val visibility: String,
    val restricted: Boolean,
)

data class OperationsWorkList(val items: List<OperationsWork>)
