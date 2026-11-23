package ai.storyfork.operations.dashboard.controller

import ai.storyfork.operations.dashboard.service.DashboardService
import ai.storyfork.operations.security.OperationsMember
import org.springframework.http.HttpHeaders
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.web.bind.annotation.*

/** Member Bearer API for any operator; the admin's own Bearer is forwarded to Core for the member counts. */
@RestController
@RequestMapping("/api/v1/operations/dashboard")
class DashboardController(private val service: DashboardService) {
    @GetMapping
    fun get(@AuthenticationPrincipal member: OperationsMember, @RequestHeader(HttpHeaders.AUTHORIZATION) authorization: String) =
        service.get(member, authorization)
}
