package ai.storyfork.content.work.service.dto

/** 운영 작품 조회의 작품 한 건. [visibility]는 최신 발행 이력(없으면 private)이고 [restricted]는 운영 제한 여부로 서로 독립이다. */
data class OperationsWorkResponse(
    val workId: String, val ownerId: String, val title: String, val authorName: String,
    val originKind: String, val creationType: String,
    val rightsConfirmed: Boolean, val visibility: String, val restricted: Boolean,
)

data class OperationsWorkListResponse(val items: List<OperationsWorkResponse>)
