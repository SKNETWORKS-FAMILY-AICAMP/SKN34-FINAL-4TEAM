package ai.storyfork.operations.security

import ai.storyfork.operations._common.client.CoreClient
import ai.storyfork.operations._common.service.dto.OperationsErrorResponse
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.core.annotation.Order
import org.springframework.http.HttpMethod
import org.springframework.http.MediaType
import org.springframework.security.config.annotation.web.builders.HttpSecurity
import org.springframework.security.config.http.SessionCreationPolicy
import org.springframework.security.web.SecurityFilterChain
import org.springframework.security.web.authentication.AnonymousAuthenticationFilter
import tools.jackson.databind.json.JsonMapper

/** Browser-facing APIs (member Bearer and read-only public events); ordered before the service-token chain, which still owns every other path. */
@Configuration(proxyBeanMethods = false)
class MemberSecurityConfig {
    @Bean
    @Order(1)
    fun memberSecurityFilterChain(http: HttpSecurity, core: CoreClient, mapper: JsonMapper): SecurityFilterChain {
        val paths = listOf("reports", "members", "admins", "admin/events").flatMap { listOf("/api/v1/operations/$it", "/api/v1/operations/$it/**") }
        // Bearer header only (no cookie/session), so CSRF protection is not applicable.
        http.securityMatcher(*paths.toTypedArray())
            .csrf { it.disable() }.cors { it.disable() }
            .sessionManagement { it.sessionCreationPolicy(SessionCreationPolicy.STATELESS) }
            .requestCache { it.disable() }
            .authorizeHttpRequests { it.anyRequest().authenticated() }
            .exceptionHandling {
                it.authenticationEntryPoint { _, response, _ ->
                    response.status = 401
                    response.setHeader("WWW-Authenticate", "Bearer")
                    response.contentType = MediaType.APPLICATION_JSON_VALUE
                    mapper.writeValue(response.writer, OperationsErrorResponse("UNAUTHORIZED", "Authentication required."))
                }
            }
            .addFilterBefore(MemberBearerFilter(core, mapper), AnonymousAuthenticationFilter::class.java)
            .httpBasic { it.disable() }.formLogin { it.disable() }.logout { it.disable() }
        return http.build()
    }

    /** Reader events: GET without credentials, every other method denied. No authentication filter, so a Bearer or service token changes nothing. */
    @Bean
    @Order(2)
    fun publicEventSecurityFilterChain(http: HttpSecurity, mapper: JsonMapper): SecurityFilterChain {
        http.securityMatcher("/api/v1/operations/public/events", "/api/v1/operations/public/events/**")
            .csrf { it.disable() }.cors { it.disable() }
            .sessionManagement { it.sessionCreationPolicy(SessionCreationPolicy.STATELESS) }
            .requestCache { it.disable() }
            .authorizeHttpRequests { it.requestMatchers(HttpMethod.GET).permitAll().anyRequest().denyAll() }
            .exceptionHandling {
                // Written directly like the other chains: sendError would re-dispatch to /error, which the service-token chain denies.
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
