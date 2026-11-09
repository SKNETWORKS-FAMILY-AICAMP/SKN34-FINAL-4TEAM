package ai.storyfork.operations.security

import ai.storyfork.operations._common.service.dto.OperationsErrorResponse
import org.springframework.beans.factory.annotation.Value
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.security.config.annotation.web.builders.HttpSecurity
import org.springframework.security.config.http.SessionCreationPolicy
import org.springframework.security.web.SecurityFilterChain
import org.springframework.security.web.authentication.AnonymousAuthenticationFilter
import tools.jackson.databind.json.JsonMapper

@Configuration(proxyBeanMethods = false)
class OperationsSecurityConfig {
    @Bean
    fun operationsSecurityFilterChain(
        http: HttpSecurity,
        mapper: JsonMapper,
        @Value("\${app.operations.service-token:}") token: String,
    ): SecurityFilterChain {
        // No cookie/session authentication; only an explicit server-to-server header authorizes mutations.
        http.csrf { it.disable() }.cors { it.disable() }
            .sessionManagement { it.sessionCreationPolicy(SessionCreationPolicy.STATELESS) }
            .requestCache { it.disable() }
            .authorizeHttpRequests {
                it.requestMatchers("/api/v1/operations/**").hasAuthority("OPERATIONS_SERVICE")
                    .anyRequest().denyAll()
            }
            .exceptionHandling {
                it.authenticationEntryPoint { _, response, _ ->
                    response.writeError(mapper, 401, OperationsErrorResponse("UNAUTHORIZED", "Authentication required."))
                }.accessDeniedHandler { _, response, _ ->
                    response.writeError(mapper, 403, OperationsErrorResponse("FORBIDDEN", "Access denied."))
                }
            }
            .addFilterBefore(OperationsServiceTokenFilter(token, mapper), AnonymousAuthenticationFilter::class.java)
            .httpBasic { it.disable() }.formLogin { it.disable() }.logout { it.disable() }
        return http.build()
    }
}
