package ai.storyfork.operations._common.client

import ai.storyfork.operations.credit.service.dto.CreditAdjustRequest
import ai.storyfork.operations.credit.service.dto.CreditBalancesRequest
import ai.storyfork.operations.member.service.dto.MemberItem
import ai.storyfork.operations.member.service.dto.MemberListResponse
import ai.storyfork.operations.security.OperationsMember
import java.util.Optional
import java.util.UUID
import org.springframework.http.HttpHeaders
import org.springframework.web.client.RestClient
import org.springframework.web.client.body
import tools.jackson.databind.JsonNode

data class CoreAdminRequest(val email: String, val nickname: String, val password: String)

/** Core GET /internal/v1/members/stats; the dashboard shows these three numbers as they are. */
data class MemberStats(val total: Long, val joinedLast7Days: Long, val withdrawalPending: Long)

/** Credit calls also keep Core's 422 (a rule of amount or reason) and show its own message and code (CREDIT_INSUFFICIENT, INVALID_CREDIT_REQUEST). */
private fun <T : Any> credit(call: () -> T?): T = upstream(setOf(400, 404, 409, 422), keepMessage = true, call = call)

/** Core internal APIs; the admin's own Bearer is forwarded so Core re-checks `operator=true`. */
class CoreClient(private val http: RestClient) {
    /** 401/403 keep their meaning; every other verification failure is 502. */
    fun verify(authorization: String): OperationsMember = upstream(setOf(401, 403)) {
        http.post().uri("/internal/v1/auth/verify").header(HttpHeaders.AUTHORIZATION, authorization).retrieve().body<OperationsMember>()
    }

    fun members(authorization: String, role: String?, q: String?, sort: String?): MemberListResponse = upstream {
        http.get().uri {
            // q is expanded as a URI variable so reserved characters such as '+' are percent-encoded.
            it.path("/internal/v1/members").queryParamIfPresent("role", Optional.ofNullable(role))
                .apply { if (q != null) queryParam("q", "{q}") }.queryParamIfPresent("sort", Optional.ofNullable(sort)).build(mapOf("q" to q))
        }.header(HttpHeaders.AUTHORIZATION, authorization).retrieve().body<MemberListResponse>()
    }

    fun restrict(authorization: String, id: UUID): MemberItem = upstream {
        http.put().uri("/internal/v1/members/{id}/restriction", id).header(HttpHeaders.AUTHORIZATION, authorization).retrieve().body<MemberItem>()
    }

    fun unrestrict(authorization: String, id: UUID): MemberItem = upstream {
        http.delete().uri("/internal/v1/members/{id}/restriction", id).header(HttpHeaders.AUTHORIZATION, authorization).retrieve().body<MemberItem>()
    }

    fun memberStats(authorization: String): MemberStats = upstream {
        http.get().uri("/internal/v1/members/stats").header(HttpHeaders.AUTHORIZATION, authorization).retrieve().body<MemberStats>()
    }

    fun createAdmin(authorization: String, request: CoreAdminRequest): MemberItem = upstream {
        http.post().uri("/internal/v1/members/admins").header(HttpHeaders.AUTHORIZATION, authorization)
            .body(request).retrieve().body<MemberItem>()
    }

    // Credit answers are passed through as JSON: Core computes the balance and the history, so the operations API follows it without a copy of the shape.
    fun credits(authorization: String, memberId: UUID): JsonNode = credit {
        http.get().uri("/internal/v1/credits/members/{id}", memberId).header(HttpHeaders.AUTHORIZATION, authorization).retrieve().body<JsonNode>()
    }

    fun grantCredits(authorization: String, memberId: UUID, request: CreditAdjustRequest): JsonNode = credit {
        http.post().uri("/internal/v1/credits/members/{id}/grants", memberId).header(HttpHeaders.AUTHORIZATION, authorization)
            .body(request).retrieve().body<JsonNode>()
    }

    fun revokeCredits(authorization: String, memberId: UUID, request: CreditAdjustRequest): JsonNode = credit {
        http.post().uri("/internal/v1/credits/members/{id}/revocations", memberId).header(HttpHeaders.AUTHORIZATION, authorization)
            .body(request).retrieve().body<JsonNode>()
    }

    /** The balance totals of many members in one call; a member Core does not know is left out of its rows. */
    fun creditBalances(authorization: String, request: CreditBalancesRequest): JsonNode = credit {
        http.post().uri("/internal/v1/credits/balances").header(HttpHeaders.AUTHORIZATION, authorization)
            .body(request).retrieve().body<JsonNode>()
    }
}
