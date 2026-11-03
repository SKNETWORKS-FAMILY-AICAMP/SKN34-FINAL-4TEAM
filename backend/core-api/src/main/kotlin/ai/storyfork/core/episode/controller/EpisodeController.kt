package ai.storyfork.core.episode.controller

import jakarta.validation.Valid
import java.security.Principal
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.web.bind.annotation.*
import org.springframework.http.HttpStatus
import ai.storyfork.core.episode.service.dto.*

/** 회차 생성·조회·초안 수정을 제공한다. 삭제는 정책 확정 전 보류한다. */
@RestController
@RequestMapping("/api/v1")
@ConditionalOnProperty(name=["app.content.enabled"], havingValue="true")
class EpisodeController(private val service: ai.storyfork.core.episode.service.EpisodeService) {

    /** 소유자의 회차 목록을 JSON 배열로 반환한다. 인증 필요, 접근 불가 작품은 404다. */
    @GetMapping("/works/{id}/episodes")
    fun list(@PathVariable id: String, principal: Principal): EpisodeListResponse = service.list(id,principal.name)

    /** 제목 DTO로 비공개 회차를 만든다. 소유자만 가능하며 입력 오류는 422다. */
    @PostMapping("/works/{id}/episodes") @ResponseStatus(HttpStatus.CREATED)
    fun create(@PathVariable id: String,principal: Principal,@Valid @RequestBody data: CreateEpisodeRequest): EpisodeResponse = service.create(id,principal.name,data)

    /** 회차 상세 DTO를 반환한다. 소유자만 가능하며 작품·회차가 없으면 404다. */
    @GetMapping("/works/{id}/episodes/{number}")
    fun read(@PathVariable id: String,@PathVariable number: Int,principal: Principal): EpisodeResponse = service.read(id,principal.name,number)

    /** 원고 DTO로 초안만 수정한다. 상속 회차는 403, revision 충돌은 409, 입력 오류는 422다. */
    @PutMapping("/works/{id}/episodes/{number}/draft")
    fun update(@PathVariable id: String,@PathVariable number: Int,principal: Principal,@Valid @RequestBody data: DraftRequest): EpisodeResponse = service.update(id,principal.name,number,data)

}
