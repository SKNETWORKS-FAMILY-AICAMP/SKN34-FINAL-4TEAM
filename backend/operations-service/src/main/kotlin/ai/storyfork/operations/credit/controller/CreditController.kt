package ai.storyfork.operations.credit.controller

import ai.storyfork.operations.credit.service.CreditService
import ai.storyfork.operations.credit.service.dto.CreditAdjustRequest
import ai.storyfork.operations.credit.service.dto.CreditBalancesRequest
import ai.storyfork.operations.security.OperationsMember
import java.util.UUID
import org.springframework.http.HttpHeaders
import org.springframework.http.HttpStatus
import org.springframework.security.core.annotation.AuthenticationPrincipal
import org.springframework.web.bind.annotation.*
import tools.jackson.databind.JsonNode

/** Member Bearer API for an operator with the `credits` permission; the admin's own Bearer is forwarded to Core. */
@RestController
@RequestMapping("/api/v1/operations/credits")
class CreditController(private val service: CreditService) {
    @GetMapping("/members/{memberId}")
    fun read(@AuthenticationPrincipal member: OperationsMember, @RequestHeader(HttpHeaders.AUTHORIZATION) authorization: String,
        @PathVariable memberId: UUID): JsonNode = service.read(member, authorization, memberId)

    @PostMapping("/members/{memberId}/grants")
    @ResponseStatus(HttpStatus.CREATED)
    fun grant(@AuthenticationPrincipal member: OperationsMember, @RequestHeader(HttpHeaders.AUTHORIZATION) authorization: String,
        @PathVariable memberId: UUID, @RequestBody request: CreditAdjustRequest): JsonNode = service.grant(member, authorization, memberId, request)

    @PostMapping("/members/{memberId}/revocations")
    @ResponseStatus(HttpStatus.CREATED)
    fun revoke(@AuthenticationPrincipal member: OperationsMember, @RequestHeader(HttpHeaders.AUTHORIZATION) authorization: String,
        @PathVariable memberId: UUID, @RequestBody request: CreditAdjustRequest): JsonNode = service.revoke(member, authorization, memberId, request)

    @PostMapping("/balances")
    fun balances(@AuthenticationPrincipal member: OperationsMember, @RequestHeader(HttpHeaders.AUTHORIZATION) authorization: String,
        @RequestBody request: CreditBalancesRequest): JsonNode = service.balances(member, authorization, request)
}
