package ai.storyfork.content.preprocessing.controller

import ai.storyfork.content.preprocessing.service.PreprocessingService
import ai.storyfork.content.preprocessing.service.dto.PreprocessingJobResponse
import ai.storyfork.content.world.service.dto.ManuscriptBuildRequest
import java.security.Principal
import org.springframework.http.HttpStatus
import org.springframework.web.bind.annotation.*

/** 작가의 [세계관 만들기] 전처리 접수와 진행 조회다(DEC-50, #343). 이 서비스는 접수·고정 입력·진행 기록을 소유하고 추출·정리는 AI 서비스가 한다. */
@RestController
@RequestMapping("/api/v1")
class PreprocessingController(private val service: PreprocessingService) {
    /**
     * 작가 본인 작품의 저장 회차 전체로 전처리를 접수한다(202). 소유자가 아니거나 없는 작품은 404, 저장 회차가 없으면 422,
     * 진행 중이거나 완료된 작업이 있으면 409, 최초 입력을 준비할 수 없으면 404·409·422(사유 문구, 접수 행은 남기지 않는다), AI 서비스의 접수 응답이 없으면 502다(작업은 queued로 남는다).
     */
    @PostMapping("/works/{id}/world-preprocessing") @ResponseStatus(HttpStatus.ACCEPTED)
    fun start(@PathVariable id: String, principal: Principal, @RequestBody(required=false) request: ManuscriptBuildRequest? = null): PreprocessingJobResponse = service.start(id, principal.name, request)

    /** 작품의 가장 최근 전처리 작업 상태다. 소유자가 아니거나 없는 작품은 404, 접수한 적이 없으면 404(code PREPROCESSING_NOT_STARTED)다. */
    @GetMapping("/works/{id}/world-preprocessing")
    fun latest(@PathVariable id: String, principal: Principal): PreprocessingJobResponse = service.latest(id, principal.name)
}
