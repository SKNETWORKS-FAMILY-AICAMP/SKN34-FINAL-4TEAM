package ai.storyfork.content.feedbackreport.controller

import ai.storyfork.content.feedbackreport.service.FeedbackReportService
import ai.storyfork.content.feedbackreport.service.dto.*
import java.net.URI
import java.security.Principal
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.*

/**
 * 공개 회차 제보의 등록·열람과 제보자(공개 범위·정정·철회)·작품 소유자(확인·답변·상태 변경)의 처리를 제공한다.
 * 회차 제보 목록·상세는 익명도 볼 수 있고 나머지는 로그인 회원만 쓴다. `feedback-reports/mine`·`feedback-reports/inbox`는 `/works/{id}`보다 먼저 매칭되는 리터럴 경로다.
 */
@RestController
@RequestMapping("/api/v1")
class FeedbackReportController(private val service: FeedbackReportService) {

    /** 제보를 등록하고 201과 공개 상세 경로(Location)를 반환한다. 입력 오류는 422, 비공개 작품·미발행 회차는 404, Core 조회 실패는 503·504·502다. */
    @PostMapping("/works/{id}/episodes/{number}/feedback-reports")
    fun create(@PathVariable id: String,@PathVariable number: Int,principal: Principal,@RequestBody data: CreateReportRequest): ResponseEntity<ReportResponse> {
        val created=service.create(id,number,principal.name,data)
        return ResponseEntity.created(URI.create("/api/v1/public/works/$id/episodes/$number/feedback-reports/${created.id}")).body(created)
    }

    /** 회차 제보 목록이다. 익명 가능하며 Bearer가 있으면 내 비공개 제보와(소유자면) 모든 제보까지 담는다. 비공개 작품·미발행 회차는 404다. */
    @GetMapping("/public/works/{id}/episodes/{number}/feedback-reports")
    fun list(@PathVariable id: String,@PathVariable number: Int,principal: Principal?): ReportListResponse =
        service.list(id,number,principal?.name)

    /** 제보 상세다. 익명 가능하며 볼 권한이 없는 비공개 제보이거나 다른 작품·회차의 제보면 404다. */
    @GetMapping("/public/works/{id}/episodes/{number}/feedback-reports/{reportId}")
    fun read(@PathVariable id: String,@PathVariable number: Int,@PathVariable reportId: String,principal: Principal?): ReportResponse =
        service.read(id,number,reportId,principal?.name)

    /** 내가 남긴 모든 제보다(최신순). */
    @GetMapping("/works/feedback-reports/mine")
    fun mine(principal: Principal): ReportListResponse = service.mine(principal.name)

    /** 내가 소유한 모든 작품의 제보다(최신순). */
    @GetMapping("/works/feedback-reports/inbox")
    fun inbox(principal: Principal): ReportListResponse = service.inbox(principal.name)

    /** 제보자만 공개 범위를 바꾼다. 타인은 403(볼 수도 없는 비공개 제보면 404)이고 잘못된 값은 422다. */
    @PutMapping("/works/{id}/feedback-reports/{reportId}/visibility")
    fun visibility(@PathVariable id: String,@PathVariable reportId: String,principal: Principal,@RequestBody data: VisibilityRequest): ReportResponse =
        service.setVisibility(id,reportId,principal.name,data)

    /** 제보자만 정정 기록을 더한다. 철회 뒤에는 409다. */
    @PostMapping("/works/{id}/feedback-reports/{reportId}/corrections")
    fun correct(@PathVariable id: String,@PathVariable reportId: String,principal: Principal,@RequestBody data: CorrectionRequest): ReportResponse =
        service.correct(id,reportId,principal.name,data)

    /** 제보자만 한 번 철회한다. 이미 철회했으면 409다. */
    @PostMapping("/works/{id}/feedback-reports/{reportId}/withdrawal")
    fun withdraw(@PathVariable id: String,@PathVariable reportId: String,principal: Principal): ReportResponse =
        service.withdraw(id,reportId,principal.name)

    /** 작품 소유자만 확인한다(멱등). */
    @PostMapping("/works/{id}/feedback-reports/{reportId}/check")
    fun check(@PathVariable id: String,@PathVariable reportId: String,principal: Principal): ReportResponse =
        service.check(id,reportId,principal.name)

    /** 작품 소유자만 답변한다. isPublic을 생략하면 비공개 답변이다. */
    @PostMapping("/works/{id}/feedback-reports/{reportId}/responses")
    fun answer(@PathVariable id: String,@PathVariable reportId: String,principal: Principal,@RequestBody data: ResponseRequest): ReportResponse =
        service.answer(id,reportId,principal.name,data)

    /** 작품 소유자만 처리 상태를 바꾼다. 확인 전으로 되돌리기는 422다. */
    @PutMapping("/works/{id}/feedback-reports/{reportId}/status")
    fun status(@PathVariable id: String,@PathVariable reportId: String,principal: Principal,@RequestBody data: StatusRequest): ReportResponse =
        service.setStatus(id,reportId,principal.name,data)
}
