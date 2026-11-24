package ai.storyfork.content.feedbackreport.service.dto

import java.time.Instant

/**
 * 운영 서비스 전용 제보 열람의 제보 한 건이다(운영자는 읽기만 하고 처리는 작가가 한다). 비공개 제보도 원문을 그대로 담는다.
 * [reporterName]은 Core 최신 닉네임이고 탈퇴한 회원이면 `탈퇴한 회원`이다. 정정·철회 기록(철회 여부 [withdrawn]만)과 작가 답변은 싣지 않는다.
 */
data class OperationsFeedbackReportResponse(
    val id: String, val workId: String, val workTitle: String, val episodeNumber: Int,
    val kind: String, val body: String, val quote: String?, val visibility: String, val status: String,
    val reporterName: String, val withdrawn: Boolean, val createdAt: Instant,
)

/** 운영 제보 열람 한 쪽이다. [page]는 0부터이고 [totalElements]·[totalPages]는 상태 필터를 적용한 전체다. */
data class OperationsFeedbackReportPageResponse(
    val items: List<OperationsFeedbackReportResponse>, val page: Int, val size: Int, val totalElements: Long, val totalPages: Int,
)
