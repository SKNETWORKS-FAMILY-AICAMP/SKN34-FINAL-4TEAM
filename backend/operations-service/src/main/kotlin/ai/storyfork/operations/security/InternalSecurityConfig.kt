package ai.storyfork.operations.security

import ai.storyfork.operations._common.service.dto.OperationsErrorResponse
import org.springframework.beans.factory.annotation.Value
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.core.annotation.Order
import org.springframework.security.config.annotation.web.builders.HttpSecurity
import org.springframework.security.config.http.SessionCreationPolicy
import org.springframework.security.web.SecurityFilterChain
import org.springframework.security.web.authentication.AnonymousAuthenticationFilter
import tools.jackson.databind.json.JsonMapper

private const val INTERNAL_AUTHORITY = "OPERATIONS_INTERNAL"

/**
 * The AI service's job workers call back into operations with the internal token the services already share (X-Internal-Token, compared in constant time),
 * on /internal/v1/jobs only. Ordered before the service-token chain, which still owns every other path and keeps denying all but its own routes.
 */
@Configuration(proxyBeanMethods = false)
class InternalSecurityConfig {
    @Bean
    @Order(3)
    fun internalSecurityFilterChain(http: HttpSecurity, mapper: JsonMapper, @Value("\${app.operations.internal-token:}") token: String): SecurityFilterChain {
        // No cookie/session authentication; only the explicit server-to-server header authorizes a call.
        http.securityMatcher("/internal/v1/jobs", "/internal/v1/jobs/**")
            .csrf { it.disable() }.cors { it.disable() }
            .sessionManagement { it.sessionCreationPolicy(SessionCreationPolicy.STATELESS) }
            .requestCache { it.disable() }
            .authorizeHttpRequests { it.anyRequest().hasAuthority(INTERNAL_AUTHORITY) }
            .exceptionHandling {
                it.authenticationEntryPoint { _, response, _ ->
                    response.writeError(mapper, 401, OperationsErrorResponse("UNAUTHORIZED", "Authentication required."))
                }.accessDeniedHandler { _, response, _ ->
                    response.writeError(mapper, 403, OperationsErrorResponse("FORBIDDEN", "Access denied."))
                }
            }
            .addFilterBefore(OperationsServiceTokenFilter(token, mapper, "X-Internal-Token", INTERNAL_AUTHORITY), AnonymousAuthenticationFilter::class.java)
            .httpBasic { it.disable() }.formLogin { it.disable() }.logout { it.disable() }
        return http.build()
    }
}
