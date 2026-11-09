package ai.storyfork.core.auth

import java.nio.file.Files
import java.nio.file.Path
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder

/** V11 STORYFORK 플랫폼 계정: 고정 ID의 로그인 불가 관리자이며 재적용해도 기존 행을 바꾸지 않는다. DB 없이 SQL 파일만 확인한다. */
class PlatformAccountMigrationTest {
    private val sql = Files.readString(Path.of("src/main/resources/db/migration/auth/V11__storyfork_platform_account.sql"))

    @Test
    fun `platform account is a fixed id login disabled operator that never overwrites`() {
        assertTrue(sql.contains("'b09cdf87-6901-50df-9c76-881c81f4f034'"))
        assertTrue(Regex("""'STORYFORK',\s*true\)""").containsMatchIn(sql), "operator=true")
        assertTrue(sql.contains("'!platform-login-disabled'"))
        assertTrue(sql.contains("ON CONFLICT (id) DO NOTHING"))
    }

    @Test
    fun `the stored hash is not BCrypt so no password can log in`() {
        assertFalse(BCryptPasswordEncoder().matches("StoryforkDev123!", "!platform-login-disabled"))
    }
}
