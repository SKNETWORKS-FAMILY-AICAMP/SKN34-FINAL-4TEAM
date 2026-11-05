package ai.storyfork.content.auth.config

import ai.storyfork.content.auth.service.CoreAuthVerificationService
import jakarta.servlet.DispatcherType
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty
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
    @Bean
    @ConditionalOnProperty(name = ["app.content.enabled"], havingValue = "true")
    fun contentSecurityFilterChain(http: HttpSecurity, service: CoreAuthVerificationService, mapper: JsonMapper): SecurityFilterChain {
        val csrf = CookieCsrfTokenRepository().apply { setHeaderName("X-CSRF-TOKEN") }
        http.cors(withDefaults()).csrf { it.csrfTokenRepository(csrf) }
            .sessionManagement { it.sessionCreationPolicy(SessionCreationPolicy.STATELESS) }
            .authorizeHttpRequests {
                it.dispatcherTypeMatchers(DispatcherType.ERROR).permitAll()
                    .requestMatchers(HttpMethod.GET, "/api/v1/public/works", "/api/v1/public/works/**").permitAll()
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

    @Bean
    @ConditionalOnProperty(name = ["app.content.enabled"], havingValue = "false", matchIfMissing = true)
    fun disabledContentSecurityFilterChain(http: HttpSecurity): SecurityFilterChain {
        http.authorizeHttpRequests { it.anyRequest().denyAll() }
            .httpBasic { it.disable() }.formLogin { it.disable() }.logout { it.disable() }
        return http.build()
    }
}
