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

// Content 서비스 토큰을 허용하는 정확한 경로. 나머지 /internal 경로는 운영 서비스 토큰만 받는다.
private val CONTENT_SERVICE_PATHS = setOf("/internal/v1/auth/verify", "/internal/v1/members/nicknames")

@Configuration(proxyBeanMethods = false)
class InternalAuthSecurityConfig {
    @Bean
    @Order(1)
    fun internalAuthSecurityFilterChain(http: HttpSecurity, service: AuthVerificationService): SecurityFilterChain {
        val serviceCredential = object : OncePerRequestFilter() {
            override fun doFilterInternal(request: HttpServletRequest, response: HttpServletResponse, chain: FilterChain) {
                val operations = request.getHeader("X-Operations-Service-Token")
                // 운영 전용 회원 API는 운영 서비스 토큰만, verify·닉네임 조회는 Content·운영 토큰 중 하나를 받는다.
                // 정확한 두 경로만 Content 토큰을 허용하고, 인코딩 변형을 포함한 나머지는 운영 토큰만 받는다.
                val trusted = if (request.requestURI in CONTENT_SERVICE_PATHS) service.isTrusted(request.getHeader("X-Content-Service-Token"), operations)
                    else service.isOperations(operations)
                if (!trusted) {
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
                // 닉네임 조회는 사용자 JWT 없이 위 서비스 자격 필터만 통과하면 된다(필터가 403으로 걸러낸 요청은 여기 오지 않는다).
                it.requestMatchers(HttpMethod.POST, "/internal/v1/members/nicknames").permitAll()
                    .requestMatchers(HttpMethod.POST, "/internal/v1/auth/verify", "/internal/v1/members/admins").authenticated()
                    .requestMatchers(HttpMethod.GET, "/internal/v1/members").authenticated()
                    .requestMatchers(HttpMethod.PUT, "/internal/v1/members/*/restriction").authenticated()
                    .requestMatchers(HttpMethod.DELETE, "/internal/v1/members/*/restriction").authenticated()
                    .anyRequest().denyAll()
            }
            .oauth2ResourceServer { it.jwt(withDefaults()) }
            .addFilterBefore(serviceCredential, BearerTokenAuthenticationFilter::class.java)
            .httpBasic { it.disable() }.formLogin { it.disable() }.logout { it.disable() }
        return http.build()
    }
}
