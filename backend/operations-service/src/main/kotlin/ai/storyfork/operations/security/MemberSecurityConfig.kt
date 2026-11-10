package ai.storyfork.operations.security

import ai.storyfork.operations._common.client.CoreClient
import ai.storyfork.operations._common.service.dto.OperationsErrorResponse
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.core.annotation.Order
import org.springframework.security.config.annotation.web.builders.HttpSecurity
import org.springframework.security.config.http.SessionCreationPolicy
import org.springframework.security.web.SecurityFilterChain
import org.springframework.security.web.authentication.AnonymousAuthenticationFilter
import tools.jackson.databind.json.JsonMapper

/** Browser-facing member APIs; ordered before the service-token chain, which still owns every other path. */
@Configuration(proxyBeanMethods = false)
class MemberSecurityConfig {
    @Bean
    @Order(1)
    fun memberSecurityFilterChain(http: HttpSecurity, core: CoreClient, mapper: JsonMapper): SecurityFilterChain {
        val paths = listOf("reports", "members", "admins", "support", "admin/notices", "admin/events", "admin/activities", "works").flatMap { listOf("/api/v1/operations/$it", "/api/v1/operations/$it/**") }
        // Bearer header only (no cookie/session), so CSRF protection is not applicable.
        http.securityMatcher(*paths.toTypedArray())
            .csrf { it.disable() }.cors { it.disable() }
            .sessionManagement { it.sessionCreationPolicy(SessionCreationPolicy.STATELESS) }
            .requestCache { it.disable() }
            .authorizeHttpRequests { it.anyRequest().authenticated() }
            .exceptionHandling {
                it.authenticationEntryPoint { _, response, _ ->
                    response.setHeader("WWW-Authenticate", "Bearer")
                    response.writeError(mapper, 401, OperationsErrorResponse("UNAUTHORIZED", "Authentication required."))
                }
            }
            .addFilterBefore(MemberBearerFilter(core, mapper), AnonymousAuthenticationFilter::class.java)
            .httpBasic { it.disable() }.formLogin { it.disable() }.logout { it.disable() }
        return http.build()
    }
}
