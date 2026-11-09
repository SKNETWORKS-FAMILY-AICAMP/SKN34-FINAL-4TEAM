package ai.storyfork.content.plan.controller

import ai.storyfork.content.plan.service.StoryPlanService
import ai.storyfork.content.plan.service.dto.*
import jakarta.validation.Valid
import java.security.Principal
import org.springframework.http.HttpStatus
import org.springframework.web.bind.annotation.*

/** 비공개 플롯·장면 계획만 관리하며 원고·세계관 정본을 변경하지 않는다. */
@RestController
@RequestMapping("/api/v1/works/{workId}/story-plans")
class StoryPlanController(private val service: StoryPlanService) {
    /** 소유자의 삭제되지 않은 계획 목록 DTO를 반환한다. 타인 작품은 404다. */
    @GetMapping
    fun list(@PathVariable workId: String, principal: Principal): StoryPlanListResponse = service.list(workId,principal.name)
    /** 소유자의 계획 상세 DTO를 반환한다. 다른 작품·삭제된 계획은 404다. */
    @GetMapping("/{id}")
    fun read(@PathVariable workId: String,@PathVariable id: String,principal: Principal): StoryPlanResponse = service.read(workId,principal.name,id)
    /** 계획 DTO를 생성한다. 소유권·부모·참조를 검사하며 잘못된 입력은 422다. */
    @PostMapping @ResponseStatus(HttpStatus.CREATED)
    fun create(@PathVariable workId: String,principal: Principal,@Valid @RequestBody data: StoryPlanRequest): StoryPlanResponse = service.create(workId,principal.name,data)
    /** 계획 DTO를 수정한다. 소유자만 가능하며 편집 충돌은 409, 참조 오류는 422다. */
    @PutMapping("/{id}")
    fun update(@PathVariable workId: String,@PathVariable id: String,principal: Principal,@Valid @RequestBody data: StoryPlanRequest): StoryPlanResponse = service.update(workId,principal.name,id,data)
    /** 계획을 논리 삭제한다. 소유자만 가능하며 편집 충돌·하위 장면 존재 시 409다. */
    @DeleteMapping("/{id}") @ResponseStatus(HttpStatus.NO_CONTENT)
    fun delete(@PathVariable workId: String,@PathVariable id: String,@RequestParam revision: Int,principal: Principal) = service.delete(workId,principal.name,id,revision)
}
