package ai.storyfork.content.feedbackreport.controller

import ai.storyfork.content.feedbackreport.service.InternalFeedbackReportService
import ai.storyfork.content.feedbackreport.service.dto.OperationsFeedbackReportPageResponse
import org.springframework.web.bind.annotation.*

/** 운영 서비스 전용 내부 API. `/internal/v1` 하위의 운영 서비스 토큰 체인만 지나며 공개 proxy에 등록하지 않는다. 읽기만 있다(제보 처리는 작가 몫). */
@RestController
@RequestMapping("/internal/v1/feedback-reports")
class InternalFeedbackReportController(private val service: InternalFeedbackReportService) {
    /**
     * 모든 독자 제보(삭제된 작품 제외)를 작성 최신순으로 한 쪽씩 준다. 선택 쿼리 `status`(unchecked·checked·answered·resolved·closed)·`page`(0부터)·`size`(1~100, 기본 20)가
     * 틀리면 422다(숫자 타입으로 받으면 변환 실패가 400이라 문자열로 받아 서비스가 읽는다).
     */
    @GetMapping
    fun list(@RequestParam(required = false) status: String?, @RequestParam(required = false) page: String?,
        @RequestParam(required = false) size: String?): OperationsFeedbackReportPageResponse = service.list(status, page, size)
}
