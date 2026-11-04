package ai.storyfork.core.auth.config

import ai.storyfork.core.auth.service.AuthVerificationService
import jakarta.servlet.FilterChain
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletResponse
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.core.annotation.Order
import org.springframework.http.HttpMethod
import org.springframework.security.config.Customizer.withDefaults
import org.springframework.security.config.annotation.web.builders.HttpSecurity
import org.springframework.security.config.http.SessionCreationPolicy
import org.springframework.security.oauth2.server.resource.web.authentication.BearerTokenAuthenticationFilter
import org.springframework.security.web.SecurityFilterChain
import org.springframework.web.filter.OncePerRequestFilter

@Configuration(proxyBeanMethods = false)
class InternalAuthSecurityConfig {
    @Bean
    @Order(1)
    fun internalAuthSecurityFilterChain(http: HttpSecurity, service: AuthVerificationService): SecurityFilterChain {
        val serviceCredential = object : OncePerRequestFilter() {
            override fun doFilterInternal(request: HttpServletRequest, response: HttpServletResponse, chain: FilterChain) {
                if (!service.isTrusted(request.getHeader("X-Content-Service-Token"))) {
                    response.status = 403
                    return
                }
                chain.doFilter(request, response)
            }
        }
        // Only this internal, service-authenticated chain is CSRF-exempt; public mutations remain protected.
        http.securityMatcher("/internal/**").csrf { it.disable() }
            .sessionManagement { it.sessionCreationPolicy(SessionCreationPolicy.STATELESS) }
            .authorizeHttpRequests {
                it.requestMatchers(HttpMethod.POST, "/internal/v1/auth/verify").authenticated().anyRequest().denyAll()
            }
            .oauth2ResourceServer { it.jwt(withDefaults()) }
            .addFilterBefore(serviceCredential, BearerTokenAuthenticationFilter::class.java)
            .httpBasic { it.disable() }.formLogin { it.disable() }.logout { it.disable() }
        return http.build()
    }
}
