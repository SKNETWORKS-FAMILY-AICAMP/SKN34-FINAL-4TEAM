package ai.storyfork.core.auth.config

import ai.storyfork.core.auth.service.SessionService
import ai.storyfork.core.auth.service.dto.MemberResponse
import com.nimbusds.jose.jwk.JWKSet
import com.nimbusds.jose.jwk.RSAKey
import com.nimbusds.jose.jwk.source.ImmutableJWKSet
import com.nimbusds.jose.jwk.source.JWKSource
import com.nimbusds.jose.proc.SecurityContext
import jakarta.servlet.FilterChain
import jakarta.servlet.http.HttpServletRequest
import jakarta.servlet.http.HttpServletRequestWrapper
import jakarta.servlet.http.HttpServletResponse
import java.security.KeyFactory
import java.security.interfaces.RSAPrivateCrtKey
import java.security.interfaces.RSAPublicKey
import java.security.spec.PKCS8EncodedKeySpec
import java.security.spec.RSAPublicKeySpec
import java.util.Base64
import org.springframework.boot.context.properties.EnableConfigurationProperties
import org.springframework.context.annotation.Bean
import org.springframework.context.annotation.Condition
import org.springframework.context.annotation.ConditionContext
import org.springframework.context.annotation.Conditional
import org.springframework.context.annotation.Configuration
import org.springframework.core.Ordered
import org.springframework.core.annotation.Order
import org.springframework.core.type.AnnotatedTypeMetadata
import org.springframework.security.config.Customizer
import org.springframework.security.config.annotation.web.builders.HttpSecurity
import org.springframework.security.config.annotation.web.configuration.OAuth2AuthorizationServerConfiguration
import org.springframework.security.config.http.SessionCreationPolicy
import org.springframework.security.core.Authentication
import org.springframework.security.crypto.password.PasswordEncoder
import org.springframework.security.oauth2.core.AuthorizationGrantType
import org.springframework.security.oauth2.core.ClientAuthenticationMethod
import org.springframework.security.oauth2.core.oidc.OidcScopes
import org.springframework.security.oauth2.core.oidc.StandardClaimNames
import org.springframework.security.oauth2.core.oidc.endpoint.OidcParameterNames
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder
import org.springframework.security.oauth2.server.authorization.InMemoryOAuth2AuthorizationService
import org.springframework.security.oauth2.server.authorization.client.InMemoryRegisteredClientRepository
import org.springframework.security.oauth2.server.authorization.client.RegisteredClient
import org.springframework.security.oauth2.server.authorization.settings.AuthorizationServerSettings
import org.springframework.security.oauth2.server.authorization.settings.ClientSettings
import org.springframework.security.oauth2.server.authorization.token.JwtEncodingContext
import org.springframework.security.oauth2.server.authorization.token.JwtGenerator
import org.springframework.security.oauth2.server.authorization.token.OAuth2TokenCustomizer
import org.springframework.security.web.SecurityFilterChain
import org.springframework.security.web.context.SecurityContextHolderFilter
import org.springframework.security.web.session.DisableEncodeUrlFilter
import org.springframework.web.filter.OncePerRequestFilter

/** app.auth.oidc.issuer(AUTH_OIDC_ISSUER)에 값이 있을 때만 OIDC 제공자를 켠다. @ConditionalOnProperty는 빈 문자열도 켜짐으로 보므로 직접 검사한다. */
class OidcEnabledCondition : Condition {
    override fun matches(context: ConditionContext, metadata: AnnotatedTypeMetadata): Boolean =
        !context.environment.getProperty("app.auth.oidc.issuer").isNullOrBlank()
}

/**
 * Langfuse가 Core 계정으로 OIDC 로그인하도록 Core를 OIDC 제공자로 연다(DEC-55, Spring Authorization Server).
 * 별도 SecurityFilterChain이 [OIDC_PATH] 아래의 authorize·token·jwks·userinfo·discovery만 맡고, 기존 체인·회원 JWT(HS256)·쿠키 규칙은 바꾸지 않는다.
 * AUTH_OIDC_ISSUER가 비어 있으면 이 설정 전체(체인·빈)가 빠진다.
 */
@Configuration(proxyBeanMethods = false)
@Conditional(OidcEnabledCondition::class)
@EnableConfigurationProperties(OidcProperties::class)
class OidcSecurityConfig {
    /** JWKS로 공개하고 ID 토큰·액세스 토큰에 서명하는 RS256 키. 회원 JWT 키(AUTH_JWT_SECRET)와 섞이지 않는다. */
    @Bean
    fun oidcJwkSource(props: OidcProperties): JWKSource<SecurityContext> = ImmutableJWKSet(JWKSet(rsaJwkFromPem(props.signingKey)))

    @Bean
    @Order(Ordered.HIGHEST_PRECEDENCE)
    fun oidcSecurityFilterChain(http: HttpSecurity, props: OidcProperties, sessions: SessionService,
        jwkSource: JWKSource<SecurityContext>, passwords: PasswordEncoder): SecurityFilterChain {
        // 앱에는 회원 JWT용 JwtEncoder·JwtDecoder(HS256) 빈이 이미 있어 AS의 기본 탐색이 그것을 집는다.
        // 토큰 서명·검증은 RS256 키로 직접 만들어 쓰고 빈으로는 노출하지 않는다(다른 체인의 JwtDecoder 탐색을 깨지 않으려고).
        val jwtGenerator = JwtGenerator(NimbusJwtEncoder(jwkSource)).apply { setJwtCustomizer(oidcMemberClaims()) }
        http.securityMatcher("$OIDC_PATH/**")
            .sessionManagement { it.sessionCreationPolicy(SessionCreationPolicy.STATELESS) }
            .oauth2AuthorizationServer { server ->
                server.authorizationServerSettings(oidcAuthorizationServerSettings(props))
                    .registeredClientRepository(InMemoryRegisteredClientRepository(langfuseClient(props, passwords)))
                    // ponytail: 인가 저장은 메모리(단일 Core 인스턴스 전제). 재시작하면 진행 중인 로그인만 끊긴다. 여러 대로 늘리면 JDBC 서비스로 바꾼다.
                    .authorizationService(InMemoryOAuth2AuthorizationService())
                    .tokenGenerator(jwtGenerator)
                    .oidc(Customizer.withDefaults())
            }
            .authorizeHttpRequests { it.anyRequest().authenticated() }
            // userinfo가 받는 Bearer 액세스 토큰은 RS256 키로만 검증한다(회원 JWT(HS256)는 받지 않는다).
            .oauth2ResourceServer { it.jwt { jwt -> jwt.decoder(OAuth2AuthorizationServerConfiguration.jwtDecoder(jwkSource)) } }
            .addFilterBefore(OidcMountFilter(), DisableEncodeUrlFilter::class.java)
            .addFilterAfter(OidcAuthorizeFilter(sessions, props), SecurityContextHolderFilter::class.java)
        return http.build()
    }
}

/**
 * OIDC 체인의 첫 필터. 요청 경로 [OIDC_PATH]를 컨텍스트 경로처럼 취급해 Spring Authorization Server가 issuer 경로 아래에서
 * 엔드포인트(issuer/authorize 등)를 찾게 한다. 메타데이터가 주소를 issuer + 엔드포인트 경로로 만들기 때문이다.
 * 원래 요청 주소(getRequestURI)는 그대로라 로그인 복귀 주소에 쓸 수 있다.
 */
class OidcMountFilter : OncePerRequestFilter() {
    override fun doFilterInternal(request: HttpServletRequest, response: HttpServletResponse, chain: FilterChain) {
        chain.doFilter(object : HttpServletRequestWrapper(request) {
            override fun getContextPath(): String = super.getContextPath() + OIDC_PATH
        }, response)
    }
}

/** AUTH_OIDC_SIGNING_KEY(PKCS#8 PEM. 줄바꿈 자리에 \n 글자가 와도 된다)에서 RS256 서명 JWK를 만든다. kid는 공개키 지문이라 재시작해도 같다. */
internal fun rsaJwkFromPem(pem: String): RSAKey {
    val der = Base64.getMimeDecoder().decode(pem.replace(Regex("-----[^-]+-----|\\\\n"), ""))
    val factory = KeyFactory.getInstance("RSA")
    val privateKey = factory.generatePrivate(PKCS8EncodedKeySpec(der)) as RSAPrivateCrtKey
    require(privateKey.modulus.bitLength() >= 2048) { "AUTH_OIDC_SIGNING_KEY must be an RSA key of at least 2048 bits" }
    val publicKey = factory.generatePublic(RSAPublicKeySpec(privateKey.modulus, privateKey.publicExponent)) as RSAPublicKey
    return RSAKey.Builder(publicKey).privateKey(privateKey).keyIDFromThumbprint().build()
}

/** 유일한 클라이언트(Langfuse): 인가 코드 + PKCE, 동의 화면 없음. 비밀은 앱 PasswordEncoder 빈(AS의 클라이언트 인증이 쓰는 인코더)으로 해시한다. */
internal fun langfuseClient(props: OidcProperties, passwords: PasswordEncoder): RegisteredClient =
    RegisteredClient.withId(props.clientId).clientId(props.clientId)
        .clientSecret(requireNotNull(passwords.encode(props.clientSecret)))
        .clientAuthenticationMethod(ClientAuthenticationMethod.CLIENT_SECRET_BASIC)
        .clientAuthenticationMethod(ClientAuthenticationMethod.CLIENT_SECRET_POST)
        .authorizationGrantType(AuthorizationGrantType.AUTHORIZATION_CODE)
        .redirectUri(props.redirectUri)
        .scope(OidcScopes.OPENID).scope(OidcScopes.EMAIL).scope(OidcScopes.PROFILE)
        .clientSettings(ClientSettings.builder().requireProofKey(true).requireAuthorizationConsent(false).build())
        .build()

/** issuer는 고정값이고 엔드포인트는 issuer 아래의 짧은 경로다([OidcMountFilter]가 그 경로를 컨텍스트로 취급한다). */
internal fun oidcAuthorizationServerSettings(props: OidcProperties): AuthorizationServerSettings = AuthorizationServerSettings.builder()
    .issuer(props.issuer).authorizationEndpoint("/authorize").tokenEndpoint("/token").jwkSetEndpoint("/jwks").oidcUserInfoEndpoint("/userinfo").build()

/**
 * ID 토큰에 회원 claim(email·email_verified·name=닉네임)을 더한다. sub는 principal 이름(회원 UUID)이다.
 * userinfo는 이 ID 토큰 claim을 scope별로 걸러 그대로 돌려준다. 회원은 가입 때 이메일을 인증하므로 email_verified는 항상 true다.
 */
internal fun oidcMemberClaims(): OAuth2TokenCustomizer<JwtEncodingContext> = OAuth2TokenCustomizer { context ->
    if (context.tokenType.value == OidcParameterNames.ID_TOKEN) {
        val member = requireNotNull(context.getPrincipal<Authentication>()).details as MemberResponse
        context.claims.claim(StandardClaimNames.EMAIL, member.email).claim(StandardClaimNames.EMAIL_VERIFIED, true)
            .claim(StandardClaimNames.NAME, member.nickname)
    }
}
