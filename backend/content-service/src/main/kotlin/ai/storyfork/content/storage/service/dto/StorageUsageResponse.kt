package ai.storyfork.content.storage.service.dto

data class StorageItem(
    val id: String,
    val kind: String,
    val title: String,
    val parentTitle: String,
    val bytes: Long,
)

data class StorageUsageResponse(
    val totalBytes: Long,
    val manuscriptBytes: Long,
    val settingBytes: Long,
    val manuscriptImageBytes: Long,
    val items: List<StorageItem>,
)
