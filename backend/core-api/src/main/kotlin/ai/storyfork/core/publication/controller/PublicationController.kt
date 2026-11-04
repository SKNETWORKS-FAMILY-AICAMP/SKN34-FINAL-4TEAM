package ai.storyfork.core.publication.controller

import jakarta.validation.Valid
import java.security.Principal
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.web.bind.annotation.*
import ai.storyfork.core.work.service.dto.*
import ai.storyfork.core.episode.service.dto.*
import ai.storyfork.core.publication.service.dto.*

/** 저장 버전 발행과 공개 상태 변경을 담당한다. */
@RestController
@RequestMapping("/api/v1")
@ConditionalOnProperty(name=["app.content.enabled"], havingValue="true")
class PublicationController(private val service: ai.storyfork.core.publication.service.PublicationService, private val works: ai.storyfork.core.work.service.WorkService) {

    /** 선택 저장 버전을 발행한다. 소유자·권리 확인이 필요하며 정책 위반은 403, 버전·순서 충돌은 409다. */
    @PostMapping("/works/{id}/episodes/{number}/publish")
    fun publish(@PathVariable id: String,@PathVariable number: Int,principal: Principal,@Valid @RequestBody data: PublishRequest): EpisodeResponse = service.publishEpisode(id,principal.name,number,data)

    /** 기존 작품 단위 발행 요청을 처리하고 작품 DTO를 반환한다. 소유자·권리 확인 필요, 기준 충돌은 409다. */
    @PostMapping("/works/{id}/publish")
    fun publishCurrent(@PathVariable id: String,principal: Principal,@Valid @RequestBody data: PublishRequest): WorkResponse {
        service.publishCurrent(id,principal.name,data)
        return works.read(id,principal.name)
    }

}
