package ai.storyfork.operations._common.client

import ai.storyfork.operations.member.service.dto.MemberItem
import ai.storyfork.operations.member.service.dto.MemberListResponse
import ai.storyfork.operations.security.OperationsMember
import java.util.Optional
import java.util.UUID
import org.springframework.http.HttpHeaders
import org.springframework.web.client.RestClient
import org.springframework.web.client.body

data class CoreAdminRequest(val email: String, val nickname: String, val password: String)

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

    fun createAdmin(authorization: String, request: CoreAdminRequest): MemberItem = upstream {
        http.post().uri("/internal/v1/members/admins").header(HttpHeaders.AUTHORIZATION, authorization)
            .body(request).retrieve().body<MemberItem>()
    }
}
