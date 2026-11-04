package ai.storyfork.content.work.controller

import jakarta.validation.Valid
import java.security.Principal
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
import org.springframework.web.bind.annotation.*
import org.springframework.http.HttpStatus
import ai.storyfork.content.work.service.dto.*

/** 작품 등록·조회·수정·작품 정책과 기존 이력 조회 계약을 제공한다. */
@RestController
@RequestMapping("/api/v1")
@ConditionalOnProperty(name=["app.content.enabled"], havingValue="true")
class WorkController(private val service: ai.storyfork.content.work.service.WorkService) {

    /** 인증된 작성자 소유 작품 목록 DTO를 JSON 배열로 반환한다. */
    @GetMapping("/works")
    fun list(principal: Principal): WorkListResponse = service.list(principal.name)

    /** 제목·소개 DTO로 비공개 작품을 만든다. 인증 필요, 입력 오류는 422다. */
    @PostMapping("/works") @ResponseStatus(HttpStatus.CREATED)
    fun create(principal: Principal,@Valid @RequestBody data: CreateWorkRequest): WorkResponse = service.create(principal.name,data)

    /** 작품 상세 DTO를 반환한다. 소유자만 가능하며 접근 불가는 404다. */
    @GetMapping("/works/{id}")
    fun read(@PathVariable id: String,principal: Principal): WorkResponse = service.read(id,principal.name)

    /** 작품 제목·소개를 수정한다. 소유자만 가능하며 revision 충돌은 409, 입력 오류는 422다. */
    @PutMapping("/works/{id}")
    fun update(@PathVariable id: String,principal: Principal,@Valid @RequestBody data: UpdateWorkRequest): WorkResponse = service.update(id,principal.name,data)

    /** 저장 버전·제안·정책·발행 이력을 기존 복합 DTO로 반환한다. 소유자만 가능하며 접근 불가는 404다. */
    @GetMapping("/works/{id}/history")
    fun history(@PathVariable id: String,principal: Principal): HistoryResponse = service.history(id,principal.name)

    /** 원작의 분기 허용 정책을 변경한다. 소유자만 가능하며 Fork는 403, revision 충돌은 409다. */
    @PutMapping("/works/{id}/policy")
    fun policy(@PathVariable id: String,principal: Principal,@Valid @RequestBody data: PolicyRequest): WorkResponse = service.policy(id,principal.name,data)

    /** 공개 작품 목록을 초안 없이 반환한다. 익명 조회를 허용한다. */
    @GetMapping("/public/works")
    fun publicList(): WorkListResponse = service.publicList()

    /** 공개 작품 DTO를 초안 없이 반환한다. 익명 가능, 비공개·없는 작품은 404다. */
    @GetMapping("/public/works/{id}")
    fun publicRead(@PathVariable id: String): WorkResponse = service.publicRead(id)

}
