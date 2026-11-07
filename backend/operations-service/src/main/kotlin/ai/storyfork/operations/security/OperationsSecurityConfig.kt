package ai.storyfork.operations.security

import ai.storyfork.operations._common.service.dto.OperationsErrorResponse
import org.springframework.beans.factory.annotation.Value
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.http.MediaType
import org.springframework.security.config.annotation.web.builders.HttpSecurity
import org.springframework.security.config.http.SessionCreationPolicy
import org.springframework.security.provisioning.InMemoryUserDetailsManager
import org.springframework.security.web.SecurityFilterChain
import org.springframework.security.web.authentication.AnonymousAuthenticationFilter
import tools.jackson.databind.json.JsonMapper

@Configuration(proxyBeanMethods = false)
class OperationsSecurityConfig {
    // Prevent Boot from creating/logging an unused default human-login password.
    @Bean
    fun operationsUsers() = InMemoryUserDetailsManager()

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
                    response.status = 401
                    response.contentType = MediaType.APPLICATION_JSON_VALUE
                    mapper.writeValue(response.writer, OperationsErrorResponse("UNAUTHORIZED", "Authentication required."))
                }.accessDeniedHandler { _, response, _ ->
                    response.status = 403
                    response.contentType = MediaType.APPLICATION_JSON_VALUE
                    mapper.writeValue(response.writer, OperationsErrorResponse("FORBIDDEN", "Access denied."))
                }
            }
            .addFilterBefore(OperationsServiceTokenFilter(token, mapper), AnonymousAuthenticationFilter::class.java)
            .httpBasic { it.disable() }.formLogin { it.disable() }.logout { it.disable() }
        return http.build()
    }
}
