package ai.storyfork.core.auth

import java.nio.file.Files
import java.nio.file.Path
import java.sql.SQLException
import java.net.URI
import java.util.UUID
import org.flywaydb.core.Flyway
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.datasource.DriverManagerDataSource

/** CI only: additive import into an owned random schema, never the shared Auth schema. */
@EnabledIfEnvironmentVariable(named = "AUTH_INTEGRATION_TEST", matches = "true")
class SampleImportPostgresTest {
    private val writer = UUID.fromString("b832d965-0352-4eb1-b896-7a307ba09a68")
    private val sampleDir = Path.of("..", "..", "infrastructure", "sample-data")

    private fun isolated(test: (JdbcTemplate) -> Unit) {
        val schema = "sample_auth_" + UUID.randomUUID().toString().replace("-", "")
        val url = requireNotNull(System.getenv("CORE_DATABASE_URL"))
        val user = requireNotNull(System.getenv("CORE_DATABASE_USER"))
        val password = System.getenv("CORE_DATABASE_PASSWORD") ?: ""
        val admin = JdbcTemplate(DriverManagerDataSource(url, user, password))
        val scoped = DriverManagerDataSource(url + (if ('?' in url) "&" else "?") + "currentSchema=" + schema, user, password)
        admin.execute("CREATE SCHEMA $schema")
        try {
            Flyway.configure().dataSource(scoped).schemas(schema).defaultSchema(schema)
                .locations("classpath:db/migration/auth", "classpath:db/migration/notification").load().migrate()
            val jdbc = JdbcTemplate(scoped)
            jdbc.execute("CREATE TABLE content_ownership_probe (id integer PRIMARY KEY)")
            jdbc.update("INSERT INTO content_ownership_probe VALUES (7)")
            test(jdbc)
            assertEquals(7, jdbc.queryForObject("SELECT id FROM content_ownership_probe", Int::class.java))
        } finally {
            admin.execute("DROP SCHEMA $schema CASCADE")
        }
    }

    private fun importSamples(jdbc: JdbcTemplate, approval: String = "approved-development", wrongTarget: Boolean = false) {
        jdbc.dataSource!!.connection.use { connection ->
            val target=URI(connection.metaData.url.removePrefix("jdbc:"))
            val builder=ProcessBuilder("python3","-I",sampleDir.resolve("load.py").toString(),"--service","core",
                "--database",if(wrongTarget) "not_the_owned_test_database" else connection.catalog,"--schema",connection.schema,"--approval",approval)
            builder.environment().putAll(mapOf("PGHOST" to target.host,"PGPORT" to (if(target.port<0) 5432 else target.port).toString(),
                "PGDATABASE" to connection.catalog,"PGUSER" to requireNotNull(System.getenv("CORE_DATABASE_USER")),
                "PGPASSWORD" to (System.getenv("CORE_DATABASE_PASSWORD") ?: ""),"PGCLIENTENCODING" to "UTF8"))
            builder.environment().remove("PGSERVICE")
            builder.environment().remove("PGOPTIONS")
            val process=builder.redirectErrorStream(true).start()
            process.inputStream.use {it.readBytes()} // Keep possible credentials/row values out of CI reports.
            if(process.waitFor()!=0) throw SQLException("Core CSV loader refused import; transaction rolled back")
        }
    }

    @Test fun `ordinary disabled accounts replay without changing existing writer credentials or ownership`() = isolated { jdbc ->
        val before = jdbc.queryForMap("SELECT * FROM auth_member WHERE id=?", writer)
        importSamples(jdbc)
        importSamples(jdbc)
        assertEquals(10, jdbc.queryForObject("SELECT count(*) FROM auth_member", Int::class.java))
        assertEquals(9, jdbc.queryForObject("SELECT count(*) FROM auth_member WHERE id<>? AND password_hash='!sample-import-login-disabled' AND NOT operator", Int::class.java, writer))
        assertTrue(before == jdbc.queryForMap("SELECT * FROM auth_member WHERE id=?", writer), "Existing writer must remain unchanged")
    }

    @Test fun `approval target and existing writer identity are mandatory`() = isolated { jdbc ->
        assertThrows(SQLException::class.java) { importSamples(jdbc, approval = "not-approved") }
        assertThrows(SQLException::class.java) { importSamples(jdbc, wrongTarget = true) }
        jdbc.update("UPDATE auth_member SET operator=true WHERE id=?", writer)
        assertThrows(SQLException::class.java) { importSamples(jdbc) }
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM auth_member", Int::class.java))
    }

    @Test fun `secondary email collision rolls back all new fixture accounts`() = isolated { jdbc ->
        val email = "SELECT email FROM auth_member WHERE id=?"
        val existingEmail = jdbc.queryForObject(email, String::class.java, writer)
        val inventory = tools.jackson.databind.json.JsonMapper.builder().build()
            .readTree(Files.readString(sampleDir.resolve("source-inventory.json")))
        val author = inventory.path("authors").first { it.path("canonicalOwnerLabel").asText() != "개발 작가" }
        jdbc.update("INSERT INTO auth_member(id,email,password_hash,nickname,operator) VALUES (?,?,?,'local',false)", UUID.randomUUID(), author.path("proposedEmail").asText(), "!disabled-local")
        assertThrows(SQLException::class.java) { importSamples(jdbc) }
        assertEquals(2, jdbc.queryForObject("SELECT count(*) FROM auth_member", Int::class.java))
        assertEquals(existingEmail, jdbc.queryForObject(email, String::class.java, writer))
    }
}
