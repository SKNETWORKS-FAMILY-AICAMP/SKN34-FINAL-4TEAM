package ai.storyfork.content.plan

import ai.storyfork.content._common.config.ContentPersistenceConfig
import java.util.UUID
import org.flywaydb.core.Flyway
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.ValueSource
import org.springframework.dao.DataIntegrityViolationException
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.datasource.DriverManagerDataSource

/** V10 데이터와 체크섬을 보존하며 계획의 작품 삭제 종속성만 업그레이드한다. */
@EnabledIfEnvironmentVariable(named="TEST_CONTENT_DATABASE_URL", matches=".+")
class StoryPlanMigrationPostgresTest {
    @ParameterizedTest
    @ValueSource(booleans=[false,true])
    fun `fresh and V10 plans follow only their deleted work without losing other data`(upgrade: Boolean) {
        val url=System.getenv("TEST_CONTENT_DATABASE_URL")
        val user=System.getenv("TEST_CONTENT_DATABASE_USER") ?: "content_test"
        val password=System.getenv("TEST_CONTENT_DATABASE_PASSWORD") ?: ""
        val schema="plan_upgrade_"+UUID.randomUUID().toString().replace("-", "")
        val admin=JdbcTemplate(DriverManagerDataSource(url,user,password))
        val source=DriverManagerDataSource(url+(if('?' in url) "&" else "?")+"currentSchema="+schema,user,password)
        admin.execute("CREATE SCHEMA $schema")
        try {
            val jdbc=JdbcTemplate(source)
            fun migrations() = Flyway.configure().dataSource(source).schemas(schema).defaultSchema(schema)
                .locations(*ContentPersistenceConfig.MIGRATION_LOCATIONS).table("content_schema_history")
            val initial=migrations().let { if(upgrade) it.target("10") else it }.load()
            assertEquals(if(upgrade) 10 else 11,initial.migrate().migrationsExecuted)
            val checksum=jdbc.queryForObject("SELECT checksum FROM content_schema_history WHERE version='10'",Int::class.java)
            jdbc.update("INSERT INTO member(id) VALUES ('owner')")
            jdbc.update("INSERT INTO work(id,owner_id,title,description,origin_kind,revision) VALUES ('w','owner','삭제 작품','','original',0),('other','owner','보존 작품','','original',0)")
            jdbc.update("""INSERT INTO story_plan(id,work_id,kind,parent_id,title,content,revision,created_at,deleted_at) VALUES
                ('plot','w','plot',NULL,'현재 계획','',1,now(),NULL),
                ('removed','w','scene','plot','논리 삭제 장면','',2,now(),now()),
                ('scene','w','scene','plot','현재 장면','',1,now(),NULL),
                ('kept','other','plot',NULL,'보존 계획','',1,now(),NULL),
                ('kept-scene','other','scene','kept','보존 장면','',1,now(),NULL)""")
            for(table in listOf("story_plan_character","story_plan_place")) {
                jdbc.update("INSERT INTO $table(plan_id,position,setting_id) VALUES ('removed',0,'old-ref'),('scene',0,'scene-ref'),('kept-scene',0,'kept-ref')")
            }
            if(upgrade) assertThrows(DataIntegrityViolationException::class.java) { jdbc.update("DELETE FROM work WHERE id='w'") }

            val upgraded=migrations().load()
            assertEquals(if(upgrade) 1 else 0,upgraded.migrate().migrationsExecuted)
            assertEquals(checksum,jdbc.queryForObject("SELECT checksum FROM content_schema_history WHERE version='10'",Int::class.java))
            assertEquals(5,jdbc.queryForObject("SELECT count(*) FROM story_plan",Int::class.java))
            // 장면이 남은 플롯의 개별 물리 삭제 제약도 그대로 유지한다.
            assertThrows(DataIntegrityViolationException::class.java) { jdbc.update("DELETE FROM story_plan WHERE id='plot'") }
            assertEquals(1,jdbc.update("DELETE FROM work WHERE id='w'"))
            assertEquals(listOf("kept","kept-scene"),jdbc.queryForList("SELECT id FROM story_plan ORDER BY id",String::class.java))
            for(table in listOf("story_plan_character","story_plan_place")) {
                assertEquals(listOf("kept-ref"),jdbc.queryForList("SELECT setting_id FROM $table",String::class.java))
            }
            assertEquals(listOf("other"),jdbc.queryForList("SELECT id FROM work",String::class.java))
            assertEquals(listOf("owner"),jdbc.queryForList("SELECT id FROM member",String::class.java))
            upgraded.validate()
            assertEquals(0,upgraded.migrate().migrationsExecuted)
        } finally {
            admin.execute("DROP SCHEMA $schema CASCADE")
        }
    }
}
