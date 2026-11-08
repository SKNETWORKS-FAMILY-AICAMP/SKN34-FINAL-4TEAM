package ai.storyfork.content.regression

import ai.storyfork.content._common.config.ContentPersistenceConfig
import java.util.UUID
import java.nio.file.Files
import java.nio.file.Path
import java.security.MessageDigest
import java.util.HexFormat
import tools.jackson.databind.json.JsonMapper
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
        assertEquals(16,flyway.migrate().migrationsExecuted)
        assertEquals((1..16).map(Int::toString),flyway.info().applied().filter { it.version?.toString()!="0" }.map {it.version.toString()})
        flyway.validate()
        assertEquals(0,flyway.migrate().migrationsExecuted)
        for(table in listOf("work","work_view","episode","episode_version","world","setting_version","publication_event","fork","checkpoint","ai_job","ai_proposal","story_plan","story_plan_character","story_plan_place","setting_reading_detail","setting_reading_property","setting_reading_alias","setting_reading_participant","setting_reading_link","setting_reading_knowledge")) {
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

    private val sampleDir = Path.of("..", "..", "infrastructure", "sample-data")

    @Test fun `V16 samples preserve bodies source versions wiki and replay without changes`() = isolated { flyway,jdbc ->
        flyway.migrate()
        assertEquals(0,flyway.migrate().migrationsExecuted)
        for ((table, count) in mapOf("member" to 10, "work" to 11, "fork" to 7, "episode_version" to 32,
            "publication_event" to 17, "checkpoint_episode" to 15, "setting_document" to 120, "setting_reading_detail" to 120)) {
            assertEquals(count, jdbc.queryForObject("SELECT count(*) FROM $table", Int::class.java), table)
        }
        assertEquals(15, jdbc.queryForObject("SELECT count(*) FROM episode_version WHERE NOT is_saved", Int::class.java))
        assertEquals(7, jdbc.queryForObject("SELECT count(*) FROM fork_world_reference WHERE reference_status='independent'", Int::class.java))
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM publication_event p JOIN episode_version v ON v.id=p.episode_version_id WHERE NOT v.is_saved", Int::class.java))
        val inventory=JsonMapper.builder().build().readTree(Files.readString(sampleDir.resolve("source-inventory.json")))
        for (work in inventory.path("canonicalMappings")) {
            assertEquals(work.path("ownerSubjectId").asText(), jdbc.queryForObject("SELECT owner_id FROM work WHERE id=?", String::class.java, work.path("workId").asText()))
            for (episode in work.path("episodes")) {
                val body=jdbc.queryForObject("SELECT content FROM episode_version WHERE id=?", String::class.java, episode.path("versionRowId").asText())!!
                assertEquals(episode.path("bodySha256").asText(), HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(body.toByteArray(Charsets.UTF_8))))
            }
            for (inherited in work.path("sourceEpisodeVersionIds")) {
                assertEquals(inherited.path("contentVersionId").asText(), jdbc.queryForObject("SELECT content_version_id FROM episode_version WHERE id=?", String::class.java, inherited.path("localVersionRowId").asText()))
            }
        }
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM setting_reading_detail d JOIN setting_version v ON v.id=d.setting_version_id JOIN setting_visibility_range r ON r.visibility_history_id=v.visibility_history_id JOIN episode e ON e.id=r.start_episode_id WHERE d.source_basis_episode IS NOT NULL AND (e.sequence>d.source_basis_episode OR d.event_episode>d.source_basis_episode)", Int::class.java))
        assertEquals(3,jdbc.queryForObject("SELECT count(*) FROM setting_reading_property p JOIN setting_reading_detail d ON d.setting_version_id=p.setting_version_id WHERE d.source_key='char:카엘' AND p.name='관계' AND p.public_from_episode=2",Int::class.java))
        assertTrue(jdbc.queryForObject("SELECT count(*) FROM setting_reading_property WHERE public_from_episode IS NULL",Int::class.java)!!>0)
        // Frozen samples have no aliases/knowledge; row-level immutability probes need actual rows.
        val detailId=jdbc.queryForObject("SELECT setting_version_id FROM setting_reading_detail ORDER BY setting_version_id LIMIT 1",String::class.java)
        jdbc.update("INSERT INTO setting_reading_alias(setting_version_id,position,alias) VALUES (?,0,'CI immutable probe')",detailId)
        jdbc.update("INSERT INTO setting_reading_knowledge(setting_version_id,position,content,known_at) VALUES (?,0,'CI immutable probe',1)",detailId)
        for (table in listOf("setting_reading_detail", "setting_reading_property", "setting_reading_alias", "setting_reading_participant", "setting_reading_link", "setting_reading_knowledge")) {
            assertTrue(jdbc.queryForObject("SELECT count(*) FROM $table",Int::class.java)!!>0)
            assertThrows(DataIntegrityViolationException::class.java) { jdbc.update("DELETE FROM $table") }
        }
        flyway.validate()
    }

    private fun upTo15(jdbc: JdbcTemplate)=Flyway.configure().dataSource(jdbc.dataSource!!).schemas(jdbc.queryForObject("SELECT current_schema()",String::class.java))
        .defaultSchema(jdbc.queryForObject("SELECT current_schema()",String::class.java)).locations(*ContentPersistenceConfig.MIGRATION_LOCATIONS)
        .table("content_schema_history").baselineOnMigrate(true).baselineVersion("0").target("15").load()

    @Test fun `V16 keeps an existing row with the same key instead of overwriting it`() = isolated { flyway,jdbc ->
        upTo15(jdbc).migrate()
        // Same sample owner and tag id, different local value: the sample row must not overwrite it.
        jdbc.update("INSERT INTO member(id) VALUES ('b1b09f26-1c1e-3a11-9bb1-6f0d7927ab44')")
        jdbc.update("INSERT INTO setting_tag(id,owner_id,name) VALUES ('d33a36b6-5c8e-3862-9ad2-ca287e55889c','b1b09f26-1c1e-3a11-9bb1-6f0d7927ab44','keep local')")
        assertEquals(1,flyway.migrate().migrationsExecuted)
        assertEquals("keep local", jdbc.queryForObject("SELECT name FROM setting_tag WHERE id='d33a36b6-5c8e-3862-9ad2-ca287e55889c'", String::class.java))
        assertEquals(11, jdbc.queryForObject("SELECT count(*) FROM work", Int::class.java))
    }

    @Test fun `V16 secondary unique conflict fails atomically instead of partial samples`() = isolated { flyway,jdbc ->
        upTo15(jdbc).migrate()
        jdbc.update("INSERT INTO member(id) VALUES ('unrelated')")
        jdbc.update("INSERT INTO work(id,owner_id,title,description,origin_kind,revision,slug) VALUES ('unrelated','unrelated','keep local','','original',0,'guunmong')")
        assertThrows(FlywayException::class.java) { flyway.migrate() }
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM member", Int::class.java))
        assertEquals(1, jdbc.queryForObject("SELECT count(*) FROM work", Int::class.java))
        assertEquals(0, jdbc.queryForObject("SELECT count(*) FROM world", Int::class.java))
    }

    @Test fun `work view keeps one row per member episode and day and rejects broken references`() = isolated { flyway,jdbc ->
        flyway.migrate()
        jdbc.update("INSERT INTO member(id) VALUES ('owner')")
        jdbc.update("INSERT INTO work(id,owner_id,title,description,origin_kind,revision) VALUES ('w','owner','제목','','original',0)")
        val insert="INSERT INTO work_view(work_id,episode_number,member_id,view_date) VALUES (?,?,?,?::date)"
        jdbc.update(insert,"w",1,"reader","2026-11-08")
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM work_view WHERE viewed_at IS NOT NULL",Int::class.java))
        for(row in listOf(arrayOf<Any>("w",1,"reader","2026-11-08"),arrayOf<Any>("w",0,"reader","2026-11-08"),arrayOf<Any>("missing",1,"reader","2026-11-08"))) {
            assertThrows(DataIntegrityViolationException::class.java) {jdbc.update(insert,*row)}
        }
        for(row in listOf(arrayOf<Any>("w",1,"reader","2026-11-09"),arrayOf<Any>("w",2,"reader","2026-11-08"),arrayOf<Any>("w",1,"other","2026-11-08"))) jdbc.update(insert,*row)
        assertEquals(4,jdbc.queryForObject("SELECT count(*) FROM work_view",Int::class.java))
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM pg_indexes WHERE schemaname=current_schema() AND indexname='work_view_viewed_at'",Int::class.java))
    }

    @Test fun `changed history fails validation instead of silently repairing`() = isolated { flyway,jdbc ->
        flyway.migrate()
        jdbc.update("UPDATE content_schema_history SET checksum=checksum+1 WHERE version='1'")
        assertThrows(FlywayException::class.java) {flyway.migrate()}
        assertEquals(16,jdbc.queryForObject("SELECT count(*) FROM content_schema_history WHERE version<>'0' AND success",Int::class.java))
    }
}
