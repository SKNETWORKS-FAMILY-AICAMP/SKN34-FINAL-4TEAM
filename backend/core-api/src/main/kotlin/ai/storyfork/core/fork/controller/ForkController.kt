package ai.storyfork.core.fork.controller

import jakarta.validation.Valid
import java.security.Principal
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.web.bind.annotation.*
import org.springframework.http.HttpStatus
import ai.storyfork.core.work.service.dto.*
import ai.storyfork.core.world.service.dto.*
import ai.storyfork.core.fork.service.dto.*

/** Fork 생성과 독립 후 원본 변경 선택을 담당한다. */
@RestController
@RequestMapping("/api/v1")
@ConditionalOnProperty(name=["app.content.enabled"], havingValue="true")
class ForkController(private val service: ai.storyfork.core.fork.service.ForkService) {

    /** 공개 원작에서 기준 회차를 보존한 Fork를 만든다. 인증 필요, 정책 위반은 403, 중복은 409다. */
    @PostMapping("/works/{id}/forks") @ResponseStatus(HttpStatus.CREATED)
    fun create(@PathVariable id: String,principal: Principal,@Valid @RequestBody data: ForkRequest): WorkResponse = service.create(id,principal.name,data)

    /** 원본 변경의 적용·거절을 기록한다. Fork 소유자만 가능하며 기준 변경·이미 적용한 변경은 409다. */
    @PostMapping("/works/{id}/world/changes")
    fun change(@PathVariable id: String,principal: Principal,@Valid @RequestBody data: ChangeRequest): WorldResponse = service.decideChange(id,principal.name,data)

}
