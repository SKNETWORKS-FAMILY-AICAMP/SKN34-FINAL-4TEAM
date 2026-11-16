package ai.storyfork.content.episode.controller

import ai.storyfork.content.episode.service.EpisodeWorldBasisService
import ai.storyfork.content.episode.service.dto.EpisodeWorldBasisRequest
import jakarta.validation.Valid
import java.security.Principal
import java.util.UUID
import org.springframework.web.bind.annotation.*

/** 집필 회차가 참조하는 소유 세계관의 확정 버전을 관리한다. */
@RestController
@RequestMapping("/api/v1/works/{id}/episodes/{number}/world-basis")
class EpisodeWorldBasisController(private val service: EpisodeWorldBasisService) {
    /** 집필 회차의 현재 선택과 수정 번호를 반환한다. */
    @GetMapping
    fun read(@PathVariable id: String, @PathVariable number: Int, principal: Principal) =
        service.read(id, UUID.fromString(principal.name), number)

    /** 소유 회차에 확정 버전을 선택한다. 다른 선택으로 바뀐 수정 번호는 409다. */
    @PutMapping
    fun choose(@PathVariable id: String, @PathVariable number: Int, principal: Principal, @Valid @RequestBody request: EpisodeWorldBasisRequest) =
        service.choose(id, UUID.fromString(principal.name), number, request)
}
