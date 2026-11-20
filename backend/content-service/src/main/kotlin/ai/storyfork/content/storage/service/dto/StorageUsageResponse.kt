package ai.storyfork.content.storage.service.dto

data class StorageItem(
    val id: String,
    val kind: String,
    val title: String,
    val parentTitle: String,
    val bytes: Long,
)

/** 합계·종류별 사용량은 화면이 항목 크기를 더해 구한다. */
data class StorageUsageResponse(val items: List<StorageItem>)
