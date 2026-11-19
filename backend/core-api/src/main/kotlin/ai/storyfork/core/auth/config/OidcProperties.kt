package ai.storyfork.core.auth.config

import java.net.URI
import org.springframework.boot.context.properties.ConfigurationProperties

/** Core가 OIDC 제공자로 서는 경로. issuer의 경로이면서 OIDC SecurityFilterChain의 범위다. */
const val OIDC_PATH = "/api/v1/auth/oidc"

/**
 * Langfuse OIDC 로그인용 제공자 설정(DEC-55, env AUTH_OIDC_*). issuer가 비어 있으면 [OidcEnabledCondition]이 제공자 전체를 꺼서
 * 이 클래스는 만들어지지 않는다(로컬·CI 기본). 켠 뒤에는 값이 하나라도 빠지거나 어긋나면 기동 때 실패한다.
 */
@ConfigurationProperties(prefix = "app.auth.oidc")
data class OidcProperties(
    val issuer: String,
    val signingKey: String,
    val clientId: String,
    val clientSecret: String,
    val redirectUri: String,
    val loginUrl: String,
) {
    init {
        val issuerUri = URI.create(issuer)
        // 엔드포인트 주소는 issuer + 엔드포인트 경로로 광고되므로 issuer 경로가 실제 서는 경로(OIDC_PATH)와 같아야 한다.
        require(issuerUri.scheme in setOf("http", "https") && issuerUri.path == OIDC_PATH && issuerUri.query == null && issuerUri.fragment == null) {
            "AUTH_OIDC_ISSUER must be an http(s) URL whose path is $OIDC_PATH"
        }
        require(signingKey.isNotBlank() && clientId.isNotBlank() && clientSecret.isNotBlank() && redirectUri.isNotBlank() && loginUrl.isNotBlank()) {
            "AUTH_OIDC_SIGNING_KEY, AUTH_OIDC_LANGFUSE_CLIENT_ID, AUTH_OIDC_LANGFUSE_CLIENT_SECRET and AUTH_OIDC_LANGFUSE_REDIRECT_URI are required when AUTH_OIDC_ISSUER is set"
        }
        require(URI.create(redirectUri).isAbsolute) { "AUTH_OIDC_LANGFUSE_REDIRECT_URI must be an absolute URL" }
        // 클라이언트 비밀은 앱의 BCrypt로 해시하며 BCrypt는 72바이트를 넘는 값을 다루지 못한다(회원 비밀번호 검사와 같은 한도).
        require(clientSecret.toByteArray(Charsets.UTF_8).size <= 72) { "AUTH_OIDC_LANGFUSE_CLIENT_SECRET must be at most 72 bytes" }
    }

    /** 서명 키·클라이언트 비밀이 로그에 남지 않게 둘은 빼고 출력한다. */
    override fun toString() = "OidcProperties(issuer=$issuer, clientId=$clientId)"
}
