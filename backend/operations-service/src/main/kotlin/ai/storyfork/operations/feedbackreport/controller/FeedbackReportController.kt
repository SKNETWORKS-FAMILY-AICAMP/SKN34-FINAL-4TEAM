package ai.storyfork.operations.feedbackreport.controller

import ai.storyfork.operations.feedbackreport.service.FeedbackReportService
import ai.storyfork.operations.security.OperationsMember
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.web.bind.annotation.*

/** Member Bearer API for an operator with the `feedback` permission. View only: there is no write route because the author handles a reader report. */
@RestController
@RequestMapping("/api/v1/operations/feedback-reports")
class FeedbackReportController(private val service: FeedbackReportService) {
    @GetMapping
    fun list(@AuthenticationPrincipal member: OperationsMember, @RequestParam(required = false) status: String?,
        @RequestParam(required = false) page: Int?, @RequestParam(required = false) size: Int?) = service.list(member, status, page, size)
}
