package ai.storyfork.core.content

import ai.storyfork.core.content.domain.*
import ai.storyfork.core.content.repository.ContentRepository
import ai.storyfork.core.content.repository.V5__ImportLegacyContent
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
                .locations("classpath:db/content").table("content_schema_history").javaMigrations(V5__ImportLegacyContent(mapper))
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
        val repository=ContentRepository(jdbc,TransactionTemplate(JdbcTransactionManager(scoped)),mapper)
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
}
