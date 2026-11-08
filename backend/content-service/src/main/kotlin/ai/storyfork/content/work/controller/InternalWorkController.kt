package ai.storyfork.content.work.controller

import ai.storyfork.content.work.service.InternalWorkService
import ai.storyfork.content.work.service.dto.InternalWorkResponse
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.web.bind.annotation.*

/** 운영 서비스 전용 내부 API. `X-Operations-Service-Token`만으로 인증하며 공개 proxy에 등록하지 않는다. */
@RestController
@RequestMapping("/internal/v1/works/{workId}")
@ConditionalOnProperty(name=["app.content.enabled"], havingValue="true")
class InternalWorkController(private val service: InternalWorkService) {
    /** 신고 대상 작품의 소유자·제목·제한 여부. 없는 작품은 404다. */
    @GetMapping
    fun read(@PathVariable workId: String): InternalWorkResponse = service.read(workId)

    /** 작품을 제한해 공개 목록·상세·회차 열람에서 제외한다. */
    @PutMapping("/restriction")
    fun restrict(@PathVariable workId: String): InternalWorkResponse = service.restrict(workId, true)

    /** 작품 제한을 해제한다. */
    @DeleteMapping("/restriction")
    fun unrestrict(@PathVariable workId: String): InternalWorkResponse = service.restrict(workId, false)
}
