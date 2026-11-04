package ai.storyfork.core.world

import ai.storyfork.core.content.domain.*
import ai.storyfork.core.content.repository.ContentRepository
import ai.storyfork.core.content.repository.V5__ImportLegacyContent
import org.flywaydb.core.Flyway
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.datasource.DriverManagerDataSource
import org.springframework.jdbc.support.JdbcTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import tools.jackson.databind.json.JsonMapper
import java.sql.Connection

// One-time protection regression; never a WorldStudio runtime or default verification prerequisite.
@EnabledIfEnvironmentVariable(named="TEST_WORLDSTUDIO_COEXISTENCE_ONCE",matches="true")
class WorldStudioCoexistencePostgresTest {
    @Test fun `independent migration leaves latest Auth and Content schema data and history unchanged`() {
        WorldStudioPostgresFixture("coexist").use { db ->
            val auth=Flyway.configure().dataSource(db.url,System.getenv("TEST_WORLDSTUDIO_DATABASE_USER"),System.getenv("TEST_WORLDSTUDIO_DATABASE_PASSWORD"))
                .locations("classpath:db/migration/auth").table("flyway_schema_history").load()
            assertEquals(3,auth.migrate().migrationsExecuted)
            val mapper=JsonMapper.builder().findAndAddModules().build()
            val source=DriverManagerDataSource(db.url,System.getenv("TEST_WORLDSTUDIO_DATABASE_USER"),System.getenv("TEST_WORLDSTUDIO_DATABASE_PASSWORD"))
            val content=Flyway.configure().dataSource(source).locations("classpath:db/content")
                .javaMigrations(V5__ImportLegacyContent(mapper)).table("content_schema_history")
                .baselineOnMigrate(true).baselineVersion("0").load()
            assertEquals(7,content.migrate().migrationsExecuted)
            db.connect().use { c ->
                WorldStudioPostgresFixture.sql(c,"INSERT INTO public.auth_member(id,email,password_hash,nickname) VALUES ('11111111-1111-1111-1111-111111111111','synthetic@example.invalid','synthetic','QA')")
            }
            fun repository()=ContentRepository(JdbcTemplate(source),TransactionTemplate(JdbcTransactionManager(source)),mapper)
            val repo=repository()
            val setting=Setting(id=contentId(),versionId=contentId(),name="기존 설정",content="  원문 | 보존\n둘째 줄",tags=listOf("둘","하나"),evidence="기존 근거")
            val work=ContentWork(ownerId="synthetic-content-owner",title="기존 작품",world=WorldState(history=mutableListOf(setting)))
            repo.transaction { repo.save(work) }
            val before=db.connect().use(::fingerprint)
            val studio=db.studio()
            assertEquals(1,studio.migrate().migrationsExecuted)
            studio.validate()
            assertEquals(0,studio.migrate().migrationsExecuted)
            assertEquals(before,db.connect().use(::fingerprint),"Public columns, constraints, indexes, rows and Flyway histories must be identical")
            val restored=repository().find(work.id)!!
            assertEquals(setting,restored.world.history.single())
            restored.world.drafts[setting.id]=setting.copy(content="수정 초안")
            repo.transaction { repo.save(restored) }
            val fresh=repository().find(work.id)!!
            assertEquals(setting,fresh.world.history.single())
            assertEquals("수정 초안",fresh.world.drafts[setting.id]!!.content)
            assertEquals(setting.id,fresh.world.history.single().id)
            assertEquals(setting.versionId,fresh.world.history.single().versionId)
            auth.validate();content.validate();studio.validate()
            assertEquals(0,auth.migrate().migrationsExecuted)
            assertEquals(0,content.migrate().migrationsExecuted)
            println("Coexistence PostgreSQL: Auth V1-V3; Content V1-V7 including Java V5; public fingerprint identical; existing Content save/read and IDs preserved; validate/rerun=0")
        }
    }

    private fun fingerprint(c:Connection): Map<String,List<String>> {
        fun rows(sql:String)=WorldStudioPostgresFixture.rows(c,sql)
        val result=linkedMapOf<String,List<String>>()
        val tables=rows("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")
        result["tables"]=tables
        result["columns"]=rows("""SELECT jsonb_build_array(c.relname,a.attname,pg_catalog.format_type(a.atttypid,a.atttypmod),a.attnotnull,pg_get_expr(d.adbin,d.adrelid))::text
            FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
            LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
            WHERE n.nspname='public' AND c.relkind IN ('r','v') AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname,a.attnum""")
        result["constraints"]=rows("""SELECT jsonb_build_array(c.relname,k.conname,pg_get_constraintdef(k.oid))::text
            FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
            WHERE n.nspname='public' ORDER BY c.relname,k.conname""")
        result["indexes"]=rows("SELECT indexdef FROM pg_indexes WHERE schemaname='public' ORDER BY tablename,indexname")
        for(table in tables) {
            require(table.matches(Regex("[a-z_0-9]+")))
            result[table]=rows("SELECT to_jsonb(t)::text FROM public.\"$table\" t ORDER BY to_jsonb(t)::text")
        }
        return result
    }
}
