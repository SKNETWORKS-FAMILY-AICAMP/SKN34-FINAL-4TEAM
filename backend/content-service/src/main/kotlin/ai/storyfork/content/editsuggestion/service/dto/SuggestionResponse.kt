package ai.storyfork.content.editsuggestion.service.dto

import java.time.Instant

/**
 * 수정 제안 하나다. proposerName은 Core 최신 닉네임(없으면 탈퇴한 회원), scope·scopeReasons는 승인 내용(editedText ?: afterText) 기준으로 응답마다 계산하는 표시 전용 값이다.
 * mine은 요청자가 제안자, owner는 요청자가 작품 소유자다.
 */
data class SuggestionResponse(
    val id: String, val workId: String, val workTitle: String, val episodeNumber: Int, val publishedVersionId: String,
    val source: String, val proposerName: String, val beforeText: String, val afterText: String, val editedText: String?,
    val reason: String?, val status: String, val decisionReason: String?, val applyResult: String?, val applyFailure: String?,
    val appliedVersionId: String?, val scope: String, val scopeReasons: List<String>,
    val mine: Boolean, val owner: Boolean, val createdAt: Instant, val updatedAt: Instant,
)

/** 수정 제안 목록이다. 최대 200개이며 페이지네이션은 없다. */
data class SuggestionListResponse(val items: List<SuggestionResponse>)
