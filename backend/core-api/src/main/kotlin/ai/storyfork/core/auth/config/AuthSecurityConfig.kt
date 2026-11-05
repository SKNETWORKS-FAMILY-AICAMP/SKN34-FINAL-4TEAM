package ai.storyfork.core.auth.config

import com.nimbusds.jose.jwk.source.ImmutableSecret
import jakarta.servlet.DispatcherType
import java.util.Base64
import java.time.Duration
import javax.crypto.spec.SecretKeySpec
import org.springframework.beans.factory.annotation.Value
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Configuration
import org.springframework.security.config.Customizer.withDefaults
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder
import org.springframework.security.crypto.password.PasswordEncoder
import org.springframework.security.config.annotation.web.builders.HttpSecurity
import org.springframework.security.config.http.SessionCreationPolicy
import org.springframework.security.oauth2.jose.jws.MacAlgorithm
import org.springframework.security.oauth2.jwt.JwtDecoder
import org.springframework.security.oauth2.jwt.JwtTimestampValidator
import org.springframework.security.oauth2.jwt.JwtEncoder
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder
import org.springframework.security.web.SecurityFilterChain
import org.springframework.security.web.csrf.CookieCsrfTokenRepository
import org.springframework.security.web.csrf.CsrfFilter
import org.springframework.security.config.ObjectPostProcessor

@Configuration(proxyBeanMethods = false)
class AuthSecurityConfig {
    @Bean
    fun passwordEncoder(): PasswordEncoder = BCryptPasswordEncoder()

    @Bean
    fun signingKey(@Value("\${AUTH_JWT_SECRET}") encoded: String): SecretKeySpec {
        val bytes = Base64.getDecoder().decode(encoded)
        require(bytes.size >= 32) { "AUTH_JWT_SECRET must be base64-encoded and at least 32 bytes" }
        return SecretKeySpec(bytes, "HmacSHA256")
    }

    @Bean
    fun jwtEncoder(key: SecretKeySpec): JwtEncoder = NimbusJwtEncoder(ImmutableSecret(key))

    @Bean
    fun jwtDecoder(key: SecretKeySpec): JwtDecoder = NimbusJwtDecoder.withSecretKey(key).macAlgorithm(MacAlgorithm.HS256).build().apply {
        setJwtValidator(JwtTimestampValidator(Duration.ZERO).apply { setAllowEmptyExpiryClaim(false) })
    }

    @Bean
    fun securityFilterChain(http: HttpSecurity): SecurityFilterChain {
        val csrf = CookieCsrfTokenRepository().apply { setHeaderName("X-CSRF-TOKEN") }
        http.cors(withDefaults())
            .csrf { it.csrfTokenRepository(csrf).withObjectPostProcessor(object : ObjectPostProcessor<CsrfFilter> {
                override fun <O : CsrfFilter> postProcess(filter: O): O {
                    // Resource server defaults to exempting bearer requests, but this API requires CSRF on every mutation.
                    filter.setRequireCsrfProtectionMatcher(CsrfFilter.DEFAULT_CSRF_MATCHER)
                    return filter
                }
            }) }
            .sessionManagement { it.sessionCreationPolicy(SessionCreationPolicy.STATELESS) }
            .authorizeHttpRequests {
                it.dispatcherTypeMatchers(DispatcherType.ERROR).permitAll()
                    .requestMatchers("/api/v1/health", "/api/v1/health/ai-service", "/api/v1/auth/csrf",
                    "/api/v1/auth/signup", "/api/v1/auth/verify-email", "/api/v1/auth/resend-verification",
                    "/api/v1/auth/login", "/api/v1/auth/refresh", "/api/v1/auth/logout", "/api/v1/auth/forgot-password",
                    "/api/v1/auth/reset-password", "/api/v1/auth/verify-email-change").permitAll()
                    .requestMatchers("/api/v1/me", "/api/v1/me/email-change").authenticated()
                    .requestMatchers("/api/v1/auth/sessions", "/api/v1/auth/sessions/*", "/api/v1/auth/logout-all").authenticated()
                    .requestMatchers("/api/v1/me/notifications", "/api/v1/me/notifications/**", "/api/v1/me/notification-preferences").authenticated()
                    .anyRequest().denyAll()
            }
            .oauth2ResourceServer { it.jwt(withDefaults()) }
            .httpBasic { it.disable() }
            .formLogin { it.disable() }
            .logout { it.disable() }
        return http.build()
    }
}
