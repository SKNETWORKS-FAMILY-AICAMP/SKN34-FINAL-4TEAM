package ai.storyfork.operations.activity.controller

import ai.storyfork.operations.activity.service.AdminActivityService
import ai.storyfork.operations.security.OperationsMember
import org.springframework.http.HttpHeaders
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.web.bind.annotation.*

/** Member Bearer API (operator + `admins` permission); the admin's own Bearer is forwarded to Core for nicknames. There is no write API. */
@RestController
@RequestMapping("/api/v1/operations/admin/activities")
class AdminActivityController(private val service: AdminActivityService) {
    @GetMapping
    fun list(@AuthenticationPrincipal member: OperationsMember, @RequestHeader(HttpHeaders.AUTHORIZATION) authorization: String) =
        service.list(member, authorization)
}
