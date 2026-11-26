package ai.storyfork.content.comment

import ai.storyfork.content.comment.client.dto.FeedbackPrediction
import ai.storyfork.content.comment.repository.CommentFeedbackStore
import ai.storyfork.content.comment.client.CommentFeedbackClient
import ai.storyfork.content.comment.service.CommentFeedbackJob
import ai.storyfork.content._common.ai_config.AiServiceClientProperties
import org.springframework.web.client.RestClient
import java.time.Duration
import java.net.URI
import ai.storyfork.content.comment.controller.CommentFeedbackController
import ai.storyfork.content.comment.service.CommentFeedbackQueryService
import ai.storyfork.content.work.service.WorkAccessService
import org.mockito.Mockito
import org.springframework.test.web.servlet.setup.MockMvcBuilders
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get
import tools.jackson.databind.json.JsonMapper
import java.util.UUID
import org.junit.jupiter.api.Assertions.*
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.jdbc.datasource.DriverManagerDataSource

/** 임시 스키마에 실제 마이그레이션을 적용한다. 본문 수정·숨김·삭제와 워커 재시작을 검사한다. */
@EnabledIfEnvironmentVariable(named="TEST_CONTENT_DATABASE_URL",matches=".+")
class CommentFeedbackStorePostgresTest {
    @Test fun `lease retry and restart preserve one result for the current body`() {
        val url = System.getenv("TEST_CONTENT_DATABASE_URL")
        val schema = "feedback_" + UUID.randomUUID().toString().replace("-","")
        val admin = JdbcTemplate(DriverManagerDataSource(url,"content_test",""))
        admin.execute("create schema $schema")
        try {
            val source = DriverManagerDataSource(url + (if ("?" in url) "&" else "?") + "currentSchema=$schema","content_test","")
            val db = JdbcTemplate(source)
            db.execute("create table episode_comment(id varchar(36) primary key, body text, hidden boolean default false, deleted_at timestamptz, work_id text default 'w', episode_number int default 1)")
            db.update("insert into episode_comment(id,body) values ('old','기존 댓글')")
            val migration = javaClass.getResource("/db/migration/work/V48__episode_comment_feedback.sql")!!.readText()
            db.execute(migration)
            db.execute(javaClass.getResource("/db/migration/work/V49__comment_primary_aspect.sql")!!.readText())
            val store = CommentFeedbackStore(source)
            assertNull(store.claim(30))
            db.update("insert into episode_comment(id,body) values ('new','새 댓글')")
            val abandoned = store.claim(60)!!
            assertNull(store.claim(60))
            db.update("update episode_comment_feedback set due_at=now()")
            val recovered = CommentFeedbackStore(source).claim(60)!!
            val result = FeedbackPrediction(false,0.2,"model",0.5)
            assertEquals(0,store.complete(abandoned,result))
            store.fail(recovered,"AI_HTTP_503",true)
            assertEquals("PENDING",store.read("w",1,"new")!!.status)
            db.update("update episode_comment_feedback set due_at=now()")
            store.fail(store.claim(60)!!,"AI_HTTP_503",true)
            val failed = store.read("w",1,"new")!!
            assertEquals("FAILED",failed.status)
            assertNull(failed.isFeedback)
            assertFalse(store.retryFailed("wrong",1,"new"))
            assertTrue(store.retryFailed("w",1,"new"))
            assertFalse(store.retryFailed("w",1,"new"))
            db.update("update episode_comment set body='수정' where id='new'")
            assertEquals(1,store.complete(store.claim(60)!!,result))
            val persisted = CommentFeedbackStore(source).read("w",1,"new")!!
            assertEquals(false,persisted.isFeedback)
            assertEquals(2L,persisted.revision)
            assertEquals(1L,store.counts("w",1).single().count)
            assertTrue(store.counts("w",2).isEmpty())
            db.update("update episode_comment set body='다음 수정' where id='new'")
            assertEquals(1,db.queryForObject("select count(*) from comment_feedback_version_history",Int::class.java))
            val final = FeedbackPrediction(true,1.0,"model",0.9904975295066833,"new","plot","G2")
            val job = store.claimBatch(60,8).single()
            assertEquals(1,store.complete(job,final))
            assertEquals(0,store.complete(job,final))
            assertEquals("plot",store.counts("w",null).single().primaryAspect)
            db.update("update episode_comment set hidden=true where id='new'")
            assertNull(store.read("w",1,"new"))
            db.update("update episode_comment set hidden=false where id='new'")
            val stale = store.claim(60)!!
            db.update("update episode_comment set deleted_at=now() where id='new'")
            assertEquals(0,store.complete(stale,result))
            System.getenv("TEST_FEEDBACK_AI_URL")?.let { endpoint ->
                val client = CommentFeedbackClient(RestClient.builder(), AiServiceClientProperties(
                    URI(endpoint),Duration.ofSeconds(5),Duration.ofSeconds(60)), "local-synthetic-only")
                db.update("insert into episode_comment(id,body,episode_number) values (?,?,1),(?,?,2)",
                          "1","이 문장은 맞춤법이 틀렸어요.","2","캐릭터의 감정 변화가 설득력 있게 묘사됐어요.")
                val worker = CommentFeedbackJob(store,client)
                worker.processOne()
                worker.processOne()
                assertEquals(setOf("typo","character"),store.counts("w",null).map { it.primaryAspect }.toSet())
                assertEquals(1L,store.counts("w",2).single().count)
                assertEquals(0.9904975295066833,store.read("w",1,"1")!!.threshold)
                val access = Mockito.mock(WorkAccessService::class.java)
                val mvc = MockMvcBuilders.standaloneSetup(CommentFeedbackController(CommentFeedbackQueryService(access,store))).build()
                val read = mvc.perform(get("/api/v1/works/w/comment-feedback/counts")
                    .param("episode","2").principal { "author" }).andReturn().response
                assertEquals(200,read.status)
                val group = JsonMapper.builder().build().readTree(read.contentAsByteArray).single()
                assertEquals("character",group["primaryAspect"].asString())
                assertEquals(1,group["count"].asInt())
                Mockito.verify(access).own("w","author")
            }
            assertNull(store.read("w",1,"new"))
        } finally {
            admin.execute("drop schema $schema cascade")
        }
    }
}
