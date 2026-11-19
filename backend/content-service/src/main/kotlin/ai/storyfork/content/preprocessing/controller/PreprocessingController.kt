package ai.storyfork.content.preprocessing.controller

import ai.storyfork.content.preprocessing.service.PreprocessingService
import ai.storyfork.content.preprocessing.service.dto.PreprocessingJobResponse
import java.security.Principal
import org.springframework.http.HttpStatus
import org.springframework.web.bind.annotation.*

/** 작가의 [세계관 만들기] 전처리 접수와 진행 조회다(DEC-50, #343). 추출·정리 로직은 아직 없고 접수·진행 기록의 틀만 있다. */
@RestController
@RequestMapping("/api/v1")
class PreprocessingController(private val service: PreprocessingService) {
    /**
     * 작가 본인 작품의 저장 회차 전체로 전처리를 접수한다(202). 소유자가 아니거나 없는 작품은 404, 저장 회차가 없으면 422,
     * 진행 중이거나 완료된 작업이 있으면 409, AI 서비스가 접수하지 않으면 502다(작업은 failed로 남는다).
     */
    @PostMapping("/works/{id}/world-preprocessing") @ResponseStatus(HttpStatus.ACCEPTED)
    fun start(@PathVariable id: String, principal: Principal): PreprocessingJobResponse = service.start(id, principal.name)

    /** 작품의 가장 최근 전처리 작업 상태다. 소유자가 아니거나 없는 작품은 404, 접수한 적이 없으면 404(code PREPROCESSING_NOT_STARTED)다. */
    @GetMapping("/works/{id}/world-preprocessing")
    fun latest(@PathVariable id: String, principal: Principal): PreprocessingJobResponse = service.latest(id, principal.name)
}
