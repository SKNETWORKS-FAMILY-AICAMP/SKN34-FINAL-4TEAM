package ai.storyfork.content.feedbackreport.service.dto

import java.time.Instant

/** 제보자의 정정(correct, 본문 있음)·철회(withdraw, 본문 없음) 기록이다. */
data class AmendmentResponse(val action: String, val body: String?, val createdAt: Instant)

/** 작가의 답변 한 건이다. authorName은 Core 최신 닉네임이거나 탈퇴한 회원이다. */
data class ReportReplyResponse(val id: String, val authorName: String, val body: String, val isPublic: Boolean, val createdAt: Instant)

/**
 * 제보 하나다. mine은 요청자가 제보자, owner는 작품 소유자다.
 * 원문을 볼 권한이 없는 비공개 제보(공개 답변만 노출)는 body·quote·reporterName이 null이고 amendments는 비며 responses에는 공개 답변만 담긴다.
 */
data class ReportResponse(
    val id: String, val workId: String, val workTitle: String, val episodeNumber: Int, val publishedVersionId: String,
    val kind: String, val body: String?, val quote: String?, val visibility: String,
    val status: String, val reporterName: String?, val mine: Boolean, val owner: Boolean,
    val authorChecked: Boolean, val withdrawn: Boolean,
    val amendments: List<AmendmentResponse>, val responses: List<ReportReplyResponse>,
    val createdAt: Instant, val updatedAt: Instant,
)

/** 제보 목록이다. 최대 200개이며 페이지네이션은 없다. */
data class ReportListResponse(val items: List<ReportResponse>)
