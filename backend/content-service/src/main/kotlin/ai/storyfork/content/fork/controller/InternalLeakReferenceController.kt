package ai.storyfork.content.fork.controller

import ai.storyfork.content.fork.service.ForkLeakReferenceService
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.RestController

/** 운영 서비스 토큰으로만 접근하는 읽기 전용 누설 비교 기준이다. 안 보이는 카드 제목을 내보내는 유일한 출구라 공개 proxy에 등록하지 않는다. */
@RestController
class InternalLeakReferenceController(private val service: ForkLeakReferenceService) {
    @GetMapping("/internal/v1/works/{id}/leak-references")
    fun read(@PathVariable id: String) = service.read(id)
}
