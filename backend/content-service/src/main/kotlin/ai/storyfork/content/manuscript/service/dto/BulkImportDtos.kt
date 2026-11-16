package ai.storyfork.content.manuscript.service.dto

data class BulkImportBasis(val lastNumber: Int, val workRevision: Int)

data class BulkImportItem(val number: Int, val title: String)

data class BulkImportRequest(
    val rightsConfirmed: Boolean,
    val expectedWorkRevision: Int,
    val items: List<BulkImportItem>,
)

data class BulkImportResult(
    val number: Int,
    val title: String,
    val status: String,
    val versionId: String? = null,
    val reason: String? = null,
)

data class BulkImportResponse(
    val workRevision: Int,
    val results: List<BulkImportResult>,
    val stopReason: String? = null,
)
