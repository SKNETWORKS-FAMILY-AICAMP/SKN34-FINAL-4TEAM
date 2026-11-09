package ai.storyfork.operations.security

import ai.storyfork.operations._common.service.dto.OperationsErrorResponse
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.core.annotation.Order
import org.springframework.http.HttpMethod
import org.springframework.http.MediaType
import org.springframework.security.config.annotation.web.builders.HttpSecurity
import org.springframework.security.config.http.SessionCreationPolicy
import org.springframework.security.web.SecurityFilterChain
import tools.jackson.databind.json.JsonMapper

/** Anonymous public notice reads; ordered before the service-token chain, which still owns every other path. */
@Configuration(proxyBeanMethods = false)
class PublicNoticeSecurityConfig {
    @Bean
    @Order(2)
    fun publicNoticeSecurityFilterChain(http: HttpSecurity, mapper: JsonMapper): SecurityFilterChain {
        // No credential, cookie or session is read here: Bearer and service token never change the meaning of a request.
        http.securityMatcher("/api/v1/operations/public/notices", "/api/v1/operations/public/notices/**")
            .csrf { it.disable() }.cors { it.disable() }
            .sessionManagement { it.sessionCreationPolicy(SessionCreationPolicy.STATELESS) }
            .requestCache { it.disable() }
            .authorizeHttpRequests { it.requestMatchers(HttpMethod.GET).permitAll().anyRequest().denyAll() }
            // Callers are always anonymous, so a refused write reaches the entry point; answer 403 directly, never sendError.
            .exceptionHandling {
                it.authenticationEntryPoint { _, response, _ ->
                    response.status = 403
                    response.contentType = MediaType.APPLICATION_JSON_VALUE
                    mapper.writeValue(response.writer, OperationsErrorResponse("FORBIDDEN", "Access denied."))
                }
            }
            .httpBasic { it.disable() }.formLogin { it.disable() }.logout { it.disable() }
        return http.build()
    }
}
