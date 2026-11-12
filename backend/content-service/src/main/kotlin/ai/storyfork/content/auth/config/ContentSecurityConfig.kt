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
    // 운영 전용 /internal/v1 하위: 회원 Bearer·CSRF 없이 서비스 토큰만 확인한다. 공개 체인보다 먼저 매칭한다.
    @Bean
    @Order(Ordered.HIGHEST_PRECEDENCE)
    fun operationsInternalSecurityFilterChain(http: HttpSecurity, @Value("\${OPERATIONS_SERVICE_TOKEN:}") token: String): SecurityFilterChain {
        http.securityMatcher("/internal/v1/**").csrf { it.disable() }.cors { it.disable() }
            .sessionManagement { it.sessionCreationPolicy(SessionCreationPolicy.STATELESS) }
            .authorizeHttpRequests { it.anyRequest().hasAuthority("OPERATIONS_SERVICE") }
            .addFilterBefore(OperationsServiceTokenFilter(token), AnonymousAuthenticationFilter::class.java)
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
                    .requestMatchers(HttpMethod.GET, "/api/v1/public/works", "/api/v1/public/works/**").permitAll()
                    .requestMatchers(HttpMethod.POST, "/api/v1/public/works/*/context/qa").authenticated()
                    .requestMatchers("/api/v1/works", "/api/v1/works/**", "/api/v1/world-studios", "/api/v1/world-studios/**").authenticated()
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
