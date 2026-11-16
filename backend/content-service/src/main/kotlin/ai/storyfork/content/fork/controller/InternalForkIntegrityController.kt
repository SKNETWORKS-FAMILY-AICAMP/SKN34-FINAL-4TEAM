package ai.storyfork.content.fork.controller

import ai.storyfork.content.fork.service.ForkIntegrityService
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.PathVariable
import org.springframework.web.bind.annotation.RestController

/** 운영 서비스 토큰으로만 접근하는 읽기 전용 점검이다. */
@RestController
class InternalForkIntegrityController(private val service: ForkIntegrityService) {
    @GetMapping("/internal/v1/works/{id}/fork-integrity")
    fun read(@PathVariable id: String) = service.read(id)
}
