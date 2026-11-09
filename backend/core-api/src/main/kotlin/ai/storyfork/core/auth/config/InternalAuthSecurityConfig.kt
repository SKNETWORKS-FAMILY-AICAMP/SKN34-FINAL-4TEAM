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
                val operations = request.getHeader("X-Operations-Service-Token")
                val content = request.getHeader("X-Content-Service-Token")
                // 운영 전용 회원 API는 운영 서비스 토큰만, verify는 Content·운영 토큰 중 하나, 닉네임 일괄 조회는 Content 토큰만 받는다.
                // 정확한 verify·nicknames 경로만 Content 토큰을 허용하고, 인코딩 변형을 포함한 나머지는 운영 토큰만 받는다.
                val trusted = when (request.requestURI) {
                    "/internal/v1/auth/verify" -> service.isTrusted(content, operations)
                    "/internal/v1/members/nicknames" -> service.isContent(content)
                    else -> service.isOperations(operations)
                }
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
                it.requestMatchers(HttpMethod.POST, "/internal/v1/auth/verify", "/internal/v1/members/admins").authenticated()
                    // 닉네임 일괄 조회는 사용자 Bearer가 없다. 위 서비스 자격 필터가 Content 토큰이 아니면 이미 403으로 막는다.
                    .requestMatchers(HttpMethod.POST, "/internal/v1/members/nicknames").permitAll()
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
