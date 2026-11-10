package ai.storyfork.operations.security

import ai.storyfork.operations._common.service.dto.OperationsErrorResponse
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.core.annotation.Order
import org.springframework.http.HttpMethod
import org.springframework.security.config.annotation.web.builders.HttpSecurity
import org.springframework.security.config.http.SessionCreationPolicy
import org.springframework.security.web.SecurityFilterChain
import tools.jackson.databind.json.JsonMapper

/** Anonymous public notice and event reads; ordered before the service-token chain, which still owns every other path. */
@Configuration(proxyBeanMethods = false)
class PublicSecurityConfig {
    @Bean
    @Order(2)
    fun publicSecurityFilterChain(http: HttpSecurity, mapper: JsonMapper): SecurityFilterChain {
        val paths = listOf("notices", "events").flatMap { listOf("/api/v1/operations/public/$it", "/api/v1/operations/public/$it/**") }
        // No credential, cookie or session is read here: Bearer and service token never change the meaning of a request.
        http.securityMatcher(*paths.toTypedArray())
            .csrf { it.disable() }.cors { it.disable() }
            .sessionManagement { it.sessionCreationPolicy(SessionCreationPolicy.STATELESS) }
            .requestCache { it.disable() }
            .authorizeHttpRequests { it.requestMatchers(HttpMethod.GET).permitAll().anyRequest().denyAll() }
            // Callers are always anonymous, so a refused write reaches the entry point; answer 403 directly, never sendError.
            .exceptionHandling {
                it.authenticationEntryPoint { _, response, _ ->
                    response.writeError(mapper, 403, OperationsErrorResponse("FORBIDDEN", "Access denied."))
                }
            }
            .httpBasic { it.disable() }.formLogin { it.disable() }.logout { it.disable() }
        return http.build()
    }
}
