package ai.storyfork.operations.member.controller

import ai.storyfork.operations.member.service.MemberService
import ai.storyfork.operations.member.service.dto.*
import ai.storyfork.operations.security.OperationsMember
import java.util.UUID
import org.springframework.http.HttpHeaders
import org.springframework.http.HttpStatus
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.web.bind.annotation.*

@RestController
@RequestMapping("/api/v1/operations/members")
class MemberController(private val service: MemberService) {
    @GetMapping
    fun list(
        @AuthenticationPrincipal member: OperationsMember, @RequestHeader(HttpHeaders.AUTHORIZATION) authorization: String,
        @RequestParam(required = false) role: String?, @RequestParam(required = false) q: String?,
        @RequestParam(required = false) sort: String?,
    ): MemberListResponse = service.list(member, authorization, role, q, sort)

    @PutMapping("/{id}/restriction")
    fun restrict(@AuthenticationPrincipal member: OperationsMember, @RequestHeader(HttpHeaders.AUTHORIZATION) authorization: String,
        @PathVariable id: UUID): MemberItem = service.restrict(member, authorization, id)

    @DeleteMapping("/{id}/restriction")
    fun unrestrict(@AuthenticationPrincipal member: OperationsMember, @RequestHeader(HttpHeaders.AUTHORIZATION) authorization: String,
        @PathVariable id: UUID): MemberItem = service.unrestrict(member, authorization, id)
}

@RestController
@RequestMapping("/api/v1/operations/admins")
class AdminController(private val service: MemberService) {
    @GetMapping
    fun list(@AuthenticationPrincipal member: OperationsMember, @RequestHeader(HttpHeaders.AUTHORIZATION) authorization: String) =
        service.admins(member, authorization)

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    fun create(@AuthenticationPrincipal member: OperationsMember, @RequestHeader(HttpHeaders.AUTHORIZATION) authorization: String,
        @RequestBody request: CreateAdminRequest): AdminItem = service.createAdmin(member, authorization, request)
}
