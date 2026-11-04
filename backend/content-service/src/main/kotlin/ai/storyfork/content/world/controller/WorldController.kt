package ai.storyfork.content.world.controller

import jakarta.validation.Valid
import java.security.Principal
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.web.bind.annotation.*
import ai.storyfork.content.episode_version.service.dto.*
import ai.storyfork.content.world.service.dto.*

/** 세계관 설정의 조회·초안·확정·복원을 담당한다. */
@RestController
@RequestMapping("/api/v1")
@ConditionalOnProperty(name=["app.content.enabled"], havingValue="true")
class WorldController(private val service: ai.storyfork.content.world.service.WorldService) {

    /** 설정집과 공개 범위 DTO를 반환한다. 소유자만 가능하며 접근 불가는 404다. */
    @GetMapping("/works/{id}/world")
    fun read(@PathVariable id: String,principal: Principal): WorldResponse = service.read(id,principal.name)

    /** 설정 초안 DTO를 저장한다. 소유자만 가능하며 revision·원본 토큰 충돌은 409, 입력 오류는 422다. */
    @PutMapping("/works/{id}/settings/{sid}/draft")
    fun draft(@PathVariable id: String,@PathVariable sid: String,principal: Principal,@Valid @RequestBody data: SettingRequest): WorldResponse = service.saveDraft(id,sid,principal.name,data)

    /** 설정 초안을 새 버전으로 확정한다. 소유자만 가능하며 초안 없음·revision 충돌은 409다. */
    @PostMapping("/works/{id}/settings/{sid}/commit")
    fun commit(@PathVariable id: String,@PathVariable sid: String,principal: Principal,@Valid @RequestBody data: RevisionRequest): WorldResponse = service.commit(id,sid,principal.name,data.revision)

    /** 선택 설정 버전을 새 버전으로 복원한다. 소유자만 가능하며 없는 버전은 404, 초안·revision 충돌은 409다. */
    @PostMapping("/works/{id}/settings/{sid}/revert")
    fun revert(@PathVariable id: String,@PathVariable sid: String,principal: Principal,@Valid @RequestBody data: RevertRequest): WorldResponse = service.revert(id,sid,principal.name,data)

}
