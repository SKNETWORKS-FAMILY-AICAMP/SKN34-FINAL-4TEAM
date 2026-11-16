package ai.storyfork.content.notice.service.dto

/** 작품 소식 작성·전체 수정 요청이다. category는 info·hiatus·event이며 길이·공백·category 검증은 Service가 한다. */
data class WorkNoticeRequest(val category: String = "", val title: String = "", val body: String = "", val pinned: Boolean = false)
