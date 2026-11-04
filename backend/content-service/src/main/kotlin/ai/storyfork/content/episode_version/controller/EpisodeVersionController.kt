package ai.storyfork.content.episode_version.controller

import jakarta.validation.Valid
import java.security.Principal
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.web.bind.annotation.*
import ai.storyfork.content.episode.service.dto.*
import ai.storyfork.content.episode_version.service.dto.*

/** 명시적 원고 버전 저장과 복원을 담당한다. 발행 상태는 변경하지 않는다. */
@RestController
@RequestMapping("/api/v1")
@ConditionalOnProperty(name=["app.content.enabled"], havingValue="true")
class EpisodeVersionController(private val service: ai.storyfork.content.episode_version.service.EpisodeVersionService) {

    /** 입력 원고를 새 버전·부분 체크포인트로 저장한다. 소유자만 가능하며 상속은 403, 충돌은 409다. */
    @PostMapping("/works/{id}/episodes/{number}/versions")
    fun save(@PathVariable id: String,@PathVariable number: Int,principal: Principal,@Valid @RequestBody data: DraftRequest): EpisodeResponse = service.save(id,principal.name,number,data)

    /** 해당 회차의 선택 버전을 새 버전으로 복원한다. 소유자만 가능하며 없는 버전은 404, 충돌은 409다. */
    @PostMapping("/works/{id}/episodes/{number}/restore")
    fun restore(@PathVariable id: String,@PathVariable number: Int,principal: Principal,@Valid @RequestBody data: RevertRequest): EpisodeResponse = service.restore(id,principal.name,number,data)

    /** 기존 작품 단위 작성 계약을 보존한다. 작품 revision으로 저장하며 소유권 위반은 404, 충돌은 409다. */
    @PutMapping("/works/{id}/draft")
    fun saveCurrent(@PathVariable id: String,principal: Principal,@Valid @RequestBody data: DraftRequest): DraftResponse = service.saveCurrent(id,principal.name,data).draft

}
