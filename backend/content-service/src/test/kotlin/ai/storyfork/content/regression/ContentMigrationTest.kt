package ai.storyfork.content.regression

import ai.storyfork.content._common.config.ContentPersistenceConfig
import java.util.UUID
import org.flywaydb.core.Flyway
import org.flywaydb.core.api.FlywayException
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.datasource.DriverManagerDataSource

/** Hosted CI only: each test owns a fresh disposable schema, never a developer/public schema. */
@EnabledIfEnvironmentVariable(named="TEST_CONTENT_DATABASE_URL",matches=".+")
class ContentMigrationTest {
    private fun isolated(test: (Flyway, JdbcTemplate) -> Unit) {
        val schema="fresh_content_"+UUID.randomUUID().toString().replace("-", "")
        val url=System.getenv("TEST_CONTENT_DATABASE_URL")
        val admin=JdbcTemplate(DriverManagerDataSource(url,"content_test",""))
        val scoped=DriverManagerDataSource(url+(if ('?' in url) "&" else "?")+"currentSchema="+schema,"content_test","")
        admin.execute("CREATE SCHEMA $schema")
        try {
            val jdbc=JdbcTemplate(scoped)
            // A nonempty shared schema must not baseline at V1 or touch other owners' objects.
            jdbc.execute("CREATE TABLE auth_ownership_probe (id integer PRIMARY KEY)")
            jdbc.update("INSERT INTO auth_ownership_probe VALUES (7)")
            val flyway=Flyway.configure().dataSource(scoped).schemas(schema).defaultSchema(schema)
                .locations(*ContentPersistenceConfig.MIGRATION_LOCATIONS).table("content_schema_history")
                .baselineOnMigrate(true).baselineVersion("0").validateOnMigrate(true).load()
            test(flyway,jdbc)
            assertEquals(7,jdbc.queryForObject("SELECT id FROM auth_ownership_probe",Int::class.java))
        } finally {
            admin.execute("DROP SCHEMA $schema CASCADE")
        }
    }

    @Test fun `fresh feature leaves initialize in FK order validate and replay idempotently`() = isolated { flyway,jdbc ->
        assertEquals(13,flyway.migrate().migrationsExecuted)
        assertEquals((1..13).map(Int::toString),flyway.info().applied().filter { it.version?.toString()!="0" }.map {it.version.toString()})
        flyway.validate()
        assertEquals(0,flyway.migrate().migrationsExecuted)
        for(table in listOf("work","episode","episode_version","world","setting_version","publication_event","fork","checkpoint","ai_job","ai_proposal","story_plan","story_plan_character","story_plan_place")) {
            assertNotNull(jdbc.queryForObject("SELECT to_regclass(?)::text",String::class.java,table))
        }
        for(view in listOf("work_current","episode_current","setting_version_read")) {
            assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM information_schema.views WHERE table_schema=current_schema() AND table_name=?",Int::class.java,view))
        }
        assertNull(jdbc.queryForObject("SELECT to_regclass('content_work')::text",String::class.java))
        assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='member' AND column_name IN ('email','password_hash','nickname')",Int::class.java))
    }

    @Test fun `fresh schema preserves immutable history and revision floors`() = isolated { flyway,jdbc ->
        flyway.migrate()
        jdbc.update("INSERT INTO member(id) VALUES ('owner')")
        jdbc.update("INSERT INTO work(id,owner_id,title,description,origin_kind,revision) VALUES ('w','owner','제목','','original',0)")
        jdbc.update("INSERT INTO episode(id,work_id,sequence) VALUES ('e','w',1)")
        jdbc.update("INSERT INTO episode_version(id,episode_id,content_version_id,revision_no,title,content,created_at) VALUES ('v','e','cv',1,'원문','보존',now())")
        jdbc.update("INSERT INTO publication_event VALUES ('p','v','owner','publish','applied',now(),'author')")
        assertEquals(5,jdbc.queryForObject("SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=current_schema() AND t.tgname IN ('episode_version_immutable','setting_version_immutable','publication_event_immutable','fork_decision_immutable','proposal_decision_immutable')",Int::class.java))
        for(statement in listOf("UPDATE episode_version SET content='훼손'","DELETE FROM episode_version","DELETE FROM publication_event","UPDATE episode SET draft_revision_floor=-2","UPDATE work SET deleted_episode_revision=-1")) {
            assertThrows(DataIntegrityViolationException::class.java) {jdbc.update(statement)}
        }
        assertEquals("보존",jdbc.queryForObject("SELECT content FROM episode_version WHERE id='v'",String::class.java))
    }

    @Test fun `changed history fails validation instead of silently repairing`() = isolated { flyway,jdbc ->
        flyway.migrate()
        jdbc.update("UPDATE content_schema_history SET checksum=checksum+1 WHERE version='1'")
        assertThrows(FlywayException::class.java) {flyway.migrate()}
        assertEquals(13,jdbc.queryForObject("SELECT count(*) FROM content_schema_history WHERE version<>'0' AND success",Int::class.java))
    }
}
