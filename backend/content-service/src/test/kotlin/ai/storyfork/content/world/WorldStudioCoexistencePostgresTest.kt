package ai.storyfork.content.world

import ai.storyfork.content.ContentServiceApplication
import ai.storyfork.content.work.service.WorkService
import ai.storyfork.content.work.service.dto.CreateWorkRequest
import ai.storyfork.content.world.service.WorldService
import ai.storyfork.content.world.service.WorldStudioService
import ai.storyfork.content.world.service.dto.*
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable
import org.springframework.boot.builder.SpringApplicationBuilder
import java.sql.Connection
import java.util.UUID

@EnabledIfEnvironmentVariable(named="TEST_WORLDSTUDIO_DATABASE_URL",matches=".+")
class WorldStudioCoexistencePostgresTest {
    private fun context(db:WorldStudioPostgresFixture, studio:Boolean)=SpringApplicationBuilder(ContentServiceApplication::class.java).run(
        "--spring.datasource.hikari.maximum-pool-size=3", "--spring.datasource.hikari.minimum-idle=0",
        "--server.port=0", "--app.content.enabled=true", "--app.worldstudio.enabled=$studio",
        "--app.setting-attachments.enabled=false",
        "--CONTENT_DATABASE_URL=${db.url}", "--CONTENT_DATABASE_USER=${System.getenv("TEST_WORLDSTUDIO_DATABASE_USER")}",
        "--CONTENT_DATABASE_PASSWORD=${System.getenv("TEST_WORLDSTUDIO_DATABASE_PASSWORD")}",
        "--CONTENT_CORE_AUTH_TOKEN=content-test-service-credential-at-least-32")

    @Test fun `independent migration preserves content and both JPA services coexist`() {
        WorldStudioPostgresFixture("coexist").use { db ->
            val actor=UUID.randomUUID().toString()
            var workId=""; var settingId=""; var versionId=""
            val original="  원문 | 보존\n둘째 줄"
            context(db,false).use { ctx ->
                workId=ctx.getBean(WorkService::class.java).create(actor,CreateWorkRequest("기존 작품")).id
                val world=ctx.getBean(WorldService::class.java)
                val before=world.read(workId,actor)
                val draft=world.saveDraft(workId,"new",actor,SettingRequest(before.revision,SettingPayload(name="기존 설정",content=original),before.sourceToken))
                settingId=draft.draft!!.id
                val saved=world.commit(workId,settingId,actor,draft.revision)
                versionId=saved.settings.single().versionId
            }
            val before=db.connect().use(::fingerprint)
            val studio=db.studio()
            assertEquals(2,studio.migrate().migrationsExecuted)
            studio.validate()
            assertEquals(0,studio.migrate().migrationsExecuted)
            assertEquals(before,db.connect().use(::fingerprint))
            context(db,true).use { ctx ->
                val content=ctx.getBean(WorldService::class.java)
                val current=content.read(workId,actor)
                assertEquals(original,current.settings.single().content)
                assertEquals(versionId,current.settings.single().versionId)
                val independent=ctx.getBean(WorldStudioService::class.java)
                val created=independent.create(UUID.fromString(actor),CreateWorldRequest("독립 세계관",""))
                val saved=independent.save(created.worldId,UUID.fromString(actor),SaveWorldRequest(created.draftRevision,"first"))
                assertEquals(before,db.connect().use(::fingerprint),"Studio writes must not touch public Auth/Content data")
                val changed=content.saveDraft(workId,settingId,actor,SettingRequest(current.revision,SettingPayload(id=settingId,name="기존 설정",content="수정 초안"),current.sourceToken))
                assertEquals("수정 초안",changed.draft!!.content)
                assertEquals(original,content.read(workId,actor).settings.single().content)
                assertEquals(saved,independent.revision(created.worldId,UUID.fromString(actor),saved.revisionId))
            }
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
