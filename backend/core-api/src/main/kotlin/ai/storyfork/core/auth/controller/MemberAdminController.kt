package ai.storyfork.core.auth.controller

import ai.storyfork.core.auth.service.MemberAdminService
import ai.storyfork.core.auth.service.dto.AdminCreateRequest
import ai.storyfork.core.auth.service.dto.MemberItem
import ai.storyfork.core.auth.service.dto.MemberListResponse
import jakarta.validation.Valid
import java.util.UUID
import org.springframework.http.HttpStatus
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.security.oauth2.jwt.Jwt
import org.springframework.web.bind.annotation.*

/** 운영 서비스 전용 회원 조회·이용 제한·관리자 생성. 운영 서비스 토큰과 operator 회원 Bearer가 필요하다(아니면 403). */
@RestController
@RequestMapping("/internal/v1/members")
class MemberAdminController(private val service: MemberAdminService) {
    /** role(ALL·MEMBER·ADMIN)·q(닉네임·이메일 부분 일치)·sort(newest·oldest)로 최대 200명을 반환한다. 잘못된 값은 400이다. */
    @GetMapping
    fun list(@AuthenticationPrincipal jwt: Jwt, @RequestParam(defaultValue = "ALL") role: String,
        @RequestParam(defaultValue = "") q: String, @RequestParam(defaultValue = "newest") sort: String): MemberListResponse =
        service.list(jwt.subject, role, q, sort)

    /** 회원을 이용 제한한다. 자기 자신은 400, 없는 회원은 404다. */
    @PutMapping("/{id}/restriction")
    fun restrict(@AuthenticationPrincipal jwt: Jwt, @PathVariable id: UUID): MemberItem = service.restrict(jwt.subject, id)

    /** 회원 이용 제한을 해제한다. 자기 자신은 400, 없는 회원은 404다. */
    @DeleteMapping("/{id}/restriction")
    fun unrestrict(@AuthenticationPrincipal jwt: Jwt, @PathVariable id: UUID): MemberItem = service.unrestrict(jwt.subject, id)

    /** 운영 관리자 계정을 만들고 201을 반환한다. 중복 이메일은 409다. */
    @PostMapping("/admins")
    @ResponseStatus(HttpStatus.CREATED)
    fun createAdmin(@AuthenticationPrincipal jwt: Jwt, @Valid @RequestBody body: AdminCreateRequest): MemberItem =
        service.createAdmin(jwt.subject, body)
}
