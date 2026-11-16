package ai.storyfork.content.notice.service.dto

import java.time.Instant

/** 작품 소식 하나다. category는 info(안내)·hiatus(휴재)·event(이벤트)이고 시각은 UTC ISO-8601이다. 작성자 정보는 내보내지 않는다. */
data class WorkNoticeResponse(
    val id: String, val workId: String, val category: String, val title: String, val body: String,
    val pinned: Boolean, val createdAt: Instant, val updatedAt: Instant,
)

/** 작품 소식 목록이다. 고정 먼저, 그 안에서 최신순이며 최대 200개다(페이지 나눔은 클라이언트가 한다). */
data class WorkNoticeListResponse(val items: List<WorkNoticeResponse>)
