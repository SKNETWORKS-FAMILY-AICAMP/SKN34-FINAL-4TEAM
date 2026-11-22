package ai.storyfork.content.auth.config

import ai.storyfork.content.auth.service.CoreAuthVerificationService
import jakarta.servlet.DispatcherType
import org.springframework.beans.factory.annotation.Value
import org.springframework.core.Ordered
import org.springframework.core.annotation.Order
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.http.HttpMethod
import org.springframework.security.config.Customizer.withDefaults
import org.springframework.security.config.annotation.web.builders.HttpSecurity
import org.springframework.security.config.http.SessionCreationPolicy
import org.springframework.security.web.SecurityFilterChain
import org.springframework.security.web.authentication.AnonymousAuthenticationFilter
import org.springframework.security.web.csrf.CookieCsrfTokenRepository
import tools.jackson.databind.json.JsonMapper

@Configuration(proxyBeanMethods = false)
class ContentSecurityConfig {
    // AI 전용 내부 경로: INTERNAL_TOKEN만 확인한다. 운영 체인보다 먼저 매칭한다. /internal/v1/ai 하위(오케스트레이션 Retrieval) 외에
    // 전처리 진행 보고 한 경로만 더한다(#343). 같은 접두의 목록·재실행은 운영 체인에 남는다.
    @Bean
    @Order(Ordered.HIGHEST_PRECEDENCE)
    fun aiInternalSecurityFilterChain(http: HttpSecurity, @Value("\${INTERNAL_TOKEN:}") token: String): SecurityFilterChain {
        http.securityMatcher("/internal/v1/ai/**", "/internal/v1/preprocessing-jobs/*/progress").csrf { it.disable() }.cors { it.disable() }
            .sessionManagement { it.sessionCreationPolicy(SessionCreationPolicy.STATELESS) }
            .authorizeHttpRequests { it.anyRequest().hasAuthority("AI_SERVICE") }
            .addFilterBefore(OperationsServiceTokenFilter(token, "X-Internal-Token", "AI_SERVICE"), AnonymousAuthenticationFilter::class.java)
            .httpBasic { it.disable() }.formLogin { it.disable() }.logout { it.disable() }
        return http.build()
    }

    // 운영 전용 /internal/v1 하위: 회원 Bearer·CSRF 없이 서비스 토큰만 확인한다. 공개 체인보다 먼저 매칭한다.
    @Bean
    @Order(Ordered.HIGHEST_PRECEDENCE + 1)
    fun operationsInternalSecurityFilterChain(http: HttpSecurity, @Value("\${OPERATIONS_SERVICE_TOKEN:}") token: String): SecurityFilterChain {
        http.securityMatcher("/internal/v1/**").csrf { it.disable() }.cors { it.disable() }
            .sessionManagement { it.sessionCreationPolicy(SessionCreationPolicy.STATELESS) }
            .authorizeHttpRequests { it.anyRequest().hasAuthority("OPERATIONS_SERVICE") }
            .addFilterBefore(OperationsServiceTokenFilter(token), AnonymousAuthenticationFilter::class.java)
            .httpBasic { it.disable() }.formLogin { it.disable() }.logout { it.disable() }
        return http.build()
    }

    // MCP 창구(#163): 내부 전용 `/mcp`. 공개 도구는 인증 없이, 사용자 도구는 Bearer를 기존 필터로 검증한 회원으로 호출되며
    // 인증 요구는 도구가 정하므로 여기서는 permitAll이다. 브라우저 쿠키가 아닌 서비스 간 Bearer 호출이라 이 체인에서만 CSRF·CORS를 끈다.
    @Bean
    @Order(Ordered.HIGHEST_PRECEDENCE + 1)
    fun mcpSecurityFilterChain(http: HttpSecurity, service: CoreAuthVerificationService, mapper: JsonMapper): SecurityFilterChain {
        http.securityMatcher("/mcp", "/mcp/**").csrf { it.disable() }.cors { it.disable() }
            .sessionManagement { it.sessionCreationPolicy(SessionCreationPolicy.STATELESS) }
            .authorizeHttpRequests { it.anyRequest().permitAll() }
            .addFilterBefore(ContentAuthenticationFilter(service, mapper), AnonymousAuthenticationFilter::class.java)
            .httpBasic { it.disable() }.formLogin { it.disable() }.logout { it.disable() }
        return http.build()
    }

    @Bean
    fun contentSecurityFilterChain(http: HttpSecurity, service: CoreAuthVerificationService, mapper: JsonMapper): SecurityFilterChain {
        val csrf = CookieCsrfTokenRepository().apply { setHeaderName("X-CSRF-TOKEN") }
        http.cors(withDefaults()).csrf { it.csrfTokenRepository(csrf) }
            .sessionManagement { it.sessionCreationPolicy(SessionCreationPolicy.STATELESS) }
            .authorizeHttpRequests {
                it.dispatcherTypeMatchers(DispatcherType.ERROR).permitAll()
                    .requestMatchers(HttpMethod.GET, "/api/v1/public/works", "/api/v1/public/works/**",
                        "/api/v1/public/world-studios", "/api/v1/public/world-studios/**", "/api/v1/public/genres").permitAll()
                    // AI 자율 연재의 독자 게시판 읽기(UC-18)는 공개 작품이면 익명도 된다. Bearer가 있으면 필터가 회원을 확인해 내 의견·투표를 채운다. 아래 /works/** 규칙보다 먼저 와야 한다.
                    .requestMatchers(HttpMethod.GET, "/api/v1/works/*/serial-board").permitAll()
                    .requestMatchers("/api/v1/works", "/api/v1/works/**", "/api/v1/world-studios", "/api/v1/world-studios/**").authenticated()
                    .requestMatchers(HttpMethod.GET, "/api/v1/me/storage-usage").authenticated()
                    .anyRequest().denyAll()
            }
            .exceptionHandling { it.authenticationEntryPoint { _, response, _ ->
                response.setHeader("WWW-Authenticate", "Bearer"); response.status = 401
            } }
            .addFilterBefore(ContentAuthenticationFilter(service, mapper), AnonymousAuthenticationFilter::class.java)
            .httpBasic { it.disable() }.formLogin { it.disable() }.logout { it.disable() }
        return http.build()
    }
}
