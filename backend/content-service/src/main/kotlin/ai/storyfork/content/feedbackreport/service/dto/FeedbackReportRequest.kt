package ai.storyfork.content.feedbackreport.service.dto

/** 제보 등록 요청이다. visibility를 생략하면 비공개이고, 길이·유형 검증은 Service가 한다. */
data class CreateReportRequest(val kind: String = "", val body: String = "", val quote: String? = null, val visibility: String? = null)

/** 공개 범위 변경 요청이다. visibility는 필수다(빠지면 422). */
data class VisibilityRequest(val visibility: String = "")

/** 제보자의 정정 요청이다. 원문은 바뀌지 않고 정정 기록만 더해진다. */
data class CorrectionRequest(val body: String = "")

/** 작가의 답변 요청이다. isPublic을 생략하면 비공개 답변이다. */
data class ResponseRequest(val body: String = "", val isPublic: Boolean = false)

/** 작가의 처리 상태 변경 요청이다. */
data class StatusRequest(val status: String = "")
