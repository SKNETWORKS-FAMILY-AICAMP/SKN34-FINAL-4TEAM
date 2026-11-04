package ai.storyfork.core.content

import ai.storyfork.core.content.migration.model.*
import ai.storyfork.core.content.migration.LegacyContentRepository
import ai.storyfork.core.content.migration.V5__ImportLegacyContent
import org.flywaydb.core.Flyway
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable
import org.springframework.beans.factory.annotation.Autowired
import org.springframework.boot.test.context.SpringBootTest
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.datasource.DriverManagerDataSource
import org.springframework.jdbc.support.JdbcTransactionManager
import org.springframework.transaction.support.TransactionTemplate
import tools.jackson.databind.json.JsonMapper

@EnabledIfEnvironmentVariable(named="TEST_CONTENT_DATABASE_URL",matches=".+")
@SpringBootTest
class ContentMigrationTest {
    @Autowired lateinit var mapper: JsonMapper
    @Test fun `legacy originals forks settings and AI evidence survive migration and restart`() {
        val schema="migration_"+contentId().replace("-","")
        val ds=DriverManagerDataSource(System.getenv("TEST_CONTENT_DATABASE_URL"),"content_test","")
        fun flyway(target: String?=null): Flyway {
            val config=Flyway.configure().dataSource(ds).schemas(schema).defaultSchema(schema)
                .locations("classpath:db/migration/content").table("content_schema_history").javaMigrations(V5__ImportLegacyContent(mapper))
            if(target!=null) config.target(target)
            return config.load()
        }
        flyway("1").migrate()
        val scoped=DriverManagerDataSource(System.getenv("TEST_CONTENT_DATABASE_URL")+"?currentSchema="+schema,"content_test","")
        val jdbc=JdbcTemplate(scoped)
        val setting=Setting(id=contentId(),versionId=contentId(),name="보존 규칙",content="본문 원문",visibility="public",tags=listOf("두번째","첫번째"),knownBy=listOf("*"))
        val version=Version(title="1화",body="원문을 보존한다.",revision=1,episode=1)
        val original=ContentWork(ownerId="legacy-author",title="이전 작품",visibility="public",allowFork=true,allowForkPublication=true,
            episodes=mutableListOf(Episode(1,1,version.id,version.title,version.body)),draft=Draft("2화","미발행 비밀",2),
            versions=mutableListOf(version),publicationHistory=mutableListOf(Publication(1,version.id)),world=WorldState(history=mutableListOf(setting)))
        original.proposals.add(Proposal(text="제안",model="stub-model",revision=2,prompt="계속",baseBody=original.draft.body,context=buildContext(original,listOf(setting),2)))
        val fork=ContentWork(ownerId="legacy-reader",title="이전 분기",source=Source(original.id,original.title,1,1,"다른 선택"),
            episodes=original.episodes.map { it.copy(inherited=true) }.toMutableList(),world=WorldState(mode="following",basis=Basis(1,1,listOf(setting))))
        for(w in listOf(original,fork)) jdbc.update("INSERT INTO content_work(id,owner_id,source_id,visibility,payload) VALUES (?,?,?,?,CAST(? AS jsonb))",w.id,w.ownerId,w.source?.workId,w.visibility,mapper.writeValueAsString(w))
        jdbc.update("UPDATE content_work SET created_at='2020-01-01T00:00:00Z' WHERE id=?",original.id)
        flyway().migrate()
        val repository=LegacyContentRepository(jdbc,TransactionTemplate(JdbcTransactionManager(scoped)),mapper)
        val restored=repository.find(original.id)!!
        assertEquals(original.draft,restored.draft)
        assertEquals(java.time.Instant.parse("2020-01-01T00:00:00Z"),jdbc.queryForObject("SELECT created_at FROM work WHERE id=?",java.sql.Timestamp::class.java,original.id)!!.toInstant())
        assertEquals(original.episodes,restored.episodes)
        assertEquals(setting.tags,restored.world.history.single().tags)
        assertEquals("미발행 비밀",restored.proposals.single().baseBody)
        assertEquals("following",repository.find(fork.id)!!.world.mode)
        assertEquals(setting.content,repository.find(fork.id)!!.world.basis!!.settings.single().content)
        assertEquals(2,jdbc.queryForObject("SELECT count(*) FROM content_work",Int::class.java))
        assertEquals(0,flyway().migrate().migrationsExecuted)
        assertEquals(2,jdbc.queryForObject("SELECT count(*) FROM work",Int::class.java))
        assertThrows(org.springframework.dao.DataIntegrityViolationException::class.java) {
            jdbc.update("UPDATE episode_version SET content='훼손'")
        }
        assertThrows(org.springframework.dao.DataIntegrityViolationException::class.java) {
            jdbc.update("UPDATE content_work SET visibility='private'")
        }
    }
    @Test fun `V5 failure rolls back earlier imports and retry preserves legacy rows`() {
        val schema="migration_failure_"+contentId().replace("-","")
        val ds=DriverManagerDataSource(System.getenv("TEST_CONTENT_DATABASE_URL"),"content_test","")
        fun migration(target:String)=Flyway.configure().dataSource(ds).schemas(schema).defaultSchema(schema)
            .locations("classpath:db/migration/content").table("content_schema_history").javaMigrations(V5__ImportLegacyContent(mapper)).target(target).load()
        migration("4").migrate()
        val scoped=DriverManagerDataSource(System.getenv("TEST_CONTENT_DATABASE_URL")+"?currentSchema="+schema,"content_test","")
        val jdbc=JdbcTemplate(scoped)
        val first=ContentWork(ownerId="legacy",title="먼저 이관")
        val second=ContentWork(ownerId="legacy",title="실패 주입")
        for((index,w) in listOf(first,second).withIndex()) jdbc.update("INSERT INTO content_work(id,owner_id,visibility,payload,created_at) VALUES (?,?,?,CAST(? AS jsonb),CAST(? AS timestamptz))",w.id,w.ownerId,w.visibility,mapper.writeValueAsString(w),"2020-01-0${index+1}T00:00:00Z")
        jdbc.execute("CREATE FUNCTION fail_second_import() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.title='실패 주입' THEN RAISE EXCEPTION 'synthetic migration failure'; END IF; RETURN NEW; END; $$")
        jdbc.execute("CREATE TRIGGER fail_second_import BEFORE INSERT ON work FOR EACH ROW EXECUTE FUNCTION fail_second_import()")
        assertThrows(org.flywaydb.core.api.FlywayException::class.java) {migration("5").migrate()}
        assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM work",Int::class.java))
        assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM member",Int::class.java))
        assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM world",Int::class.java))
        assertEquals(2,jdbc.queryForObject("SELECT count(*) FROM content_work",Int::class.java))
        assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM content_schema_history WHERE version='5'",Int::class.java))
        jdbc.execute("DROP TRIGGER fail_second_import ON work")
        migration("5").migrate()
        assertEquals(2,jdbc.queryForObject("SELECT count(*) FROM work",Int::class.java))
        assertEquals(first.draft,LegacyContentRepository(jdbc,TransactionTemplate(JdbcTransactionManager(scoped)),mapper).find(first.id)!!.draft)
        assertEquals(0,migration("5").migrate().migrationsExecuted)
    }

    @Test fun `legacy stale pending proposal before first publication keeps its first episode target`() {
        val schema="migration_pending_"+contentId().replace("-","")
        val ds=DriverManagerDataSource(System.getenv("TEST_CONTENT_DATABASE_URL"),"content_test","")
        fun migration(target:String)=Flyway.configure().dataSource(ds).schemas(schema).defaultSchema(schema)
            .locations("classpath:db/migration/content").table("content_schema_history").javaMigrations(V5__ImportLegacyContent(mapper)).target(target).load()
        migration("4").migrate()
        val scoped=DriverManagerDataSource(System.getenv("TEST_CONTENT_DATABASE_URL")+"?currentSchema="+schema,"content_test","")
        val jdbc=JdbcTemplate(scoped)
        val w=ContentWork(ownerId="legacy",title="첫 공개 전 대기 제안")
        val proposal=Proposal(text="대기 제안",model="stub",revision=0,prompt="계속",baseBody=w.draft.body,context=buildContext(w,emptyList(),1))
        w.proposals.add(proposal)
        w.draft=Draft("1화","제안 이후 수정한 원고",1)
        w.versions.add(Version(title=w.draft.title,body=w.draft.body,revision=1,episode=1,savedAt="2020-01-01T00:00:00Z"))
        val payload=mapper.writeValueAsString(w).replace(",\"targetEpisode\":null", "").replace(",\"appliedVersionId\":null", "")
        jdbc.update("INSERT INTO content_work(id,owner_id,visibility,payload) VALUES (?,?,?,CAST(? AS jsonb))",w.id,w.ownerId,w.visibility,payload)

        migration("5").migrate()

        val restored=LegacyContentRepository(jdbc,TransactionTemplate(JdbcTransactionManager(scoped)),mapper).find(w.id)!!
        val pending=restored.proposals.single()
        assertEquals(1,pending.targetEpisode)
        assertEquals("pending",pending.status)
        assertEquals(0,pending.revision)
        assertEquals(proposal.baseBody,pending.baseBody)
        assertNull(pending.appliedVersionId)
        assertEquals(w.draft,restored.draft)
        assertEquals(w.versions,restored.versions)
        assertEquals(0,migration("5").migrate().migrationsExecuted)
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM ai_proposal",Int::class.java))
        assertEquals(1,jdbc.queryForObject("SELECT count(*) FROM content_work",Int::class.java))
    }

    @Test fun `legacy stale pending proposal with published episodes still rejects an unknown target`() {
        val schema="migration_pending_unknown_"+contentId().replace("-","")
        val ds=DriverManagerDataSource(System.getenv("TEST_CONTENT_DATABASE_URL"),"content_test","")
        fun migration(target:String)=Flyway.configure().dataSource(ds).schemas(schema).defaultSchema(schema)
            .locations("classpath:db/migration/content").table("content_schema_history").javaMigrations(V5__ImportLegacyContent(mapper)).target(target).load()
        migration("4").migrate()
        val scoped=DriverManagerDataSource(System.getenv("TEST_CONTENT_DATABASE_URL")+"?currentSchema="+schema,"content_test","")
        val jdbc=JdbcTemplate(scoped)
        val published=Version(title="1화",body="발행 원고",revision=1,episode=1)
        val w=ContentWork(ownerId="legacy",title="대상 불명 대기 제안",draft=Draft("2화","최신 초안",2),
            episodes=mutableListOf(Episode(1,1,published.id,published.title,published.body)),versions=mutableListOf(published),
            publicationHistory=mutableListOf(Publication(1,published.id)))
        w.proposals.add(Proposal(text="제안",model="stub",revision=0,prompt="계속",baseBody="",context=buildContext(w,emptyList(),1)))
        val payload=mapper.writeValueAsString(w).replace(",\"targetEpisode\":null", "").replace(",\"appliedVersionId\":null", "")
        jdbc.update("INSERT INTO content_work(id,owner_id,visibility,payload) VALUES (?,?,?,CAST(? AS jsonb))",w.id,w.ownerId,w.visibility,payload)

        assertThrows(org.flywaydb.core.api.FlywayException::class.java) {migration("5").migrate()}

        assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM work",Int::class.java))
        assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM content_schema_history WHERE version='5'",Int::class.java))
        assertEquals(mapper.readTree(payload),mapper.readTree(jdbc.queryForObject("SELECT payload::text FROM content_work WHERE id=?",String::class.java,w.id)!!))
    }

    @Test fun `legacy accepted proposals resolve by content and reject ambiguous results`() {
        val schema="migration_ai_"+contentId().replace("-","")
        val ds=DriverManagerDataSource(System.getenv("TEST_CONTENT_DATABASE_URL"),"content_test","")
        fun migration(target:String)=Flyway.configure().dataSource(ds).schemas(schema).defaultSchema(schema)
            .locations("classpath:db/migration/content").table("content_schema_history").javaMigrations(V5__ImportLegacyContent(mapper)).target(target).load()
        migration("4").migrate()
        val scoped=DriverManagerDataSource(System.getenv("TEST_CONTENT_DATABASE_URL")+"?currentSchema="+schema,"content_test","")
        val jdbc=JdbcTemplate(scoped)
        val wrong=Version(title="다른 회차",body="다른 원고",revision=2,episode=1)
        val applied=Version(title="대상 회차",body="기준\n\n제안",revision=2,episode=2)
        val w=ContentWork(ownerId="legacy",title="이전 AI",draft=Draft("2화",applied.body,2),
            episodes=mutableListOf(Episode(1,2,wrong.id,wrong.title,wrong.body)),versions=mutableListOf(wrong,applied),publicationHistory=mutableListOf(Publication(1,wrong.id)))
        val proposal=Proposal(text="제안",model="stub",revision=1,status="accepted",prompt="계속",baseBody="기준",context=buildContext(w,emptyList(),2))
        w.proposals.add(proposal)
        fun legacyJson()=mapper.writeValueAsString(w).replace(",\"targetEpisode\":null", "").replace(",\"appliedVersionId\":null", "")
        jdbc.update("INSERT INTO content_work(id,owner_id,visibility,payload) VALUES (?,?,?,CAST(? AS jsonb))",w.id,w.ownerId,w.visibility,legacyJson())
        // Duplicate the same result identity to make an old revision-based mapping ambiguous.
        w.versions.add(applied.copy(id=contentId()))
        jdbc.update("UPDATE content_work SET payload=CAST(? AS jsonb) WHERE id=?",legacyJson(),w.id)
        assertThrows(org.flywaydb.core.api.FlywayException::class.java) {migration("5").migrate()}
        assertEquals(0,jdbc.queryForObject("SELECT count(*) FROM work",Int::class.java))
        w.versions.removeLast()
        jdbc.update("UPDATE content_work SET payload=CAST(? AS jsonb) WHERE id=?",legacyJson(),w.id)
        migration("5").migrate()
        val restored=LegacyContentRepository(jdbc,TransactionTemplate(JdbcTransactionManager(scoped)),mapper).find(w.id)!!.proposals.single()
        assertEquals(2,restored.targetEpisode)
        assertEquals(applied.id,restored.appliedVersionId)
        assertEquals(0,migration("5").migrate().migrationsExecuted)
    }

}
