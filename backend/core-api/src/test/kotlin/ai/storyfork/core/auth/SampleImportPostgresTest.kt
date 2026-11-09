package ai.storyfork.core.auth

import java.nio.file.Files
import java.nio.file.Path
import java.util.UUID
import org.flywaydb.core.Flyway
import org.flywaydb.core.api.FlywayException
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.datasource.DriverManagerDataSource

/** CI only: Flyway V9 sample accounts and the V10 classic-author nickname in an owned random schema, never the shared Auth schema. */
@EnabledIfEnvironmentVariable(named = "AUTH_INTEGRATION_TEST", matches = "true")
class SampleImportPostgresTest {
    private val writer = UUID.fromString("b832d965-0352-4eb1-b896-7a307ba09a68")
    // 고전 원작 2편의 소유 샘플 계정. V9에서는 '운영팀'이라 운영자처럼 보여 V10이 이름을 바꾼다.
    private val classic = UUID.fromString("b1b09f26-1c1e-3a11-9bb1-6f0d7927ab44")
    private val sampleDir = Path.of("..", "..", "infrastructure", "sample-data")
    private val locations = arrayOf("classpath:db/migration/auth", "classpath:db/migration/notification", "classpath:db/migration/sample")

    private fun isolated(test: (JdbcTemplate, (String?) -> Flyway) -> Unit) {
        val schema = "sample_auth_" + UUID.randomUUID().toString().replace("-", "")
        val url = requireNotNull(System.getenv("DATABASE_URL"))
        val user = requireNotNull(System.getenv("DATABASE_USER"))
        val password = System.getenv("DATABASE_PASSWORD") ?: ""
        val admin = JdbcTemplate(DriverManagerDataSource(url, user, password))
        val scoped = DriverManagerDataSource(url + (if ('?' in url) "&" else "?") + "currentSchema=" + schema, user, password)
        admin.execute("CREATE SCHEMA $schema")
        try {
            val flyway = { target: String? ->
                Flyway.configure().dataSource(scoped).schemas(schema).defaultSchema(schema).locations(*locations)
                    .let { if (target == null) it else it.target(target) }.load()
            }
            test(JdbcTemplate(scoped), flyway)
        } finally {
            admin.execute("DROP SCHEMA $schema CASCADE")
        }
    }

    private fun samples(jdbc: JdbcTemplate): Int = requireNotNull(jdbc.queryForObject(
        "SELECT count(*) FROM auth_member WHERE id<>? AND password_hash='!sample-import-login-disabled' AND NOT operator", Int::class.java, writer))

    private fun nickname(jdbc: JdbcTemplate, id: UUID): String = requireNotNull(jdbc.queryForObject("SELECT nickname FROM auth_member WHERE id=?", String::class.java, id))

    @Test fun `V9 adds ordinary disabled sample accounts without changing the existing writer`() = isolated { jdbc, flyway ->
        flyway("8").migrate()
        val before = jdbc.queryForMap("SELECT * FROM auth_member WHERE id=?", writer)
        // 남은 V9(샘플 계정)와 V10(고전 작가 닉네임)이 적용된다.
        assertEquals(2, flyway(null).migrate().migrationsExecuted)
        assertEquals(9, samples(jdbc))
        assertTrue(before == jdbc.queryForMap("SELECT * FROM auth_member WHERE id=?", writer), "Existing writer must remain unchanged")
        assertEquals(0, flyway(null).migrate().migrationsExecuted)
        flyway(null).validate()
    }

    @Test fun `V10 renames only the untouched classic author account and replays idempotently`() = isolated { jdbc, flyway ->
        flyway("9").migrate()
        assertEquals("운영팀", nickname(jdbc, classic))
        assertEquals(1, flyway(null).migrate().migrationsExecuted)
        assertEquals("고전 아카이브", nickname(jdbc, classic))
        // 다른 샘플 계정과 기존 작가의 닉네임은 그대로다.
        assertEquals("개발 작가", nickname(jdbc, writer))
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM auth_member WHERE nickname='윤서하'", Int::class.java))
        assertEquals(0, flyway(null).migrate().migrationsExecuted)
        flyway(null).validate()
        assertEquals("고전 아카이브", nickname(jdbc, classic))
    }

    @Test fun `V10 keeps a nickname the sample account was already given`() = isolated { jdbc, flyway ->
        flyway("9").migrate()
        jdbc.update("UPDATE auth_member SET nickname='직접 바꾼 이름' WHERE id=?", classic)
        assertEquals(1, flyway(null).migrate().migrationsExecuted)
        assertEquals("직접 바꾼 이름", nickname(jdbc, classic))
    }

    @Test fun `secondary email collision fails V9 atomically instead of overwriting`() = isolated { jdbc, flyway ->
        flyway("8").migrate()
        val inventory = tools.jackson.databind.json.JsonMapper.builder().build()
            .readTree(Files.readString(sampleDir.resolve("source-inventory.json")))
        val author = inventory.path("authors").first { it.path("canonicalOwnerLabel").asText() != "개발 작가" }
        jdbc.update("INSERT INTO auth_member(id,email,password_hash,nickname,operator) VALUES (?,?,?,'local',false)", UUID.randomUUID(), author.path("proposedEmail").asText(), "!disabled-local")
        assertThrows(FlywayException::class.java) { flyway(null).migrate() }
        assertEquals(0, samples(jdbc))
    }
}
