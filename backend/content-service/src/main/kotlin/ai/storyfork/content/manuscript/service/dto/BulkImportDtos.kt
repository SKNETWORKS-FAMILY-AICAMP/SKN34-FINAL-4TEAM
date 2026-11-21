package ai.storyfork.content.manuscript.service.dto

data class BulkImportBasis(val lastNumber: Int, val workRevision: Int)

data class BulkImportItem(val number: Int, val title: String)

data class BulkImportRequest(
    val rightsConfirmed: Boolean,
    val expectedWorkRevision: Int,
    val items: List<BulkImportItem>,
    /** 화면이 여러 묶음으로 올릴 때 마지막 묶음만 true로 보낸다. false면 세계관 구축 접수를 시도하지 않는다(`worldBuild`는 null). */
    val startWorldBuild: Boolean = true,
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
    val worldBuild: ManuscriptImportWorldBuild? = null,
)
