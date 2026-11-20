package ai.storyfork.content.preprocessing.controller

import ai.storyfork.content.preprocessing.service.PreprocessingService
import ai.storyfork.content.preprocessing.service.dto.PreprocessingJobListResponse
import ai.storyfork.content.preprocessing.service.dto.PreprocessingJobResponse
import ai.storyfork.content.preprocessing.service.dto.PreprocessingProgressRequest
import org.springframework.http.HttpStatus
import org.springframework.web.bind.annotation.*

/**
 * 전처리 작업 내부 API다. 공개 proxy에 등록하지 않는다. 진행 보고(progress)는 AI의 `X-Internal-Token`(ContentSecurityConfig의 AI 체인),
 * 목록·재실행은 운영의 `X-Operations-Service-Token`으로만 열린다.
 */
@RestController
@RequestMapping("/internal/v1/preprocessing-jobs")
class InternalPreprocessingController(private val service: PreprocessingService) {
    /** 운영 작업 감시용 목록이다(최신 접수 순). status 필터, page(0부터)·size(1~100)가 틀리면 422다. */
    @GetMapping
    fun list(@RequestParam(required = false) status: String?, @RequestParam(required = false) page: String?,
        @RequestParam(required = false) size: String?): PreprocessingJobListResponse = service.list(status, page, size)

    /** AI의 진행 보고다. 진행 중인 작업만 받고 끝난 작업은 409, 없는 작업은 404, 값 오류는 422다(MCP 전처리 도구가 생기면 그쪽으로 옮긴다). */
    @PostMapping("/{id}/progress")
    fun progress(@PathVariable id: String, @RequestBody request: PreprocessingProgressRequest): PreprocessingJobResponse = service.progress(id, request)

    /** 실패한 작업을 대기로 되돌리고 AI에 다시 접수한다(202). 실패 작업이 아니거나 더 새로운 작업이 있으면 409다. */
    @PostMapping("/{id}/retry") @ResponseStatus(HttpStatus.ACCEPTED)
    fun retry(@PathVariable id: String): PreprocessingJobResponse = service.retry(id)
}
